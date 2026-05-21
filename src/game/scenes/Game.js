import * as Phaser from "phaser";
import { Scene } from "phaser";
import spiderMonsterData from "../../assets/monsters/Spider.json";

export class Game extends Scene {
    constructor() {
        super("Game");
        this.currentMap = "Spawn Area";
    }

    init(data) {
        this.playerName = data.playerName || "Player";
        this.idleCount = data.idleCount || 1;
        this.walkCount = data.walkCount || 1;
        this.currentSlot = 0; // 0 to 9 (10 slots)

        // Health System
        this.maxHealth = 5;
        this.health = 5;
        this.isInvincible = false;
        this.isKnockedBack = false;
        this.webSlowUntil = 0;
        this.webSlowFactor = 0.45;
        this.webSlowDuration = 1500;

        // Block Data System
        this.blocks = {};
        this.blockColors = [
            0x8b4513, // 1: Dirt
            0x228b22, // 2: Grass
            0x808080, // 3: Stone
            0xd2b48c, // 4: Wood
            0x006400, // 5: Leaves
            0xb22222, // 6: Brick
            0xf4a460, // 7: Sand
            0x1e90ff, // 8: Water
            0x87ceeb, // 9: Glass (Semi-transparent)
        ];

        // Realm State
        this.currentRealm = "overworld";
        this.overworldBlocks = {};
        this.undergroundBlocks = {};
        this.blocks = this.overworldBlocks;
        this.entrancePos = null;
        this.baseGenerated = false;
    }

