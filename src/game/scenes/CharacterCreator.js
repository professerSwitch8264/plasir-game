import { Scene } from 'phaser';

export class CharacterCreator extends Scene {
    constructor() {
        super('CharacterCreator');
        this.gridSize = 16;
        this.cellSize = 32;
        this.currentColor = 0x000000;
        
        this.animsData = { idle: [this.createEmptyFrame()], walk: [this.createEmptyFrame()] };
        this.currentAnim = 'idle';
        this.currentFrameIdx = 0;
        
        this.pixels = [];
        this.onionPixels = [];
        
        // Tool states
        this.tools = { PENCIL: 0, ERASER: 1, FILL: 2, DROPPER: 3, SELECT: 4 };
        this.currentTool = this.tools.PENCIL;
        
        this.clipboard = null; // Stores copied pixels
        
        // History (Undo/Redo)
        this.history = [];
        this.redoStack = [];
        this.isDrawing = false;
        
        // Selection State
        this.selection = {
            active: false,
            isSelecting: false, // drawing the box
            isDragging: false,  // moving the buffer
            isLifted: false,    // true if the pixels have been removed from the grid
            startX: 0, startY: 0,
            endX: 0, endY: 0,
            rect: null, // Phaser Rectangle for visual box
            buffer: null, // 2D array of colors
            bufferX: 0, bufferY: 0,
            dragStartX: 0, dragStartY: 0,
            visuals: [] // temporary rectangles for moving pixels
        };
        
        this.onionSkinEnabled = false;
    }

    createEmptyFrame() {
        let frame = [];
        for (let y = 0; y < this.gridSize; y++) {
            frame[y] = [];
            for (let x = 0; x < this.gridSize; x++) {
                frame[y][x] = null;
            }
        }
        return frame;
    }

    cloneFrame(frame) {
        return frame.map(row => [...row]);
    }

    saveHistory() {
        // Save current frame state before modifying
        let currentFrame = this.animsData[this.currentAnim][this.currentFrameIdx];
        this.history.push(this.cloneFrame(currentFrame));
        if (this.history.length > 20) this.history.shift(); // Max 20 steps
        this.redoStack = [];
    }

    undo() {
        if (this.history.length === 0) return;
        let currentFrame = this.animsData[this.currentAnim][this.currentFrameIdx];
        this.redoStack.push(this.cloneFrame(currentFrame));
        this.animsData[this.currentAnim][this.currentFrameIdx] = this.history.pop();
        this.clearSelection();
        this.renderCurrentFrame();
        this.saveDatabase();
    }

    redo() {
        if (this.redoStack.length === 0) return;
        let currentFrame = this.animsData[this.currentAnim][this.currentFrameIdx];
        this.history.push(this.cloneFrame(currentFrame));
        this.animsData[this.currentAnim][this.currentFrameIdx] = this.redoStack.pop();
        this.clearSelection();
        this.renderCurrentFrame();
        this.saveDatabase();
    }

    saveDatabase() {
        localStorage.setItem('pixelArtDB', JSON.stringify(this.animsData));
    }

