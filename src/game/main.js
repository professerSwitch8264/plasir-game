import { Boot } from './scenes/Boot';
import { Preloader } from './scenes/Preloader';
import { CharacterCreator } from './scenes/CharacterCreator';
import { Game } from './scenes/Game';
import * as Phaser from 'phaser';

const config = {
    type: Phaser.AUTO,
    width: 1080,
    height: 960,
    parent: 'game-container',
    backgroundColor: '#028af8',
    pixelArt: true,
    roundPixels: true,
    scale: {
        mode: Phaser.Scale.FIT,
        autoCenter: Phaser.Scale.CENTER_BOTH
    },
    dom: {
        createContainer: true // Needed for standard HTML DOM Input
    },
    physics: {
        default: 'arcade',
        arcade: {
            gravity: { y: 0 },
            debug: false
        }
    },
    scene: [
        Boot,
        Preloader,
        CharacterCreator,
        Game
    ]
};

const StartGame = (parent) => {
    return new Phaser.Game({ ...config, parent });
}

export default StartGame;