    create() {
        // Setup a simple grass background map
        this.cameras.main.setBackgroundColor("#4caf50");

        // Create an infinite grid texture dynamically
        let g = this.make.graphics({ x: 0, y: 0, add: false });
        g.fillStyle(0x4caf50, 1); // Solid green
        g.fillRect(0, 0, 64, 64);
        g.lineStyle(2, 0x000000, 0.1);
        g.strokeRect(0, 0, 64, 64);
        g.generateTexture("gridTex", 64, 64);

        // Dirt grid texture for Underground
        let dg = this.make.graphics({ x: 0, y: 0, add: false });
        dg.fillStyle(0x4e342e, 1);
        dg.fillRect(0, 0, 64, 64);
        dg.lineStyle(2, 0x000000, 0.2);
        dg.strokeRect(0, 0, 64, 64);
        dg.generateTexture("dirtGridTex", 64, 64);

        // Particle texture for block breaking
        let pg = this.make.graphics({ x: 0, y: 0, add: false });
        pg.fillStyle(0xffffff, 1);
        pg.fillRect(0, 0, 6, 6);
        pg.generateTexture("particle", 6, 6);

        // Arrow texture for skeleton projectiles
        let ag = this.make.graphics({ x: 0, y: 0, add: false });
        ag.fillStyle(0x8b5a2b, 1);
        ag.fillRect(0, 3, 18, 4);
        ag.fillStyle(0xd8d8d8, 1);
        ag.fillTriangle(18, 1, 24, 5, 18, 9);
        ag.lineStyle(1, 0xffffff, 0.8);
        ag.beginPath();
        ag.moveTo(2, 1);
        ag.lineTo(0, 5);
        ag.lineTo(2, 9);
        ag.strokePath();
        ag.generateTexture("arrowTex", 24, 10);

        // Web texture for spider projectiles
        let wg = this.make.graphics({ x: 0, y: 0, add: false });
        wg.lineStyle(2, 0xddeeff, 1);
        wg.strokeCircle(8, 8, 5);
        wg.lineBetween(3, 8, 13, 8);
        wg.lineBetween(8, 3, 8, 13);
        wg.lineBetween(5, 5, 11, 11);
        wg.lineBetween(11, 5, 5, 11);
        wg.generateTexture("webTex", 16, 16);

        this.loadCustomTextures();

        // Use TileSprite for an infinite background grid that follows the camera
        // Size covers the screen (1080x960)
        // Depth must be extremely low so it renders behind everything (even at negative Y coordinates)
        this.bgGrid = this.add
            .tileSprite(0, 0, 1080, 960, "gridTex")
            .setOrigin(0, 0)
            .setScrollFactor(0)
            .setDepth(-100000);

        // Define Animations
        this.anims.create({
            key: "idle",
            frames: Array.from({ length: this.idleCount }, (_, i) => ({
                key: "customPlayer",
                frame: i,
            })),
            frameRate: 4,
            repeat: -1,
        });

        this.anims.create({
            key: "walk",
            frames: Array.from({ length: this.walkCount }, (_, i) => ({
                key: "customPlayer",
                frame: this.idleCount + i,
            })),
            frameRate: 8,
            repeat: -1,
        });

        // Player Sprite using custom texture from CharacterCreator
        // We scale it up to exactly match 1 background block (16x16 * 4 = 64x64)
        // Spawn exactly at 0, 0
        this.player = this.physics.add.sprite(0, 0, "customPlayer").setScale(4);

        // Shrink Hitbox for 2.5D effect (Bottom half only).
        // Sprite is 16x16 native. Bottom half is width 12, height 8.
        this.player.body.setSize(12, 8);
        this.player.body.setOffset(2, 8);

        // Physics group for solid blocks
        this.blockColliders = this.physics.add.staticGroup();
        this.physics.add.collider(this.player, this.blockColliders);

        // Zombies System
        this.zombies = this.physics.add.group();
        this.physics.add.collider(this.zombies, this.blockColliders);
        this.physics.add.collider(
            this.zombies,
            this.zombies,
            null,
            this.shouldZombiesCollide,
            this,
        ); // Prevent zombies from stacking unless one is being knocked back
        this.physics.add.collider(
            this.player,
            this.zombies,
            this.handleZombieCollision,
            null,
            this,
        );

        // Skeleton Archer System
        this.skeletons = this.physics.add.group();
        this.arrows = this.physics.add.group();
        this.physics.add.collider(this.skeletons, this.blockColliders);
        this.physics.add.collider(
            this.skeletons,
            this.skeletons,
            null,
            this.shouldSkeletonsCollide,
            this,
        );
        this.physics.add.collider(this.arrows, this.blockColliders, (arrow) => {
            this.destroyArrow(arrow);
        });
        this.physics.add.overlap(
            this.player,
            this.arrows,
            this.handleArrowHitPlayer,
            null,
            this,
        );

        // Creeper System
        this.creepers = this.physics.add.group();
        this.physics.add.collider(this.creepers, this.blockColliders);
        this.physics.add.collider(
            this.creepers,
            this.creepers,
            null,
            this.shouldCreepersCollide,
            this,
        );
        this.physics.add.collider(
            this.player,
            this.creepers,
            this.handleZombieCollision,
            null,
            this,
        );

        // Spider System
        this.spiders = this.physics.add.group();
        this.webs = this.physics.add.group();
        this.physics.add.collider(this.spiders, this.blockColliders);
        this.physics.add.collider(
            this.spiders,
            this.spiders,
            null,
            this.shouldSpidersCollide,
            this,
        );
        this.physics.add.collider(this.webs, this.blockColliders, (web) => {
            this.destroyWeb(web);
        });
        this.physics.add.overlap(
            this.player,
            this.webs,
            this.handleWebHitPlayer,
            null,
            this,
        );

        // Player attack cooldown
        this.isAttacking = false;
        this.attackCooldown = false;
        this.attackCooldownTime = 500; // 0.5 seconds between sword attacks
        this.playerFacing = "right";
        this.playerAimAngle = 0;
        this.swordAttackReach = 52;
        this.swordAttackWidth = 76;
        this.swordAttackHeight = 26;

        // Zombie attack settings
        this.zombieAttackRange = 70; // pixels - distance at which zombies stop and attack
        this.zombieAttackCooldown = 1500; // 1.5 seconds between zombie attacks

        // Skeleton attack settings
        this.skeletonAttackRange = 320;
        this.skeletonKeepDistance = 220;
        this.skeletonAttackCooldown = 2200;
        this.skeletonChargeTime = 700;
        this.arrowSpeed = 380;
        this.arrowDamage = 1;

        // Creeper attack settings
        this.creeperTriggerRange = 90;
        this.creeperExplosionRadius = 120;
        this.creeperChargeTime = 1000;
        this.creeperExplosionDamage = 2;

        // Spider attack settings
        this.spiderAttackRange = 260;
        this.spiderKeepDistance = 150;
        this.spiderAttackCooldown = 1800;
        this.webSpeed = 240;

        this.time.addEvent({
            delay: 3000,
            callback: this.spawnZombie,
            callbackScope: this,
            loop: true,
        });

        this.time.addEvent({
            delay: 5000,
            callback: this.spawnSkeleton,
            callbackScope: this,
            loop: true,
        });

        this.time.addEvent({
            delay: 6500,
            callback: this.spawnCreeper,
            callbackScope: this,
            loop: true,
        });

        this.time.addEvent({
            delay: 5500,
            callback: this.spawnSpider,
            callbackScope: this,
            loop: true,
        });

        // Important: use Nearest Neighbor scaling to keep pixels crisp
        this.player.texture.setFilter(Phaser.Textures.FilterMode.NEAREST);

        this.player.anims.play("idle", true);

        // Name text above player
        this.nameText = this.add
            .text(0, 0, this.playerName, {
                fontSize: "20px",
                fill: "#ffffff",
                backgroundColor: "#000000aa",
                padding: { x: 4, y: 2 },
            })
            .setOrigin(0.5, 1);

        // Camera follow with 1, 1 lerp to rigidly lock pixels and prevent blur/jitter
        this.cameras.main.startFollow(this.player, true, 1, 1);

        // WASD Input
        this.keys = this.input.keyboard.addKeys({
            w: Phaser.Input.Keyboard.KeyCodes.W,
            a: Phaser.Input.Keyboard.KeyCodes.A,
            s: Phaser.Input.Keyboard.KeyCodes.S,
            d: Phaser.Input.Keyboard.KeyCodes.D,
        });

        // Number keys for Hotbar (1-9 and 0)
        this.input.keyboard.on("keydown", (event) => {
            if (event.key >= "1" && event.key <= "9") {
                this.currentSlot = parseInt(event.key) - 1;
                this.drawHotbar();
            } else if (event.key === "0") {
                this.currentSlot = 9; // Sword
                this.drawHotbar();
            }
        });

        // Mouse wheel for Hotbar
        this.input.on(
            "wheel",
            (pointer, gameObjects, deltaX, deltaY, deltaZ) => {
                if (deltaY > 0) {
                    this.currentSlot = (this.currentSlot + 1) % 10;
                } else if (deltaY < 0) {
                    this.currentSlot = (this.currentSlot - 1 + 10) % 10;
                }
                this.drawHotbar();
            },
        );

        // Spacebar for interacting (Warping Realms)
        this.input.keyboard.on("keydown-SPACE", () => {
            const gridX = Math.floor(this.player.x / 64);
            const gridY = Math.floor(this.player.y / 64);

            if (
                this.currentRealm === "overworld" &&
                this.entrancePos &&
                this.entrancePos.x === gridX &&
                this.entrancePos.y === gridY
            ) {
                this.switchRealm("underground");
            } else if (
                this.currentRealm === "underground" &&
                gridX === 0 &&
                gridY === 0
            ) {
                this.switchRealm("overworld");
            }
        });

        // Use postupdate event to sync text perfectly with physics body to prevent 1-frame lag (ghosting)
        // Also handle dynamic Depth Sorting for 2.5D and X-Ray block fading
        this.events.on("postupdate", () => {
            if (this.player && this.nameText) {
                this.nameText.setPosition(
                    Math.round(this.player.x),
                    Math.round(this.player.y) - 40,
                );
                this.nameText.setDepth(100000); // Name tag always on top
                this.player.setDepth(this.player.y); // Dynamic depth based on Y position (feet)

                // X-Ray transparency for blocks obscuring the player
                let pDepth = this.player.depth;
                let pLeft = this.player.x - 20;
                let pRight = this.player.x + 20;
                let pTop = this.player.y - 50;
                let pBottom = this.player.y;

                Object.values(this.blocks).forEach((stack) => {
                    stack.forEach((blockObj) => {
                        let c = blockObj.container;
                        let bLeft = c.x;
                        let bRight = c.x + 64;
                        let bTop = c.y - 32; // Block visual spans -32 to 64 now
                        let bBottom = c.y + 64;

                        // Bounding box intersection check
                        if (
                            c.depth > pDepth &&
                            pRight > bLeft &&
                            pLeft < bRight &&
                            pBottom > bTop &&
                            pTop < bBottom
                        ) {
                            c.setAlpha(0.3); // Fade block to see player inside/behind
                        } else {
                            c.setAlpha(1); // Normal opacity
                        }
                    });
                });
            }

            // Draw debug hitboxes
            if (this.hitboxGraphics) {
                this.hitboxGraphics.clear();

                // Player hitbox (red, semi-transparent)
                if (this.player && this.player.body) {
                    let pb = this.player.body;
                    this.hitboxGraphics.lineStyle(2, 0xff0000, 0.8);
                    this.hitboxGraphics.fillStyle(0xff0000, 0.15);
                    this.hitboxGraphics.fillRect(
                        pb.x,
                        pb.y,
                        pb.width,
                        pb.height,
                    );
                    this.hitboxGraphics.strokeRect(
                        pb.x,
                        pb.y,
                        pb.width,
                        pb.height,
                    );

                    // Player attack range circle (green, matches sword reach of 60px + 40px hitbox)
                    if (this.currentSlot === 9) {
                        this.hitboxGraphics.lineStyle(1, 0x00ff00, 0.4);
                        this.hitboxGraphics.strokeCircle(
                            this.player.x,
                            this.player.y,
                            100,
                        );
                    }
                }

                // Zombie hitboxes (red, semi-transparent)
                this.zombies.getChildren().forEach((z) => {
                    if (z && z.body) {
                        let zb = z.body;
                        this.hitboxGraphics.lineStyle(2, 0xff4444, 0.8);
                        this.hitboxGraphics.fillStyle(0xff4444, 0.15);
                        this.hitboxGraphics.fillRect(
                            zb.x,
                            zb.y,
                            zb.width,
                            zb.height,
                        );
                        this.hitboxGraphics.strokeRect(
                            zb.x,
                            zb.y,
                            zb.width,
                            zb.height,
                        );

                        // Zombie attack range circle (orange)
                        this.hitboxGraphics.lineStyle(1, 0xff8800, 0.4);
                        this.hitboxGraphics.strokeCircle(
                            z.x,
                            z.y,
                            this.zombieAttackRange,
                        );
                    }
                });

                // Skeleton hitboxes (blue, semi-transparent)
                this.skeletons.getChildren().forEach((s) => {
                    if (s && s.body) {
                        let sb = s.body;
                        this.hitboxGraphics.lineStyle(2, 0x66ccff, 0.9);
                        this.hitboxGraphics.fillStyle(0x66ccff, 0.15);
                        this.hitboxGraphics.fillRect(
                            sb.x,
                            sb.y,
                            sb.width,
                            sb.height,
                        );
                        this.hitboxGraphics.strokeRect(
                            sb.x,
                            sb.y,
                            sb.width,
                            sb.height,
                        );

                        this.hitboxGraphics.lineStyle(1, 0x00ccff, 0.35);
                        this.hitboxGraphics.strokeCircle(
                            s.x,
                            s.y,
                            this.skeletonAttackRange,
                        );
                    }
                });

                // Arrow hitboxes (cyan)
                this.arrows.getChildren().forEach((arrow) => {
                    if (arrow && arrow.body) {
                        this.hitboxGraphics.lineStyle(2, 0x00ffff, 0.8);
                        this.hitboxGraphics.strokeRect(
                            arrow.body.x,
                            arrow.body.y,
                            arrow.body.width,
                            arrow.body.height,
                        );
                    }
                });

                // Creeper hitboxes (green)
                this.creepers.getChildren().forEach((c) => {
                    if (c && c.body) {
                        let cb = c.body;
                        this.hitboxGraphics.lineStyle(2, 0x66ff66, 0.9);
                        this.hitboxGraphics.fillStyle(0x66ff66, 0.12);
                        this.hitboxGraphics.fillRect(
                            cb.x,
                            cb.y,
                            cb.width,
                            cb.height,
                        );
                        this.hitboxGraphics.strokeRect(
                            cb.x,
                            cb.y,
                            cb.width,
                            cb.height,
                        );

                        this.hitboxGraphics.lineStyle(1, 0x99ff66, 0.35);
                        this.hitboxGraphics.strokeCircle(
                            c.x,
                            c.y,
                            this.creeperTriggerRange,
                        );
                    }
                });

                // Spider hitboxes (purple)
                this.spiders.getChildren().forEach((s) => {
                    if (s && s.body) {
                        let sb = s.body;
                        this.hitboxGraphics.lineStyle(2, 0xaa88ff, 0.9);
                        this.hitboxGraphics.fillStyle(0xaa88ff, 0.12);
                        this.hitboxGraphics.fillRect(
                            sb.x,
                            sb.y,
                            sb.width,
                            sb.height,
                        );
                        this.hitboxGraphics.strokeRect(
                            sb.x,
                            sb.y,
                            sb.width,
                            sb.height,
                        );

                        this.hitboxGraphics.lineStyle(1, 0xccbbff, 0.35);
                        this.hitboxGraphics.strokeCircle(
                            s.x,
                            s.y,
                            this.spiderAttackRange,
                        );
                    }
                });

                this.webs.getChildren().forEach((web) => {
                    if (web && web.body) {
                        this.hitboxGraphics.lineStyle(2, 0xddeeff, 0.85);
                        this.hitboxGraphics.strokeRect(
                            web.body.x,
                            web.body.y,
                            web.body.width,
                            web.body.height,
                        );
                    }
                });

                // Sword attack range hitbox (yellow, only when sword selected)

                if (this.currentSlot === 9 && this.player) {
                    const attackArea = this.getSwordAttackArea();
                    const color = this.attackCooldown ? 0x888888 : 0xffff00;
                    const alpha = this.attackCooldown ? 0.1 : 0.15;
                    const corners = attackArea.corners;

                    this.hitboxGraphics.lineStyle(2, color, 0.8);
                    this.hitboxGraphics.fillStyle(color, alpha);
                    this.hitboxGraphics.beginPath();
                    this.hitboxGraphics.moveTo(corners[0].x, corners[0].y);
                    this.hitboxGraphics.lineTo(corners[1].x, corners[1].y);
                    this.hitboxGraphics.lineTo(corners[2].x, corners[2].y);
                    this.hitboxGraphics.lineTo(corners[3].x, corners[3].y);
                    this.hitboxGraphics.closePath();
                    this.hitboxGraphics.fillPath();
                    this.hitboxGraphics.strokePath();
                }
            }
        });

        // HUD setup
        this.createHUD();

        // Debug Hitbox Graphics
        this.hitboxGraphics = this.add.graphics();
        this.hitboxGraphics.setDepth(999999);
    }