    create() {
        let savedDB = localStorage.getItem('pixelArtDB');
        if (savedDB) {
            try {
                this.animsData = JSON.parse(savedDB);
            } catch (e) {
                this.animsData = { idle: [this.createEmptyFrame()], walk: [this.createEmptyFrame()] };
            }
        } else {
            this.animsData = { idle: [this.createEmptyFrame()], walk: [this.createEmptyFrame()] };
        }
        
        let savedCol = localStorage.getItem('pixelArtCollection');
        if (savedCol) {
            try { this.collectionDB = JSON.parse(savedCol); }
            catch (e) { this.collectionDB = {}; }
        } else {
            this.collectionDB = {};
        }
        
        this.currentAnim = 'idle';
        this.currentFrameIdx = 0;
        this.history = [];
        this.redoStack = [];
        this.clearSelection();

        this.cameras.main.setBackgroundColor('#2d2d2d');

        this.add.text(540, 30, 'Pixel Art Studio', {
            fontSize: '36px', fill: '#00ffcc', fontStyle: 'bold', fontFamily: 'sans-serif'
        }).setOrigin(0.5);

        this.startX = 540 - (this.gridSize * this.cellSize) / 2;
        this.startY = 120;

        // Grid Background
        this.add.grid(
            540, this.startY + (this.gridSize * this.cellSize) / 2, 
            this.gridSize * this.cellSize, this.gridSize * this.cellSize, 
            this.cellSize, this.cellSize, 
            0xdddddd, 1, 0xaaaaaa, 1
        );

        // Initialize pixel objects
        for (let y = 0; y < this.gridSize; y++) {
            this.pixels[y] = [];
            this.onionPixels[y] = [];
            for (let x = 0; x < this.gridSize; x++) {
                this.onionPixels[y][x] = this.add.rectangle(
                    this.startX + (x * this.cellSize) + 1,
                    this.startY + (y * this.cellSize) + 1,
                    this.cellSize - 2, this.cellSize - 2, 0xffffff
                ).setOrigin(0, 0).setVisible(false).setAlpha(0.3);

                this.pixels[y][x] = { rect: null };
            }
        }

        this.selection.rect = this.add.rectangle(0, 0, 0, 0, 0x00ff00, 0.2)
            .setStrokeStyle(2, 0x00ff00).setOrigin(0, 0).setVisible(false).setDepth(10);

        const drawZone = this.add.zone(
            540, this.startY + (this.gridSize * this.cellSize) / 2, 
            this.gridSize * this.cellSize, this.gridSize * this.cellSize
        ).setInteractive();

        drawZone.on('pointerdown', (pointer) => { this.handlePointerDown(pointer); });
        drawZone.on('pointermove', (pointer) => { this.handlePointerMove(pointer); });
        this.input.on('pointerup', (pointer) => { this.handlePointerUp(pointer); });

        this.createToolUI();
        this.createAnimUI();
        this.createBottomUI();

        this.renderCurrentFrame();
    }

    getGridCoords(pointer) {
        let x = Math.floor((pointer.x - this.startX) / this.cellSize);
        let y = Math.floor((pointer.y - this.startY) / this.cellSize);
        return { x, y };
    }

    handlePointerDown(pointer) {
        let {x, y} = this.getGridCoords(pointer);
        let inBounds = (x >= 0 && x < this.gridSize && y >= 0 && y < this.gridSize);
        
        if (this.currentTool === this.tools.SELECT) {
            if (this.selection.active) {
                // Check if clicking inside buffer
                if (x >= this.selection.bufferX && x < this.selection.bufferX + this.selection.buffer[0].length &&
                    y >= this.selection.bufferY && y < this.selection.bufferY + this.selection.buffer.length) {
                    this.selection.isDragging = true;
                    this.selection.dragStartX = x - this.selection.bufferX;
                    this.selection.dragStartY = y - this.selection.bufferY;
                    
                    // If not lifted yet, we lift (cut) it from the grid now!
                    if (!this.selection.isLifted) {
                        this.saveHistory();
                        this.selection.isLifted = true;
                        let frame = this.animsData[this.currentAnim][this.currentFrameIdx];
                        for (let by = 0; by < this.selection.buffer.length; by++) {
                            for (let bx = 0; bx < this.selection.buffer[0].length; bx++) {
                                if (this.selection.buffer[by][bx] !== null) {
                                    let fx = this.selection.bufferX + bx;
                                    let fy = this.selection.bufferY + by;
                                    if (fx >= 0 && fx < this.gridSize && fy >= 0 && fy < this.gridSize) {
                                        frame[fy][fx] = null;
                                    }
                                }
                            }
                        }
                        this.renderCurrentFrame();
                        this.updateSelectionVisuals();
                    }
                } else {
                    // Apply selection
                    this.applySelection();
                    // Start new selection if in bounds
                    if (inBounds) {
                        this.selection.isSelecting = true;
                        this.selection.startX = x;
                        this.selection.startY = y;
                        this.selection.endX = x;
                        this.selection.endY = y;
                        this.updateSelectionVisuals();
                    }
                }
            } else {
                if (inBounds) {
                    this.selection.isSelecting = true;
                    this.selection.startX = x;
                    this.selection.startY = y;
                    this.selection.endX = x;
                    this.selection.endY = y;
                    this.updateSelectionVisuals();
                }
            }
        } else {
            if (!inBounds) return;
            this.isDrawing = true;
            this.saveHistory();
            this.applyTool(x, y);
        }
    }

