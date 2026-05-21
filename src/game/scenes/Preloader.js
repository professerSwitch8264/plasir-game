import { Scene } from 'phaser';

export class Preloader extends Scene
{
    constructor ()
    {
        super('Preloader');
    }

    preload ()
    {
        //  Setup a simple loading bar
        this.add.rectangle(540, 480, 468, 32).setStrokeStyle(1, 0xffffff);
        const bar = this.add.rectangle(540-230, 480, 4, 28, 0xffffff);

        this.load.on('progress', (progress) => {
            bar.width = 4 + (460 * progress);
        });

        // Load plugins if needed, but rexUI plugin is loaded in config
    }

    create ()
    {
        this.scene.start('CharacterCreator');
    }
}