    loadCustomTextures() {
        let collectionDB = JSON.parse(
            localStorage.getItem("pixelArtCollection") || "{}",
        );

        const loadCollectionTexture = (
            data,
            textureKey,
            idleAnimKey,
            walkAnimKey,
        ) => {
            if (!data || !data.idle || !data.walk) return;

            const idleFrames = data.idle.length;
            const walkFrames = data.walk.length;
            const totalFrames = idleFrames + walkFrames;
            const gridSize = 16;

            const canvas = document.createElement("canvas");
            canvas.width = gridSize * totalFrames;
            canvas.height = gridSize;
            const ctx = canvas.getContext("2d");

            let currentDrawFrame = 0;
            const drawAnimToCanvas = (animKey) => {
                data[animKey].forEach((frameData) => {
                    const offsetX = currentDrawFrame * gridSize;
                    for (let y = 0; y < gridSize; y++) {
                        for (let x = 0; x < gridSize; x++) {
                            if (frameData[y][x] !== null) {
                                let hexColor =
                                    "#" +
                                    frameData[y][x]
                                        .toString(16)
                                        .padStart(6, "0");
                                ctx.fillStyle = hexColor;
                                ctx.fillRect(offsetX + x, y, 1, 1);
                            }
                        }
                    }
                    currentDrawFrame++;
                });
            };

            drawAnimToCanvas("idle");
            drawAnimToCanvas("walk");

            if (this.textures.exists(textureKey))
                this.textures.remove(textureKey);
            const tex = this.textures.addCanvas(textureKey, canvas);
            for (let i = 0; i < totalFrames; i++) {
                tex.add(i, 0, i * gridSize, 0, gridSize, gridSize);
            }

            if (!this.anims.exists(idleAnimKey)) {
                this.anims.create({
                    key: idleAnimKey,
                    frames: Array.from({ length: idleFrames }, (_, i) => ({
                        key: textureKey,
                        frame: i,
                    })),
                    frameRate: 4,
                    repeat: -1,
                });
            }
            if (!this.anims.exists(walkAnimKey)) {
                this.anims.create({
                    key: walkAnimKey,
                    frames: Array.from({ length: walkFrames }, (_, i) => ({
                        key: textureKey,
                        frame: idleFrames + i,
                    })),
                    frameRate: 8,
                    repeat: -1,
                });
            }
        };

        loadCollectionTexture(
            collectionDB["Zombie"],
            "customZombie",
            "zombie_idle",
            "zombie_walk",
        );
        loadCollectionTexture(
            collectionDB["Skeliton"] || collectionDB["Skeleton"],
            "customSkeleton",
            "skeleton_idle",
            "skeleton_walk",
        );
        loadCollectionTexture(
            collectionDB["Creeper"],
            "customCreeper",
            "creeper_idle",
            "creeper_walk",
        );
        loadCollectionTexture(
            spiderMonsterData["Spider"],
            "customSpider",
            "spider_idle",
            "spider_walk",
        );
    }

    createHUD() {
        // Text HUD
        const padding = 20;
        this.hudBg = this.add
            .rectangle(padding, padding, 250, 110, 0x000000, 0.6)
            .setOrigin(0, 0)
            .setScrollFactor(0)
            .setDepth(90000);
        this.hudMapText = this.add
            .text(padding + 10, padding + 10, `Map: ${this.currentMap}`, {
                fontSize: "24px",
                fill: "#00ffcc",
                fontStyle: "bold",
            })
            .setScrollFactor(0)
            .setDepth(90001);
        this.hudXText = this.add
            .text(padding + 10, padding + 45, "X: 0", {
                fontSize: "20px",
                fill: "#ffffff",
            })
            .setScrollFactor(0)
            .setDepth(90001);
        this.hudYText = this.add
            .text(padding + 10, padding + 75, "Y: 0", {
                fontSize: "20px",
                fill: "#ffffff",
            })
            .setScrollFactor(0)
            .setDepth(90001);

        // Health UI (Hearts)
        this.hudHearts = this.add
            .text(padding + 10, padding + 115, "", {
                fontSize: "32px",
            })
            .setScrollFactor(0)
            .setDepth(90001);
        this.updateHearts();

        // Initialize Hotbar Graphics (Make sure it renders on top of everything)
        this.hotbarGraphics = this.add
            .graphics()
            .setScrollFactor(0)
            .setDepth(90000);
        this.selectedSlotGraphics = this.add
            .graphics()
            .setScrollFactor(0)
            .setDepth(90001);
        this.cooldownGraphics = this.add
            .graphics()
            .setScrollFactor(0)
            .setDepth(90002);
        this.attackCooldownStart = 0;
        this.drawHotbar();

        // Block Placing / Breaking System
        this.input.mouse.disableContextMenu();

        this.input.on("pointerdown", (pointer) => {
            if (pointer.y > 800) return;

            // Use the calculated target grid from update() instead of raw mouse position!
            // This restricts building to 1 block range in the 9 directions.
            const gridX = this.targetGridX;
            const gridY = this.targetGridY;

            // If target indicator isn't ready yet, abort
            if (gridX === undefined || gridY === undefined) return;

            // Sword Combat
            if (this.currentSlot === 9) {
                if (pointer.leftButtonDown()) {
                    this.performSwordAttack();
                }
                return;
            }

            const key = `${gridX},${gridY}`;

            // OVERWORLD RULES: Only digging holes, no placing blocks
            if (this.currentRealm === "overworld") {
                if (pointer.rightButtonDown() && !this.entrancePos) {
                    this.entrancePos = { x: gridX, y: gridY };
                    this.entranceVisual = this.add
                        .rectangle(
                            gridX * 64 + 32,
                            gridY * 64 + 32,
                            48,
                            48,
                            0x000000,
                        )
                        .setDepth(1);
                    this.entranceText = this.add
                        .text(
                            gridX * 64 + 32,
                            gridY * 64 + 32,
                            "HOLE\n(Space)",
                            {
                                fontSize: "12px",
                                fill: "#fff",
                                align: "center",
                                fontStyle: "bold",
                            },
                        )
                        .setOrigin(0.5)
                        .setDepth(2);

                    let emitter = this.add.particles(
                        gridX * 64 + 32,
                        gridY * 64 + 32,
                        "particle",
                        {
                            speed: 150,
                            scale: { start: 1.5, end: 0 },
                            tint: 0x8b4513,
                            lifespan: 600,
                            quantity: 20,
                            emitting: false,
                        },
                    );
                    emitter.setDepth(10000);
                    emitter.explode();
                    this.time.delayedCall(1000, () => emitter.destroy());
                }
                return; // STOP execution for overworld
            }

            // UNDERGROUND RULES: Placing and Breaking Allowed
            if (!this.blocks[key]) this.blocks[key] = [];
            let stack = this.blocks[key];

            if (pointer.rightButtonDown()) {
                if (stack.length > 0) {
                    let blockObj = stack.pop();
                    let burstColor = blockObj.color || 0xffffff;
                    let emitter = this.add.particles(
                        blockObj.container.x + 32,
                        blockObj.container.y,
                        "particle",
                        {
                            speed: { min: 100, max: 300 },
                            angle: { min: 200, max: 340 },
                            gravityY: 600,
                            scale: { start: 1.5, end: 0 },
                            tint: burstColor,
                            lifespan: 500,
                            quantity: 15,
                            emitting: false,
                        },
                    );
                    emitter.setDepth(10000);
                    emitter.explode();
                    this.time.delayedCall(1000, () => {
                        emitter.destroy();
                    });

                    blockObj.container.destroy();
                    if (blockObj.collider) blockObj.collider.destroy();

                    // Infinite Underground Generation: Spawn thick walls around mined area
                    if (this.currentRealm === "underground") {
                        this.spawnUndergroundWall(gridX, gridY);
                    }
                }
            } else if (pointer.leftButtonDown()) {
                if (stack.length > 0) return; // Prevent stacking blocks! Max 1 block per tile.

                let z = stack.length; // Will always be 0 now
                let color = this.blockColors[this.currentSlot];
                this.createBlockVisuals(
                    gridX,
                    gridY,
                    z,
                    this.currentSlot,
                    stack,
                    color,
                );
            }
        });
    }