    handlePointerMove(pointer) {
        let {x, y} = this.getGridCoords(pointer);
        
        if (this.currentTool === this.tools.SELECT) {
            if (this.selection.isSelecting) {
                // clamp x, y
                x = Math.max(0, Math.min(x, this.gridSize - 1));
                y = Math.max(0, Math.min(y, this.gridSize - 1));
                this.selection.endX = x;
                this.selection.endY = y;
                this.updateSelectionVisuals();
            } else if (this.selection.isDragging) {
                this.selection.bufferX = x - this.selection.dragStartX;
                this.selection.bufferY = y - this.selection.dragStartY;
                this.updateSelectionVisuals();
            }
        } else {
            if (this.isDrawing && x >= 0 && x < this.gridSize && y >= 0 && y < this.gridSize) {
                this.applyTool(x, y);
            }
        }
    }

    handlePointerUp(pointer) {
        if (this.currentTool === this.tools.SELECT) {
            if (this.selection.isSelecting) {
                this.selection.isSelecting = false;
                this.captureSelection();
            } else if (this.selection.isDragging) {
                this.selection.isDragging = false;
            }
        } else {
            if (this.isDrawing) {
                this.saveDatabase();
            }
            this.isDrawing = false;
        }
    }

    applyTool(x, y) {
        let frame = this.animsData[this.currentAnim][this.currentFrameIdx];
        if (this.currentTool === this.tools.PENCIL) {
            frame[y][x] = this.currentColor;
            this.renderCurrentFrame();
        } else if (this.currentTool === this.tools.ERASER) {
            frame[y][x] = null;
            this.renderCurrentFrame();
        } else if (this.currentTool === this.tools.DROPPER) {
            if (frame[y][x] !== null) {
                this.currentColor = frame[y][x];
            }
        } else if (this.currentTool === this.tools.FILL) {
            this.floodFill(x, y, this.currentColor);
            this.renderCurrentFrame();
            this.isDrawing = false; // Fill is one-shot
        }
    }

    floodFill(startX, startY, targetColor) {
        let frame = this.animsData[this.currentAnim][this.currentFrameIdx];
        let startColor = frame[startY][startX];
        if (startColor === targetColor) return;

        let queue = [{x: startX, y: startY}];
        while (queue.length > 0) {
            let {x, y} = queue.shift();
            if (x < 0 || x >= this.gridSize || y < 0 || y >= this.gridSize) continue;
            if (frame[y][x] !== startColor) continue;
            
            frame[y][x] = targetColor;
            queue.push({x: x+1, y: y});
            queue.push({x: x-1, y: y});
            queue.push({x: x, y: y+1});
            queue.push({x: x, y: y-1});
        }
    }

