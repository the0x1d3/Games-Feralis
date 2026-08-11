/*
 * ============================================================================
 *  L'UNICO FILE DEL PROGETTO CHE IMPORTA PHASER.
 * ----------------------------------------------------------------------------
 *  ESLint vieta `import ... from 'phaser'` in tutto src/ tranne src/engine/.
 *  Tutto il resto del codice passa da qui. Il motivo e' scritto in
 *  docs/ADR/0001: Phaser 4 e' uscito da poco, la sua superficie API cambia
 *  ancora, e una migrazione futura deve toccare una cartella sola.
 *
 *  Phaser 4 !== Phaser 3. Prima di usare una API non banale, leggi la skill
 *  ufficiale corrispondente in node_modules/phaser/skills/<argomento>/SKILL.md
 *  (in particolare v3-to-v4-migration). NON copiare pattern dai tutorial v3.
 * ============================================================================
 */
import * as Phaser from 'phaser';

export { Phaser };

export type PhaserGame = Phaser.Game;
export type PhaserScene = Phaser.Scene;
export type GameConfig = Phaser.Types.Core.GameConfig;