    createBlockVisuals(gridX, gridY, z, slotIndex, stack, color) {
        let alpha = slotIndex === 8 ? 0.6 : 1;

        let renderY = gridY * 64; // z is always 0 now
        let container = this.add.container(gridX * 64, renderY);
        container.setDepth((gridY + 1) * 64 + z);

        let topColor = color;
        let frontColor =
            Phaser.Display.Color.ValueToColor(color).darken(40).color;
        let extras = [];

        // Cave wall styling for Dirt in the Underground
        if (color === 0x8b4513 && this.currentRealm === "underground") {
            topColor = 0x080808; // Pitch black roof
            frontColor = 0x5c3a21; // Dark dirt brown wall
        }

        if (slotIndex === 1) {
            frontColor =
                Phaser.Display.Color.ValueToColor(0x8b4513).darken(40).color;
            let drip = this.add.graphics();
            drip.fillStyle(color, 1);
            drip.fillRect(0, 32, 64, 8); // Top edge is now at y=32
            drip.fillRect(4, 40, 12, 6);
            drip.fillRect(24, 40, 16, 8);
            drip.fillRect(48, 40, 10, 4);
            extras.push(drip);
        } else if (slotIndex === 3) {
            let lines = this.add.graphics();
            lines.lineStyle(2, 0x000000, 0.2);
            lines.beginPath();
            lines.moveTo(16, -32);
            lines.lineTo(16, 64);
            lines.moveTo(32, -32);
            lines.lineTo(32, 64);
            lines.moveTo(48, -32);
            lines.lineTo(48, 64);
            lines.strokePath();
            extras.push(lines);
        } else if (slotIndex === 8) {
            let shiny = this.add.graphics();
            shiny.lineStyle(6, 0xffffff, 0.4);
            shiny.beginPath();
            shiny.moveTo(10, -20);
            shiny.lineTo(30, 0);
            shiny.moveTo(15, -25);
            shiny.lineTo(40, 0);
            shiny.strokePath();
            extras.push(shiny);
        }

        let shadow = this.add
            .rectangle(8, 40, 64, 64, 0x000000, 0.3)
            .setOrigin(0, 0);

        // Front Face (height is 32, filling from y=32 to y=64)
        let front = this.add
            .rectangle(0, 32, 64, 32, frontColor, alpha)
            .setOrigin(0, 0);
        // Top Face (height 64, extending UP from y=-32 to y=32)
        let top = this.add
            .rectangle(0, -32, 64, 64, topColor, alpha)
            .setOrigin(0, 0);

        let highlight = this.add
            .rectangle(2, -30, 60, 60, 0xffffff, 0)
            .setOrigin(0, 0);

        if (color === 0x8b4513 && this.currentRealm === "underground") {
            highlight.setStrokeStyle(0); // No highlight for cave walls to make them look like a solid mass
        } else {
            highlight.setStrokeStyle(2, 0xffffff, 0.2);
        }

        front.setStrokeStyle(1, 0x000000, 0.5);
        top.setStrokeStyle(1, 0x000000, 0.5);

        container.add([shadow, front, top, ...extras, highlight]);

        container.setScale(0);
        this.tweens.add({
            targets: container,
            scaleX: 1,
            scaleY: 1,
            ease: "Back.out",
            duration: 300,
        });

        let collider = null;
        if (z === 0) {
            collider = this.add.rectangle(
                gridX * 64 + 32,
                gridY * 64 + 32,
                64,
                64,
                0x000000,
                0,
            );
            this.blockColliders.add(collider);
        }

        stack.push({ container: container, collider: collider, color: color });
    }

    spawnUndergroundWall(gx, gy) {
        // Radius 12 ensures the cave walls completely fill the screen beyond the mined area!
        for (let x = gx - 12; x <= gx + 12; x++) {
            for (let y = gy - 12; y <= gy + 12; y++) {
                let key = `${x},${y}`;
                if (this.undergroundBlocks[key] === undefined) {
                    this.undergroundBlocks[key] = [];
                    // Spawn Cave Wall (Dirt)
                    this.createBlockVisuals(
                        x,
                        y,
                        0,
                        0,
                        this.undergroundBlocks[key],
                        0x8b4513,
                    );
                }
            }
        }
    }

    generateUndergroundBase() {
        // 1. Explicitly carve out the 5x5 empty starting room
        for (let x = -2; x <= 2; x++) {
            for (let y = -2; y <= 2; y++) {
                let key = `${x},${y}`;
                this.undergroundBlocks[key] = []; // Mark as empty/visited space
            }
        }

        // 2. Spawn the surrounding thick shell to fill the screen
        this.spawnUndergroundWall(0, 0);
    }

    switchRealm(realm) {
        // Hide old realm
        Object.values(this.blocks).forEach((stack) =>
            stack.forEach((b) => b.container.setVisible(false)),
        );
        this.blockColliders.clear(true, true);
        if (this.entranceVisual) this.entranceVisual.setVisible(false);
        if (this.entranceText) this.entranceText.setVisible(false);
        if (this.ladderVisual) this.ladderVisual.setVisible(false);
        if (this.ladderText) this.ladderText.setVisible(false);

        if (realm === "underground") {
            this.currentRealm = "underground";
            this.blocks = this.undergroundBlocks;
            this.cameras.main.setBackgroundColor("#3e2723");
            this.bgGrid.setTexture("dirtGridTex");
            this.currentMap = "Underground Base";

            if (!this.baseGenerated) {
                this.generateUndergroundBase();
                this.baseGenerated = true;
                this.ladderVisual = this.add
                    .rectangle(32, 32, 48, 48, 0x8b4513)
                    .setDepth(1);
                this.ladderText = this.add
                    .text(32, 32, "LADDER\n(Space)", {
                        fontSize: "12px",
                        fill: "#fff",
                        align: "center",
                        fontStyle: "bold",
                    })
                    .setOrigin(0.5)
                    .setDepth(2);
            }
            this.ladderVisual.setVisible(true);
            this.ladderText.setVisible(true);

            this.player.setPosition(32, 32);
        } else {
            this.currentRealm = "overworld";
            this.blocks = this.overworldBlocks;
            this.cameras.main.setBackgroundColor("#4caf50");
            this.bgGrid.setTexture("gridTex");
            this.currentMap = "Spawn Area";

            if (this.entranceVisual) this.entranceVisual.setVisible(true);
            if (this.entranceText) this.entranceText.setVisible(true);
            if (this.entrancePos) {
                this.player.setPosition(
                    this.entrancePos.x * 64 + 32,
                    this.entrancePos.y * 64 + 32,
                );
            }
        }
        this.hudMapText.setText(`Map: ${this.currentMap}`);

        // Show new realm
        Object.entries(this.blocks).forEach(([key, stack]) => {
            stack.forEach((b, index) => {
                b.container.setVisible(true);
                if (index === 0) {
                    if (b.collider) b.collider.destroy(); // Fix orphaned collider bug!
                    let [gx, gy] = key.split(",").map(Number);
                    let collider = this.add.rectangle(
                        gx * 64 + 32,
                        gy * 64 + 32,
                        64,
                        64,
                        0x000000,
                        0,
                    );
                    this.blockColliders.add(collider);
                    b.collider = collider;
                }
            });
        });
    }

    updateHearts() {
        if (!this.hudHearts) return;
        let heartStr = "";
        for (let i = 0; i < this.maxHealth; i++) {
            if (i < this.health) heartStr += "❤️";
            else heartStr += "🖤";
        }
        this.hudHearts.setText(heartStr);
    }

    damagePlayer(amount) {
        if (this.isInvincible) return;

        this.health -= amount;
        this.updateHearts();

        if (this.health <= 0) {
            this.respawnPlayer();
            return;
        }

        // Invincibility Frames
        this.isInvincible = true;
        this.player.setTint(0xff0000); // Flashing red

        let flashInterval = setInterval(() => {
            if (!this.player || !this.player.scene)
                return clearInterval(flashInterval);
            this.player.isTinted
                ? this.player.clearTint()
                : this.player.setTint(0xff0000);
        }, 100);

        this.time.delayedCall(1000, () => {
            clearInterval(flashInterval);
            if (this.player && this.player.scene) this.player.clearTint();
            this.isInvincible = false;
        });
    }

    respawnPlayer() {
        this.health = this.maxHealth;
        this.updateHearts();
        this.player.setPosition(0, 0);
        this.player.clearTint();
        this.isInvincible = false;

        if (this.currentRealm === "underground") {
            this.switchRealm("overworld");
        }
    }

    spawnZombie() {
        // Cap zombies
        if (this.zombies.getChildren().length >= 10) return;

        // Spawn randomly outside player view
        let angle = Math.random() * Math.PI * 2;
        let dist = 600 + Math.random() * 200;
        let x = this.player.x + Math.cos(angle) * dist;
        let y = this.player.y + Math.sin(angle) * dist;

        let z;
        if (this.textures.exists("customZombie")) {
            // Use user-drawn custom zombie
            z = this.physics.add.sprite(x, y, "customZombie").setScale(4);
            z.texture.setFilter(Phaser.Textures.FilterMode.NEAREST);
            z.body.setSize(12, 8);
            z.body.setOffset(2, 8);
            z.anims.play("zombie_walk", true);
            z.isSprite = true;
        } else {
            // Create a green block zombie fallback
            z = this.add.rectangle(x, y, 48, 48, 0x00ff00).setOrigin(0.5, 1);
            z.setStrokeStyle(4, 0x005500);
            this.physics.add.existing(z);
            z.body.setSize(32, 32);
            z.body.setOffset(8, 16);
            z.isSprite = false;
        }

        z.health = 3;
        z.lastAttackTime = 0; // Cooldown tracker for zombie attacks
        z.isAttacking = false;
        z.isKnockedBack = false;
        z.enemyType = "zombie";

        this.zombies.add(z);
    }