    captureSelection() {
        let x1 = Math.min(this.selection.startX, this.selection.endX);
        let x2 = Math.max(this.selection.startX, this.selection.endX);
        let y1 = Math.min(this.selection.startY, this.selection.endY);
        let y2 = Math.max(this.selection.startY, this.selection.endY);
        
        let frame = this.animsData[this.currentAnim][this.currentFrameIdx];
        
        let buffer = [];
        let hasPixels = false;
        for (let y = y1; y <= y2; y++) {
            let row = [];
            for (let x = x1; x <= x2; x++) {
                row.push(frame[y][x]);
                if (frame[y][x] !== null) hasPixels = true;
                // We DO NOT clear the grid here anymore. It's cleared when dragging starts (Lifted).
            }
            buffer.push(row);
        }
        
        if (!hasPixels) {
            this.clearSelection();
            this.renderCurrentFrame();
            return;
        }

        this.selection.active = true;
        this.selection.isLifted = false; // Not lifted yet
        this.selection.buffer = buffer;
        this.selection.bufferX = x1;
        this.selection.bufferY = y1;
        this.updateSelectionVisuals();
    }

    applySelection() {
        if (!this.selection.active) return;
        if (this.selection.isLifted) {
            // Only apply if it was lifted. If it was never lifted, it's just a selection box that wasn't moved.
            this.saveHistory();
            let frame = this.animsData[this.currentAnim][this.currentFrameIdx];
        for (let by = 0; by < this.selection.buffer.length; by++) {
            for (let bx = 0; bx < this.selection.buffer[0].length; bx++) {
                let color = this.selection.buffer[by][bx];
                if (color !== null) {
                    let fx = this.selection.bufferX + bx;
                    let fy = this.selection.bufferY + by;
                    if (fx >= 0 && fx < this.gridSize && fy >= 0 && fy < this.gridSize) {
                        frame[fy][fx] = color;
                    }
                }
            }
        }
        } // <--- Added closing bracket for if (this.selection.isLifted)
        this.clearSelection();
        this.renderCurrentFrame();
        this.saveDatabase();
    }

    clearSelection() {
        this.selection.active = false;
        this.selection.isSelecting = false;
        this.selection.isDragging = false;
        this.selection.isLifted = false;
        if (this.selection.rect) this.selection.rect.setVisible(false);
        if (this.selection.visuals) {
            this.selection.visuals.forEach(v => v.destroy());
            this.selection.visuals = [];
        }
    }

    updateSelectionVisuals() {
        if (this.selection.isSelecting) {
            let x1 = Math.min(this.selection.startX, this.selection.endX);
            let x2 = Math.max(this.selection.startX, this.selection.endX);
            let y1 = Math.min(this.selection.startY, this.selection.endY);
            let y2 = Math.max(this.selection.startY, this.selection.endY);
            
            this.selection.rect.setPosition(this.startX + x1 * this.cellSize, this.startY + y1 * this.cellSize);
            this.selection.rect.setSize((x2 - x1 + 1) * this.cellSize, (y2 - y1 + 1) * this.cellSize);
            this.selection.rect.setVisible(true);
        } else if (this.selection.active) {
            this.selection.rect.setPosition(this.startX + this.selection.bufferX * this.cellSize, this.startY + this.selection.bufferY * this.cellSize);
            this.selection.rect.setVisible(true); // make sure it's visible when lifted too!
            
            // Draw floating pixels only if lifted
            this.selection.visuals.forEach(v => v.destroy());
            this.selection.visuals = [];
            if (this.selection.isLifted) {
                for (let y = 0; y < this.selection.buffer.length; y++) {
                    for (let x = 0; x < this.selection.buffer[0].length; x++) {
                        let color = this.selection.buffer[y][x];
                        if (color !== null) {
                            let rect = this.add.rectangle(
                                this.startX + (this.selection.bufferX + x) * this.cellSize + 1,
                                this.startY + (this.selection.bufferY + y) * this.cellSize + 1,
                                this.cellSize - 2, this.cellSize - 2, color
                            ).setOrigin(0, 0).setDepth(5);
                            this.selection.visuals.push(rect);
                        }
                    }
                }
            }
        }
    }

    createToolUI() {
        let toolX = this.startX - 80;
        let startY = 150;
        const toolNames = ['Pencil', 'Eraser', 'Fill', 'Drop', 'Select'];
        
        this.toolBtns = [];
        toolNames.forEach((name, i) => {
            let btn = this.add.rectangle(toolX, startY + i * 55, 60, 40, this.currentTool === i ? 0xffcc00 : 0x555555).setInteractive();
            let txt = this.add.text(toolX, startY + i * 55, name, { fill: this.currentTool === i ? '#000' : '#fff' }).setOrigin(0.5);
            btn.on('pointerdown', () => {
                if (this.currentTool === this.tools.SELECT && this.selection.active) {
                    this.applySelection();
                }
                this.currentTool = i;
                this.toolBtns.forEach((b, j) => {
                    b.btn.setFillStyle(this.currentTool === j ? 0xffcc00 : 0x555555);
                    b.txt.setColor(this.currentTool === j ? '#000' : '#fff');
                });
            });
            this.toolBtns.push({btn, txt});
        });

        // Top Toolbar
        const topY = 80;
        const addTopBtn = (tx, lbl, color, cb) => {
            let b = this.add.rectangle(tx, topY, 70, 30, color).setInteractive();
            this.add.text(tx, topY, lbl, { fill: '#fff', fontSize: '14px' }).setOrigin(0.5);
            b.on('pointerdown', cb);
        };
        addTopBtn(this.startX + 40, 'Undo', 0x4444aa, () => this.undo());
        addTopBtn(this.startX + 120, 'Redo', 0x4444aa, () => this.redo());
        addTopBtn(this.startX + 200, 'Copy', 0xaaaa00, () => {
            if (this.selection.active && this.selection.buffer) {
                this.clipboard = JSON.parse(JSON.stringify(this.selection.buffer));
            }
        });
        addTopBtn(this.startX + 280, 'Paste', 0xaaaa00, () => {
            if (this.clipboard) {
                this.applySelection(); // apply any existing selection
                this.currentTool = this.tools.SELECT;
                
                // Update tool buttons UI
                this.toolBtns.forEach((b, j) => {
                    b.btn.setFillStyle(this.currentTool === j ? 0xffcc00 : 0x555555);
                    b.txt.setColor(this.currentTool === j ? '#000' : '#fff');
                });

                this.selection.active = true;
                this.selection.isLifted = true; // Floating, not attached to grid
                this.selection.buffer = JSON.parse(JSON.stringify(this.clipboard));
                this.selection.bufferX = 0;
                this.selection.bufferY = 0;
                this.updateSelectionVisuals();
            }
        });
        // Remove "Reset DB" and replace with safer UI, but keep clear for current frame.
        addTopBtn(this.startX + 360, 'Clear', 0xaa4444, () => {
            this.saveHistory();
            this.animsData[this.currentAnim][this.currentFrameIdx] = this.createEmptyFrame();
            this.renderCurrentFrame();
            this.saveDatabase();
        });
        
        let onionBtn = this.add.rectangle(this.startX + 450, topY, 100, 30, this.onionSkinEnabled ? 0x00aa00 : 0x555555).setInteractive();
        let onionTxt = this.add.text(this.startX + 450, topY, 'Onion Skin', { fill: '#fff', fontSize: '14px' }).setOrigin(0.5);
        onionBtn.on('pointerdown', () => {
            this.onionSkinEnabled = !this.onionSkinEnabled;
            onionBtn.setFillStyle(this.onionSkinEnabled ? 0x00aa00 : 0x555555);
            this.renderCurrentFrame();
        });
    }