    spawnSkeleton() {
        if (this.skeletons.getChildren().length >= 6) return;

        let angle = Math.random() * Math.PI * 2;
        let dist = 650 + Math.random() * 180;
        let x = this.player.x + Math.cos(angle) * dist;
        let y = this.player.y + Math.sin(angle) * dist;

        let s;
        if (this.textures.exists("customSkeleton")) {
            s = this.physics.add.sprite(x, y, "customSkeleton").setScale(4);
            s.texture.setFilter(Phaser.Textures.FilterMode.NEAREST);
            s.body.setSize(12, 8);
            s.body.setOffset(2, 8);
            if (this.anims.exists("skeleton_walk")) {
                s.anims.play("skeleton_walk", true);
            }
            s.isSprite = true;
        } else {
            s = this.add.rectangle(x, y, 48, 48, 0xf5f5dc).setOrigin(0.5, 1);
            s.setStrokeStyle(4, 0x999999);
            this.physics.add.existing(s);
            s.body.setSize(32, 32);
            s.body.setOffset(8, 16);
            s.isSprite = false;
        }

        s.health = 2;
        s.lastAttackTime = 0;
        s.isChargingShot = false;
        s.isKnockedBack = false;
        s.enemyType = "skeleton";

        this.skeletons.add(s);
    }

    spawnCreeper() {
        if (this.creepers.getChildren().length >= 5) return;

        let angle = Math.random() * Math.PI * 2;
        let dist = 620 + Math.random() * 160;
        let x = this.player.x + Math.cos(angle) * dist;
        let y = this.player.y + Math.sin(angle) * dist;

        let c;
        if (this.textures.exists("customCreeper")) {
            c = this.physics.add.sprite(x, y, "customCreeper").setScale(4);
            c.texture.setFilter(Phaser.Textures.FilterMode.NEAREST);
            c.body.setSize(12, 8);
            c.body.setOffset(2, 8);
            if (this.anims.exists("creeper_walk")) {
                c.anims.play("creeper_walk", true);
            }
            c.isSprite = true;
        } else {
            c = this.add.rectangle(x, y, 48, 48, 0x55ff55).setOrigin(0.5, 1);
            c.setStrokeStyle(4, 0x116611);
            this.physics.add.existing(c);
            c.body.setSize(32, 32);
            c.body.setOffset(8, 16);
            c.isSprite = false;
        }

        c.health = 3;
        c.isChargingExplosion = false;
        c.isKnockedBack = false;
        c.enemyType = "creeper";
        c.chargeFlashEvent = null;
        c.explodeEvent = null;

        this.creepers.add(c);
    }

    spawnSpider() {
        if (this.spiders.getChildren().length >= 6) return;

        let angle = Math.random() * Math.PI * 2;
        let dist = 620 + Math.random() * 160;
        let x = this.player.x + Math.cos(angle) * dist;
        let y = this.player.y + Math.sin(angle) * dist;

        let s;
        if (this.textures.exists("customSpider")) {
            s = this.physics.add.sprite(x, y, "customSpider").setScale(4);
            s.texture.setFilter(Phaser.Textures.FilterMode.NEAREST);
            s.body.setSize(12, 8);
            s.body.setOffset(2, 8);
            if (this.anims.exists("spider_walk")) {
                s.anims.play("spider_walk", true);
            }
            s.isSprite = true;
        } else {
            s = this.add.rectangle(x, y, 48, 40, 0x442244).setOrigin(0.5, 1);
            s.setStrokeStyle(4, 0xaa0000);
            this.physics.add.existing(s);
            s.body.setSize(32, 28);
            s.body.setOffset(8, 12);
            s.isSprite = false;
        }

        s.health = 2;
        s.lastAttackTime = 0;
        s.isKnockedBack = false;
        s.enemyType = "spider";

        this.spiders.add(s);
    }

    shouldZombiesCollide(zombieA, zombieB) {
        if (!zombieA.body || !zombieB.body) return false;
        return !zombieA.isKnockedBack && !zombieB.isKnockedBack;
    }

    shouldSkeletonsCollide(skeletonA, skeletonB) {
        if (!skeletonA.body || !skeletonB.body) return false;
        return !skeletonA.isKnockedBack && !skeletonB.isKnockedBack;
    }

    shouldCreepersCollide(creeperA, creeperB) {
        if (!creeperA.body || !creeperB.body) return false;
        return !creeperA.isKnockedBack && !creeperB.isKnockedBack;
    }

    shouldSpidersCollide(spiderA, spiderB) {
        if (!spiderA.body || !spiderB.body) return false;
        return !spiderA.isKnockedBack && !spiderB.isKnockedBack;
    }

    handleZombieCollision(player, zombie) {
        // Collision pushes player away gently but does NOT deal damage
        // Damage is dealt by zombie attack timer instead
        let angle = Phaser.Math.Angle.Between(
            zombie.x,
            zombie.y,
            player.x,
            player.y,
        );
        player.body.velocity.x += Math.cos(angle) * 300;
        player.body.velocity.y += Math.sin(angle) * 300;
    }

    zombieAttack(zombie) {
        if (!zombie || !zombie.scene || !zombie.body) return;
        if (this.isInvincible) return;

        let dist = Phaser.Math.Distance.Between(
            zombie.x,
            zombie.y,
            this.player.x,
            this.player.y,
        );
        if (dist > this.zombieAttackRange + 20) return; // Out of range, cancel attack

        // Visual attack indicator
        let attackEmoji = this.add
            .text(zombie.x, zombie.y - 50, "👊", { fontSize: "32px" })
            .setOrigin(0.5)
            .setDepth(100000);
        this.tweens.add({
            targets: attackEmoji,
            y: attackEmoji.y - 30,
            alpha: 0,
            duration: 400,
            onComplete: () => attackEmoji.destroy(),
        });

        // Flash zombie red briefly when attacking
        if (zombie.isSprite) {
            zombie.setTint(0xff4444);
            this.time.delayedCall(200, () => {
                if (zombie.scene) zombie.clearTint();
            });
        }

        // Strong knockback - player slides away!
        let angle = Phaser.Math.Angle.Between(
            zombie.x,
            zombie.y,
            this.player.x,
            this.player.y,
        );
        this.player.body.velocity.x = Math.cos(angle) * 800;
        this.player.body.velocity.y = Math.sin(angle) * 800;
        this.isKnockedBack = true;

        this.damagePlayer(1);
    }

    skeletonAttack(skeleton) {
        if (!skeleton || !skeleton.scene || !skeleton.body) return;
        if (skeleton.isChargingShot || skeleton.isKnockedBack) return;

        let dist = Phaser.Math.Distance.Between(
            skeleton.x,
            skeleton.y,
            this.player.x,
            this.player.y,
        );
        if (dist > this.skeletonAttackRange + 20) return;

        skeleton.isChargingShot = true;
        skeleton.body.velocity.x = 0;
        skeleton.body.velocity.y = 0;
        skeleton.aimAngle = Phaser.Math.Angle.Between(
            skeleton.x,
            skeleton.y,
            this.player.x,
            this.player.y,
        );

        if (skeleton.isSprite && this.anims.exists("skeleton_idle")) {
            skeleton.anims.play("skeleton_idle", true);
        }

        if (skeleton.isSprite) {
            if (Math.cos(skeleton.aimAngle) < 0) skeleton.setFlipX(true);
            else if (Math.cos(skeleton.aimAngle) > 0) skeleton.setFlipX(false);
        }

        let chargeText = this.add
            .text(skeleton.x, skeleton.y - 56, "🏹", { fontSize: "28px" })
            .setOrigin(0.5)
            .setDepth(100000);

        this.tweens.add({
            targets: chargeText,
            alpha: 0.2,
            yoyo: true,
            repeat: 2,
            duration: Math.max(120, Math.floor(this.skeletonChargeTime / 3)),
        });

        this.time.delayedCall(this.skeletonChargeTime, () => {
            if (!skeleton.scene || !skeleton.body) {
                chargeText.destroy();
                return;
            }

            chargeText.destroy();
            skeleton.isChargingShot = false;

            const shotAngle = skeleton.aimAngle;
            const dirX = Math.cos(shotAngle);
            const dirY = Math.sin(shotAngle);

            const arrow = this.physics.add
                .image(
                    skeleton.x + dirX * 28,
                    skeleton.y - 18 + dirY * 28,
                    "arrowTex",
                )
                .setDepth(99999)
                .setRotation(shotAngle);
            arrow.body.setAllowGravity(false);
            arrow.body.setSize(24, 10);
            arrow.body.setEnable(true);
            arrow.setVelocity(dirX * this.arrowSpeed, dirY * this.arrowSpeed);
            arrow.spawnTime = this.time.now;
            arrow.directionX = dirX;
            arrow.directionY = dirY;
            this.arrows.add(arrow);
        });
    }

    destroyArrow(arrow) {
        if (arrow && arrow.scene) arrow.destroy();
    }

    handleArrowHitPlayer(player, arrow) {
        this.destroyArrow(arrow);
        this.damagePlayer(this.arrowDamage);
    }

    spiderAttack(spider) {
        if (!spider || !spider.scene || !spider.body || spider.isKnockedBack)
            return;

        const shotAngle = Phaser.Math.Angle.Between(
            spider.x,
            spider.y,
            this.player.x,
            this.player.y,
        );
        const dirX = Math.cos(shotAngle);
        const dirY = Math.sin(shotAngle);

        const web = this.physics.add
            .image(spider.x + dirX * 24, spider.y - 8 + dirY * 24, "webTex")
            .setDepth(99999)
            .setRotation(shotAngle);
        web.body.setAllowGravity(false);
        web.body.setSize(16, 16);
        web.setVelocity(dirX * this.webSpeed, dirY * this.webSpeed);
        web.spawnTime = this.time.now;
        web.directionX = dirX;
        web.directionY = dirY;
        this.webs.add(web);

        let webText = this.add
            .text(spider.x, spider.y - 42, "🕸️", { fontSize: "24px" })
            .setOrigin(0.5)
            .setDepth(100000);
        this.tweens.add({
            targets: webText,
            y: webText.y - 16,
            alpha: 0,
            duration: 350,
            onComplete: () => webText.destroy(),
        });
    }

    destroyWeb(web) {
        if (web && web.scene) web.destroy();
    }

    handleWebHitPlayer(player, web) {
        this.destroyWeb(web);
        this.webSlowUntil = this.time.now + this.webSlowDuration;
    }

    startCreeperCharge(creeper) {
        if (
            !creeper ||
            !creeper.scene ||
            !creeper.body ||
            creeper.isChargingExplosion
        ) {
            return;
        }

        creeper.isChargingExplosion = true;
        creeper.body.velocity.x = 0;
        creeper.body.velocity.y = 0;

        const applyFlashState = () => {
            if (!creeper.scene) return;
            creeper.flashWhite = !creeper.flashWhite;
            if (creeper.isSprite) {
                if (creeper.flashWhite) {
                    creeper
                        .setTint(0xffffff)
                        .setTintMode(Phaser.TintModes.FILL);
                } else {
                    creeper.clearTint();
                }
            } else {
                creeper.setFillStyle(creeper.flashWhite ? 0xffffff : 0x55ff55);
            }
        };

        creeper.flashWhite = false;
        applyFlashState();
        creeper.chargeFlashEvent = this.time.addEvent({
            delay: 100,
            callback: applyFlashState,
            callbackScope: this,
            loop: true,
        });

        creeper.explodeEvent = this.time.delayedCall(
            this.creeperChargeTime,
            () => {
                this.explodeCreeper(creeper);
            },
        );
    }

    resetCreeperCharge(creeper) {
        if (!creeper) return;
        creeper.isChargingExplosion = false;
        creeper.flashWhite = false;

        if (creeper.chargeFlashEvent) {
            creeper.chargeFlashEvent.remove(false);
            creeper.chargeFlashEvent = null;
        }
        if (creeper.explodeEvent) {
            creeper.explodeEvent.remove(false);
            creeper.explodeEvent = null;
        }

        if (creeper.scene) {
            if (creeper.isSprite) creeper.clearTint();
            else creeper.setFillStyle(0x55ff55);
        }
    }

    explodeCreeper(creeper) {
        if (!creeper || !creeper.scene || !creeper.body) return;

        this.resetCreeperCharge(creeper);

        let boom = this.add
            .text(creeper.x, creeper.y - 20, "💥", { fontSize: "54px" })
            .setOrigin(0.5)
            .setDepth(100000);
        this.tweens.add({
            targets: boom,
            scaleX: 1.5,
            scaleY: 1.5,
            alpha: 0,
            duration: 250,
            onComplete: () => boom.destroy(),
        });

        const dist = Phaser.Math.Distance.Between(
            creeper.x,
            creeper.y,
            this.player.x,
            this.player.y,
        );

        if (dist <= this.creeperExplosionRadius) {
            const angle = Phaser.Math.Angle.Between(
                creeper.x,
                creeper.y,
                this.player.x,
                this.player.y,
            );
            this.player.body.velocity.x = Math.cos(angle) * 900;
            this.player.body.velocity.y = Math.sin(angle) * 900;
            this.isKnockedBack = true;
            this.damagePlayer(this.creeperExplosionDamage);
        }

        creeper.destroy();
    }

    getFacingDirectionFromVector(dx, dy) {
        if (Math.abs(dx) < 0.001 && Math.abs(dy) < 0.001) {
            return this.playerFacing || "right";
        }

        let angle = (Math.atan2(dy, dx) * 180) / Math.PI;
        if (angle < 0) angle += 360;

        if (angle >= 315 || angle < 45) return "right";
        if (angle >= 45 && angle < 135) return "down";
        if (angle >= 135 && angle < 225) return "left";
        return "up";
    }

    getSwordAttackArea() {
        const angle = this.playerAimAngle || 0;
        const width = this.swordAttackWidth;
        const height = this.swordAttackHeight;
        const centerX = this.player.x + Math.cos(angle) * this.swordAttackReach;
        const centerY = this.player.y + Math.sin(angle) * this.swordAttackReach;
        const halfWidth = width / 2;
        const halfHeight = height / 2;
        const cos = Math.cos(angle);
        const sin = Math.sin(angle);

        const corners = [
            { x: -halfWidth, y: -halfHeight },
            { x: halfWidth, y: -halfHeight },
            { x: halfWidth, y: halfHeight },
            { x: -halfWidth, y: halfHeight },
        ].map((point) => ({
            x: centerX + point.x * cos - point.y * sin,
            y: centerY + point.x * sin + point.y * cos,
        }));

        return {
            angle,
            centerX,
            centerY,
            width,
            height,
            halfWidth,
            halfHeight,
            cos,
            sin,
            corners,
        };
    }

    isEnemyInsideSwordAttack(enemy, attackArea) {
        const halfEnemyWidth = enemy.isSprite ? 32 : 24;
        const halfEnemyHeight = enemy.isSprite ? 32 : 24;
        const dx = enemy.x - attackArea.centerX;
        const dy = enemy.y - attackArea.centerY;

        const localX = dx * attackArea.cos + dy * attackArea.sin;
        const localY = -dx * attackArea.sin + dy * attackArea.cos;

        const projectedHalfWidth =
            Math.abs(attackArea.cos) * halfEnemyWidth +
            Math.abs(attackArea.sin) * halfEnemyHeight;
        const projectedHalfHeight =
            Math.abs(attackArea.sin) * halfEnemyWidth +
            Math.abs(attackArea.cos) * halfEnemyHeight;

        return (
            Math.abs(localX) <= attackArea.halfWidth + projectedHalfWidth &&
            Math.abs(localY) <= attackArea.halfHeight + projectedHalfHeight
        );
    }

    damageEnemyWithSword(enemy, attackArea) {
        enemy.health--;

        if (enemy.enemyType === "creeper") {
            this.resetCreeperCharge(enemy);
        }

        if (enemy.isSprite) {
            enemy.setTint(0xffffff);
            this.time.delayedCall(100, () => {
                if (enemy.scene) enemy.clearTint();
            });
        } else {
            enemy.setFillStyle(0xffffff);
            this.time.delayedCall(100, () => {
                if (enemy.scene && enemy.enemyType === "zombie") {
                    enemy.setFillStyle(0x00ff00);
                } else if (enemy.scene && enemy.enemyType === "skeleton") {
                    enemy.setFillStyle(0xf5f5dc);
                } else if (enemy.scene && enemy.enemyType === "creeper") {
                    enemy.setFillStyle(0x55ff55);
                } else if (enemy.scene && enemy.enemyType === "spider") {
                    enemy.setFillStyle(0x442244);
                }
            });
        }

        enemy.isKnockedBack = true;

        if (enemy.enemyType === "skeleton") enemy.isChargingShot = false;

        enemy.body.velocity.x = Math.cos(attackArea.angle) * 1000;
        enemy.body.velocity.y = Math.sin(attackArea.angle) * 1000;

        this.time.delayedCall(150, () => {
            if (enemy.scene && enemy.body) {
                enemy.body.velocity.x = 0;
                enemy.body.velocity.y = 0;
                enemy.isKnockedBack = false;
            }
        });

        if (enemy.health <= 0) {
            enemy.destroy();
        }
    }