    createAnimUI() {
        if (this.animContainer) this.animContainer.destroy();
        this.animContainer = this.add.container(this.startX + this.gridSize * this.cellSize + 80, 150);

        // Animation Tabs
        const btnIdle = this.add.rectangle(0, 0, 80, 40, this.currentAnim === 'idle' ? 0x00ffcc : 0x555555).setInteractive();
        const txtIdle = this.add.text(0, 0, 'IDLE', { fill: this.currentAnim === 'idle' ? '#000' : '#fff' }).setOrigin(0.5);
        btnIdle.on('pointerdown', () => { this.applySelection(); this.currentAnim = 'idle'; this.currentFrameIdx = 0; this.history = []; this.redoStack = []; this.renderCurrentFrame(); this.createAnimUI(); });

        const btnWalk = this.add.rectangle(90, 0, 80, 40, this.currentAnim === 'walk' ? 0x00ffcc : 0x555555).setInteractive();
        const txtWalk = this.add.text(90, 0, 'WALK', { fill: this.currentAnim === 'walk' ? '#000' : '#fff' }).setOrigin(0.5);
        btnWalk.on('pointerdown', () => { this.applySelection(); this.currentAnim = 'walk'; this.currentFrameIdx = 0; this.history = []; this.redoStack = []; this.renderCurrentFrame(); this.createAnimUI(); });

        this.animContainer.add([btnIdle, txtIdle, btnWalk, txtWalk]);

        // Frame List
        const frames = this.animsData[this.currentAnim];
        frames.forEach((f, i) => {
            const fBtn = this.add.rectangle(45, 60 + i * 50, 170, 40, this.currentFrameIdx === i ? 0xffcc00 : 0x444444).setInteractive();
            const fTxt = this.add.text(45, 60 + i * 50, `Frame ${i + 1}`, { fill: this.currentFrameIdx === i ? '#000' : '#fff' }).setOrigin(0.5);
            fBtn.on('pointerdown', () => { this.applySelection(); this.currentFrameIdx = i; this.history = []; this.redoStack = []; this.renderCurrentFrame(); this.createAnimUI(); });
            this.animContainer.add([fBtn, fTxt]);
        });

        // Add Frame Button
        const addBtn = this.add.rectangle(45, 60 + frames.length * 50, 170, 40, 0x00aa00).setInteractive();
        const addTxt = this.add.text(45, 60 + frames.length * 50, '+ Add Frame', { fill: '#fff' }).setOrigin(0.5);
        
        addBtn.on('pointerdown', () => {
            this.applySelection();
            const newFrame = this.cloneFrame(frames[frames.length - 1]);
            this.animsData[this.currentAnim].push(newFrame);
            this.currentFrameIdx = this.animsData[this.currentAnim].length - 1;
            this.history = []; this.redoStack = [];
            this.renderCurrentFrame();
            this.createAnimUI();
            this.saveDatabase();
        });

        this.animContainer.add([addBtn, addTxt]);
    }

    updateCollectionDropdown() {
        let sel = document.getElementById('skinSelector');
        if (!sel) return;
        sel.innerHTML = '<option value="">-- Load Skin --</option>';
        Object.keys(this.collectionDB).forEach(name => {
            let opt = document.createElement('option');
            opt.value = name;
            opt.textContent = name;
            sel.appendChild(opt);
        });
    }