    performSwordAttack() {
        if (this.isAttacking || this.attackCooldown) return;
        this.isAttacking = true;
        this.attackCooldown = true;
        this.attackCooldownStart = this.time.now; // Track for visual bar

        const attackArea = this.getSwordAttackArea();
        const tx = attackArea.centerX;
        const ty = attackArea.centerY;

        // Visual slash effect
        let slash = this.add
            .text(tx, ty, "🗡️", { fontSize: "34px" })
            .setOrigin(0.5)
            .setDepth(100000)
            .setRotation(attackArea.angle);

        this.zombies.getChildren().forEach((z) => {
            if (this.isEnemyInsideSwordAttack(z, attackArea)) {
                this.damageEnemyWithSword(z, attackArea);
            }
        });

        this.skeletons.getChildren().forEach((s) => {
            if (this.isEnemyInsideSwordAttack(s, attackArea)) {
                this.damageEnemyWithSword(s, attackArea);
            }
        });

        this.creepers.getChildren().forEach((c) => {
            if (this.isEnemyInsideSwordAttack(c, attackArea)) {
                this.damageEnemyWithSword(c, attackArea);
            }
        });

        this.spiders.getChildren().forEach((s) => {
            if (this.isEnemyInsideSwordAttack(s, attackArea)) {
                this.damageEnemyWithSword(s, attackArea);
            }
        });

        // Swing animation finishes quickly
        this.time.delayedCall(200, () => {
            slash.destroy();
            this.isAttacking = false;
        });

        // Cooldown prevents spamming
        this.time.delayedCall(this.attackCooldownTime, () => {
            this.attackCooldown = false;
        });
    }

    drawHotbar() {
        this.hotbarGraphics.clear();
        this.selectedSlotGraphics.clear();

        const innerSize = 80; // Size of the dark inside
        const border = 8; // Grey border thickness

        const totalWidth = 10 * innerSize + 11 * border;
        const totalHeight = innerSize + 2 * border;
        const startX = (1080 - totalWidth) / 2;
        const startY = 960 - totalHeight - 20; // Back to bottom of screen

        // Black outline for the entire hotbar
        this.hotbarGraphics.fillStyle(0x000000, 1);
        this.hotbarGraphics.fillRect(
            startX - 4,
            startY - 4,
            totalWidth + 8,
            totalHeight + 8,
        );

        // Grey Background of entire hotbar (border color)
        this.hotbarGraphics.fillStyle(0x8b8b8b, 0.9);
        this.hotbarGraphics.fillRect(startX, startY, totalWidth, totalHeight);

        // Inner slots
        for (let i = 0; i < 10; i++) {
            let x = startX + border + i * (innerSize + border);
            let y = startY + border;

            // Inside of slot (dark grey)
            this.hotbarGraphics.fillStyle(0x3b3b3b, 1);
            this.hotbarGraphics.fillRect(x, y, innerSize, innerSize);

            // Draw miniature block icon inside the slot
            if (i < 9) {
                let blockSize = 48; // Size of the block icon inside the 80px slot
                let offset = (innerSize - blockSize) / 2;
                let blockColor = this.blockColors[i];
                let blockAlpha = i === 8 ? 0.6 : 1; // Glass

                this.hotbarGraphics.fillStyle(blockColor, blockAlpha);
                this.hotbarGraphics.fillRect(
                    x + offset,
                    y + offset,
                    blockSize,
                    blockSize,
                );
                // Black outline for the miniature block
                this.hotbarGraphics.lineStyle(4, 0x000000, 0.8);
                this.hotbarGraphics.strokeRect(
                    x + offset,
                    y + offset,
                    blockSize,
                    blockSize,
                );
            } else {
                // Slot 9 (10th slot) is the Sword
                // We'll draw a text icon using a scene text object.
                // Note: Texts should be updated only when created/changed, but for simplicity we'll just clear old ones.
                if (!this.swordIcon) {
                    this.swordIcon = this.add
                        .text(0, 0, "⚔️", { fontSize: "48px" })
                        .setOrigin(0.5)
                        .setScrollFactor(0)
                        .setDepth(90001);
                }
                this.swordIcon.setPosition(
                    x + innerSize / 2,
                    y + innerSize / 2,
                );
            }

            // Thin inner shadow/black border for depth (top and left inside)
            this.hotbarGraphics.fillStyle(0x111111, 0.8);
            this.hotbarGraphics.fillRect(x, y, innerSize, 4); // Top
            this.hotbarGraphics.fillRect(x, y, 4, innerSize); // Left
        }

        // Draw selected slot highlight
        let selX = startX + border + this.currentSlot * (innerSize + border);
        let selY = startY + border;

        // Outer black border for selection
        this.selectedSlotGraphics.lineStyle(12, 0x000000, 1);
        this.selectedSlotGraphics.strokeRect(
            selX - 6,
            selY - 6,
            innerSize + 12,
            innerSize + 12,
        );

        // Thick white border slightly outside the inner bounds
        this.selectedSlotGraphics.lineStyle(8, 0xffffff, 1); // Thicker outline
        this.selectedSlotGraphics.strokeRect(
            selX - 4,
            selY - 4,
            innerSize + 8,
            innerSize + 8,
        );
    }

    updateCooldownBar() {
        if (!this.cooldownGraphics) return;
        this.cooldownGraphics.clear();

        if (!this.attackCooldown) return; // No cooldown active, nothing to draw

        const innerSize = 80;
        const border = 8;
        const totalWidth = 10 * innerSize + 11 * border;
        const startX = (1080 - totalWidth) / 2;
        const startY = 960 - (innerSize + 2 * border) - 20;

        // Sword slot is index 9
        let slotX = startX + border + 9 * (innerSize + border);
        let slotY = startY + border;

        // Calculate progress (0 to 1)
        let elapsed = this.time.now - this.attackCooldownStart;
        let progress = Math.min(elapsed / this.attackCooldownTime, 1);

        // Dark overlay on the entire slot
        this.cooldownGraphics.fillStyle(0x000000, 0.6);
        this.cooldownGraphics.fillRect(slotX, slotY, innerSize, innerSize);

        // Charging bar fills from BOTTOM to TOP
        let barHeight = Math.floor(innerSize * progress);
        let barY = slotY + (innerSize - barHeight);

        // Gradient-like effect: color shifts from red → yellow → cyan as it charges
        let r, g, b;
        if (progress < 0.5) {
            // Red to Yellow
            r = 255;
            g = Math.floor(255 * (progress * 2));
            b = 0;
        } else {
            // Yellow to Cyan
            r = Math.floor(255 * (1 - (progress - 0.5) * 2));
            g = 255;
            b = Math.floor(255 * ((progress - 0.5) * 2));
        }
        let barColor = (r << 16) | (g << 8) | b;

        this.cooldownGraphics.fillStyle(barColor, 0.7);
        this.cooldownGraphics.fillRect(
            slotX + 4,
            barY,
            innerSize - 8,
            barHeight,
        );

        // Bright outline on the charging bar
        this.cooldownGraphics.lineStyle(2, barColor, 1);
        this.cooldownGraphics.strokeRect(
            slotX + 4,
            barY,
            innerSize - 8,
            barHeight,
        );

        // When fully charged, show a brief glow flash (progress reaches 1 right before cooldown resets)
        if (progress >= 0.95) {
            this.cooldownGraphics.fillStyle(
                0xffffff,
                0.3 * Math.sin(this.time.now * 0.02),
            );
            this.cooldownGraphics.fillRect(slotX, slotY, innerSize, innerSize);
        }
    }