    createBottomUI() {
        let paletteY = this.startY + (this.gridSize * this.cellSize) + 40;
        
        // Custom Color Picker (HTML)
        this.add.text(this.startX, paletteY, 'Brush Color:', { fontSize: '20px', fill: '#fff' }).setOrigin(0, 0.5);
        const colorInputHTML = `<input type="color" id="colorPicker" value="#000000" style="width: 50px; height: 50px; cursor: pointer; border: none; background: transparent;">`;
        let colorDom = this.add.dom(this.startX + 140, paletteY).createFromHTML(colorInputHTML);
        
        // Listen to native DOM event
        setTimeout(() => {
            let input = document.getElementById('colorPicker');
            if(input) {
                input.addEventListener('input', (e) => {
                    this.currentColor = parseInt(e.target.value.replace('#', '0x'), 16);
                });
            }
        }, 100);

        // Predefined Colors
        const colors = [0x000000, 0xffffff, 0xff0000, 0x00ff00, 0x0000ff, 0xffff00, 0xff00ff];
        colors.forEach((color, index) => {
            let swatch = this.add.rectangle(this.startX + 220 + index * 40, paletteY, 30, 30, color)
                .setStrokeStyle(2, 0xffffff).setInteractive();
            swatch.on('pointerdown', () => { 
                this.currentColor = color; 
                let input = document.getElementById('colorPicker');
                if (input) input.value = '#' + color.toString(16).padStart(6, '0');
            });
        });

        // Save & Play Button
        const playBtn = this.add.rectangle(540, paletteY + 120, 250, 60, 0x00aa00).setInteractive();
        playBtn.on('pointerdown', () => this.saveAndPlay());
        this.add.text(540, paletteY + 120, 'Save & Play', { fontSize: '28px', fill: '#ffffff', fontStyle: 'bold' }).setOrigin(0.5);

        // Collection UI
        const collectionHTML = `
            <div style="display: flex; flex-direction: column; gap: 10px; align-items: center; background: #444; padding: 10px; border-radius: 8px;">
                <div style="display: flex; gap: 10px; align-items: center; justify-content: center;">
                    <input type="text" id="charName" name="charName" placeholder="Enter Skin Name" style="font-size: 18px; padding: 8px; width: 160px; text-align: center; border-radius: 4px; border: none; outline: none;">
                    <button id="btnSaveSkin" style="font-size: 16px; padding: 8px 12px; background: #00aa00; color: white; border: none; border-radius: 4px; cursor: pointer;">Save</button>
                    <select id="skinSelector" style="font-size: 16px; padding: 8px; width: 150px; border-radius: 4px; border: none; outline: none;">
                        <option value="">-- Load Skin --</option>
                    </select>
                    <button id="btnDelSkin" style="font-size: 16px; padding: 8px 12px; background: #aa0000; color: white; border: none; border-radius: 4px; cursor: pointer;">Del</button>
                </div>
                <div style="display: flex; gap: 10px; align-items: center; justify-content: center;">
                    <button id="btnExport" style="font-size: 14px; padding: 6px 12px; background: #0055aa; color: white; border: none; border-radius: 4px; cursor: pointer;">💾 Export JSON</button>
                    <span style="color: white; font-size: 14px;">Import:</span>
                    <input type="file" id="btnImport" accept=".json" style="font-size: 14px; color: white; width: 200px;" />
                </div>
            </div>
        `;
        this.add.dom(540, paletteY + 70).createFromHTML(collectionHTML);
        
        setTimeout(() => {
            this.updateCollectionDropdown();
            
            document.getElementById('btnSaveSkin')?.addEventListener('click', () => {
                let name = document.getElementById('charName').value.trim();
                if (!name) return alert('Please enter a skin name first!');
                this.collectionDB[name] = JSON.parse(JSON.stringify(this.animsData));
                localStorage.setItem('pixelArtCollection', JSON.stringify(this.collectionDB));
                this.updateCollectionDropdown();
                document.getElementById('skinSelector').value = name;
                alert('Saved skin: ' + name);
            });
            
            document.getElementById('skinSelector')?.addEventListener('change', (e) => {
                let name = e.target.value;
                if (name && this.collectionDB[name]) {
                    this.saveHistory();
                    this.animsData = JSON.parse(JSON.stringify(this.collectionDB[name]));
                    document.getElementById('charName').value = name;
                    this.currentFrameIdx = 0;
                    this.renderCurrentFrame();
                    this.saveDatabase();
                }
            });
            
            document.getElementById('btnDelSkin')?.addEventListener('click', () => {
                let sel = document.getElementById('skinSelector');
                let name = sel.value;
                if (!name) return alert('Please select a skin to delete.');
                if (confirm('Are you sure you want to delete the skin: ' + name + '?')) {
                    delete this.collectionDB[name];
                    localStorage.setItem('pixelArtCollection', JSON.stringify(this.collectionDB));
                    this.updateCollectionDropdown();
                    document.getElementById('charName').value = '';
                }
            });

            document.getElementById('btnExport')?.addEventListener('click', () => {
                let dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(this.collectionDB));
                let downloadAnchorNode = document.createElement('a');
                downloadAnchorNode.setAttribute("href", dataStr);
                downloadAnchorNode.setAttribute("download", "skins.json");
                document.body.appendChild(downloadAnchorNode);
                downloadAnchorNode.click();
                downloadAnchorNode.remove();
            });

            document.getElementById('btnImport')?.addEventListener('change', (e) => {
                let file = e.target.files[0];
                if (!file) return;
                let reader = new FileReader();
                reader.onload = (e) => {
                    try {
                        let imported = JSON.parse(e.target.result);
                        Object.assign(this.collectionDB, imported);
                        localStorage.setItem('pixelArtCollection', JSON.stringify(this.collectionDB));
                        this.updateCollectionDropdown();
                        alert('Imported skins successfully!');
                    } catch (err) {
                        alert('Error importing JSON file.');
                    }
                };
                reader.readAsText(file);
            });
        }, 200);
    }

    renderCurrentFrame() {
        let currentData = this.animsData[this.currentAnim][this.currentFrameIdx];
        let prevData = (this.onionSkinEnabled && this.currentFrameIdx > 0) ? this.animsData[this.currentAnim][this.currentFrameIdx - 1] : null;

        for (let y = 0; y < this.gridSize; y++) {
            for (let x = 0; x < this.gridSize; x++) {
                // Main pixels
                let color = currentData[y][x];
                let cell = this.pixels[y][x];
                if (color === null) {
                    if (cell.rect) cell.rect.setVisible(false);
                } else {
                    if (!cell.rect) {
                        cell.rect = this.add.rectangle(
                            this.startX + (x * this.cellSize) + 1,
                            this.startY + (y * this.cellSize) + 1,
                            this.cellSize - 2, this.cellSize - 2, color
                        ).setOrigin(0, 0);
                    } else {
                        cell.rect.setVisible(true).setFillStyle(color);
                    }
                }

                // Onion skin
                let onionCell = this.onionPixels[y][x];
                if (prevData && prevData[y][x] !== null && color === null) {
                    onionCell.setVisible(true).setFillStyle(prevData[y][x]);
                } else {
                    onionCell.setVisible(false);
                }
            }
        }
    }

    saveAndPlay() {
        this.applySelection(); // commit any floating selection

        let charName = document.getElementById('charName')?.value || 'Player';
        if (charName.trim() === '') charName = 'Player';

        const idleFrames = this.animsData.idle.length;
        const walkFrames = this.animsData.walk.length;
        const totalFrames = idleFrames + walkFrames;

        const canvas = document.createElement('canvas');
        canvas.width = this.gridSize * totalFrames;
        canvas.height = this.gridSize;
        const ctx = canvas.getContext('2d');
        
        let currentDrawFrame = 0;
        const drawAnimToCanvas = (animKey) => {
            this.animsData[animKey].forEach(frameData => {
                const offsetX = currentDrawFrame * this.gridSize;
                for (let y = 0; y < this.gridSize; y++) {
                    for (let x = 0; x < this.gridSize; x++) {
                        if (frameData[y][x] !== null) {
                            let hexColor = '#' + frameData[y][x].toString(16).padStart(6, '0');
                            ctx.fillStyle = hexColor;
                            ctx.fillRect(offsetX + x, y, 1, 1);
                        }
                    }
                }
                currentDrawFrame++;
            });
        };

        drawAnimToCanvas('idle');
        drawAnimToCanvas('walk');

        if (this.textures.exists('customPlayer')) this.textures.remove('customPlayer');
        const tex = this.textures.addCanvas('customPlayer', canvas);
        for (let i = 0; i < totalFrames; i++) {
            tex.add(i, 0, i * this.gridSize, 0, this.gridSize, this.gridSize);
        }

        this.scene.start('Game', { playerName: charName, idleCount: idleFrames, walkCount: walkFrames });
    }
}