    update() {
        const baseSpeed = 300;
        const isWebSlowed = this.time.now < this.webSlowUntil;
        const speed = isWebSlowed ? baseSpeed * this.webSlowFactor : baseSpeed;
        let vx = 0;
        let vy = 0;

        // If knocked back, apply drag friction and skip player input
        if (this.isKnockedBack) {
            let curVx = this.player.body.velocity.x;
            let curVy = this.player.body.velocity.y;
            // Apply friction to slow down gradually
            this.player.body.velocity.x *= 0.9;
            this.player.body.velocity.y *= 0.9;

            // When velocity is low enough, return control to player
            let curSpeed = Math.sqrt(curVx * curVx + curVy * curVy);
            if (curSpeed < 30) {
                this.isKnockedBack = false;
                this.player.body.velocity.x = 0;
                this.player.body.velocity.y = 0;
            }
        } else {
            if (this.keys.w.isDown) vy = -speed;
            if (this.keys.s.isDown) vy = speed;
            if (this.keys.a.isDown) vx = -speed;
            if (this.keys.d.isDown) vx = speed;

            if (vx !== 0 && vy !== 0) {
                vx *= 0.7071;
                vy *= 0.7071;
            }

            this.player.setVelocity(vx, vy);
        }

        // Update sword cooldown bar on hotbar
        this.updateCooldownBar();

        // Update Zombies
        let now = this.time.now;
        this.zombies.getChildren().forEach((z) => {
            if (!z.body) return;
            z.setDepth(z.y); // Dynamic depth sorting

            let dist = Phaser.Math.Distance.Between(
                z.x,
                z.y,
                this.player.x,
                this.player.y,
            );

            // If zombie is not knocked back
            if (
                !z.isKnockedBack &&
                Math.abs(z.body.velocity.x) < 200 &&
                Math.abs(z.body.velocity.y) < 200
            ) {
                if (dist <= this.zombieAttackRange) {
                    // CLOSE ENOUGH: Stop moving and attack on cooldown
                    z.body.velocity.x = 0;
                    z.body.velocity.y = 0;

                    // Play idle animation when stopped
                    if (
                        z.isSprite &&
                        z.anims.currentAnim &&
                        z.anims.currentAnim.key !== "zombie_idle"
                    ) {
                        if (this.anims.exists("zombie_idle"))
                            z.anims.play("zombie_idle", true);
                    }

                    // Attack with cooldown
                    if (now - z.lastAttackTime >= this.zombieAttackCooldown) {
                        z.lastAttackTime = now;
                        this.zombieAttack(z);
                    }
                } else {
                    // TOO FAR: Chase the player
                    this.physics.moveToObject(z, this.player, 80);

                    // Play walk animation when moving
                    if (
                        z.isSprite &&
                        z.anims.currentAnim &&
                        z.anims.currentAnim.key !== "zombie_walk"
                    ) {
                        if (this.anims.exists("zombie_walk"))
                            z.anims.play("zombie_walk", true);
                    }
                }
            }

            // Flip Sprite based on direction
            if (z.isSprite) {
                if (z.body.velocity.x < 0) {
                    z.setFlipX(true);
                } else if (z.body.velocity.x > 0) {
                    z.setFlipX(false);
                }
            }
        });

        // Update Skeletons
        this.skeletons.getChildren().forEach((s) => {
            if (!s.body) return;
            s.setDepth(s.y);

            let dist = Phaser.Math.Distance.Between(
                s.x,
                s.y,
                this.player.x,
                this.player.y,
            );

            if (!s.isKnockedBack && !s.isChargingShot) {
                if (dist <= this.skeletonAttackRange) {
                    s.body.velocity.x = 0;
                    s.body.velocity.y = 0;

                    if (
                        s.isSprite &&
                        s.anims.currentAnim &&
                        s.anims.currentAnim.key !== "skeleton_idle"
                    ) {
                        if (this.anims.exists("skeleton_idle")) {
                            s.anims.play("skeleton_idle", true);
                        }
                    }

                    if (now - s.lastAttackTime >= this.skeletonAttackCooldown) {
                        s.lastAttackTime = now;
                        this.skeletonAttack(s);
                    }
                } else {
                    this.physics.moveToObject(s, this.player, 70);

                    if (
                        s.isSprite &&
                        s.anims.currentAnim &&
                        s.anims.currentAnim.key !== "skeleton_walk"
                    ) {
                        if (this.anims.exists("skeleton_walk")) {
                            s.anims.play("skeleton_walk", true);
                        }
                    }
                }
            }

            if (
                dist < this.skeletonKeepDistance &&
                !s.isChargingShot &&
                !s.isKnockedBack
            ) {
                const retreatAngle = Phaser.Math.Angle.Between(
                    this.player.x,
                    this.player.y,
                    s.x,
                    s.y,
                );
                s.body.velocity.x = Math.cos(retreatAngle) * 85;
                s.body.velocity.y = Math.sin(retreatAngle) * 85;
                if (s.isSprite && this.anims.exists("skeleton_walk")) {
                    s.anims.play("skeleton_walk", true);
                }
            }

            if (s.isSprite) {
                if (s.body.velocity.x < 0) {
                    s.setFlipX(true);
                } else if (s.body.velocity.x > 0) {
                    s.setFlipX(false);
                }
            }
        });

        // Update Creepers
        this.creepers.getChildren().forEach((c) => {
            if (!c.body) return;
            c.setDepth(c.y);

            const dist = Phaser.Math.Distance.Between(
                c.x,
                c.y,
                this.player.x,
                this.player.y,
            );

            if (c.isChargingExplosion) {
                c.body.velocity.x = 0;
                c.body.velocity.y = 0;
                if (dist > this.creeperTriggerRange) {
                    this.resetCreeperCharge(c);
                }
            } else if (!c.isKnockedBack) {
                if (dist <= this.creeperTriggerRange) {
                    if (c.isSprite && this.anims.exists("creeper_idle")) {
                        c.anims.play("creeper_idle", true);
                    }
                    this.startCreeperCharge(c);
                } else {
                    this.physics.moveToObject(c, this.player, 85);
                    if (c.isSprite && this.anims.exists("creeper_walk")) {
                        c.anims.play("creeper_walk", true);
                    }
                }
            }

            if (c.isSprite) {
                if (c.body.velocity.x < 0) c.setFlipX(true);
                else if (c.body.velocity.x > 0) c.setFlipX(false);
            }
        });

        // Update Spiders
        this.spiders.getChildren().forEach((s) => {
            if (!s.body) return;
            s.setDepth(s.y);

            const dist = Phaser.Math.Distance.Between(
                s.x,
                s.y,
                this.player.x,
                this.player.y,
            );

            if (!s.isKnockedBack) {
                if (dist <= this.spiderAttackRange) {
                    s.body.velocity.x = 0;
                    s.body.velocity.y = 0;

                    if (
                        s.isSprite &&
                        s.anims.currentAnim &&
                        s.anims.currentAnim.key !== "spider_idle"
                    ) {
                        if (this.anims.exists("spider_idle")) {
                            s.anims.play("spider_idle", true);
                        }
                    }

                    if (now - s.lastAttackTime >= this.spiderAttackCooldown) {
                        s.lastAttackTime = now;
                        this.spiderAttack(s);
                    }
                } else {
                    this.physics.moveToObject(s, this.player, 95);
                    if (
                        s.isSprite &&
                        s.anims.currentAnim &&
                        s.anims.currentAnim.key !== "spider_walk"
                    ) {
                        if (this.anims.exists("spider_walk")) {
                            s.anims.play("spider_walk", true);
                        }
                    }
                }
            }

            if (dist < this.spiderKeepDistance && !s.isKnockedBack) {
                const retreatAngle = Phaser.Math.Angle.Between(
                    this.player.x,
                    this.player.y,
                    s.x,
                    s.y,
                );
                s.body.velocity.x = Math.cos(retreatAngle) * 90;
                s.body.velocity.y = Math.sin(retreatAngle) * 90;
                if (s.isSprite && this.anims.exists("spider_walk")) {
                    s.anims.play("spider_walk", true);
                }
            }

            if (s.isSprite) {
                if (s.body.velocity.x < 0) s.setFlipX(true);
                else if (s.body.velocity.x > 0) s.setFlipX(false);
            }
        });

        // Update arrows
        this.arrows.getChildren().forEach((arrow) => {
            if (!arrow.body) return;
            if (this.time.now - arrow.spawnTime > 3000) {
                this.destroyArrow(arrow);
                return;
            }

            const dirX = arrow.directionX ?? 0;
            const dirY = arrow.directionY ?? 0;
            arrow.setVelocity(dirX * this.arrowSpeed, dirY * this.arrowSpeed);
            arrow.rotation = Math.atan2(dirY, dirX);
        });

        // Update webs
        this.webs.getChildren().forEach((web) => {
            if (!web.body) return;
            if (this.time.now - web.spawnTime > 2500) {
                this.destroyWeb(web);
                return;
            }

            const dirX = web.directionX ?? 0;
            const dirY = web.directionY ?? 0;
            web.setVelocity(dirX * this.webSpeed, dirY * this.webSpeed);
            web.rotation = Math.atan2(dirY, dirX);
        });

        // Update infinite background grid to perfectly match camera scroll
        this.bgGrid.tilePositionX = this.cameras.main.scrollX;
        this.bgGrid.tilePositionY = this.cameras.main.scrollY;

        if (vx !== 0 || vy !== 0) {
            this.player.anims.play("walk", true);
        } else {
            this.player.anims.play("idle", true);
        }

        // 1. Calculate Player facing and Target Block (9 directions, 1 range)
        let pgX = Math.floor(this.player.x / 64);
        let pgY = Math.floor(this.player.y / 64);

        let dx = this.input.activePointer.worldX - this.player.x;
        let dy = this.input.activePointer.worldY - this.player.y;
        let dist = Math.sqrt(dx * dx + dy * dy);

        if (dist > 8) {
            this.playerAimAngle = Math.atan2(dy, dx);
            this.playerFacing = this.getFacingDirectionFromVector(dx, dy);
        }

        let tgX = pgX;
        let tgY = pgY;

        if (this.playerFacing === "right") {
            tgX++;
        } else if (this.playerFacing === "down") {
            tgY++;
        } else if (this.playerFacing === "left") {
            tgX--;
        } else if (this.playerFacing === "up") {
            tgY--;
        }

        this.targetGridX = tgX;
        this.targetGridY = tgY;

        // 2. Update Target Indicator Visual
        if (!this.targetIndicator) {
            this.targetIndicator = this.add
                .rectangle(0, 0, 64, 64, 0xffffff, 0)
                .setOrigin(0, 0);
            this.targetIndicator.setStrokeStyle(4, 0xffffff, 0.8);
            this.targetIndicator.setDepth(1000000); // Always on top of everything
        }
        this.targetIndicator.setPosition(tgX * 64, tgY * 64);
        // Hide indicator when sword is selected
        this.targetIndicator.setVisible(this.currentSlot !== 9);

        // 3. Make Player face the current facing direction (FlipX)
        if (this.playerFacing === "left") {
            this.player.setFlipX(true);
        } else if (this.playerFacing === "right") {
            this.player.setFlipX(false);
        }

        this.hudXText.setText(`X: ${Math.round(this.player.x)}`);
        this.hudYText.setText(`Y: ${Math.round(this.player.y)}`);
    }
}
