import { TICK_MS } from '@domain/clock';
import type { Side } from '@domain/battle/state';
import { assetUrl, CREATURE_FRAME_SIZE, TEXTURE } from '@engine/assets';
import { GAME_HEIGHT, GAME_WIDTH } from '@engine/config';
import { Phaser } from '@engine/phaser';
import type { BattleController } from '@state/battleController';

/**
 * La scena del combattimento: solo i due Ferali e il terreno.
 *
 * Tutto ciò che si legge — barre con i numeri, menu, probabilità di cattura,
 * registro — vive nel DOM (`src/ui/battleUi.ts`). Il canvas fa il mondo, il DOM
 * fa i pannelli (PDR §6.1).
 *
 * La macchina a stati avanza con lo stesso passo fisso da 100 ms del mondo, e
 * si ferma da sola quando tocca al giocatore: qui non c'è nessuna regola, solo
 * il battito.
 */

export interface BattleSceneContext {
  readonly controller: BattleController;
}

const MAX_FRAME_MS = 250;

export class BattleScene extends Phaser.Scene {
  static readonly KEY = 'battle';

  private readonly ctx: BattleSceneContext;

  private accumulator = 0;
  private readonly sprites = new Map<Side, Phaser.GameObjects.Sprite>();

  constructor(context: BattleSceneContext) {
    super({ key: BattleScene.KEY });
    this.ctx = context;
  }

  preload(): void {
    if (this.textures.exists(TEXTURE.creatures)) return;
    this.load.spritesheet(TEXTURE.creatures, assetUrl('sprites/creatures.png'), {
      frameWidth: CREATURE_FRAME_SIZE,
      frameHeight: CREATURE_FRAME_SIZE,
    });
  }

  create(): void {
    this.cameras.main.setBackgroundColor(0x14231c);

    // Terreno: due bande, una per contendente. Bastano a dare profondità senza
    // un fondale disegnato, che arriverà con l'arte vera.
    this.add.ellipse(GAME_WIDTH * 0.68, GAME_HEIGHT * 0.42, 440, 120, 0x24402f).setDepth(0);
    this.add.ellipse(GAME_WIDTH * 0.3, GAME_HEIGHT * 0.74, 520, 140, 0x1c3325).setDepth(0);

    this.sprites.set(
      'enemy',
      this.add
        .sprite(GAME_WIDTH * 0.68, GAME_HEIGHT * 0.36, TEXTURE.creatures, 0)
        .setScale(4)
        .setDepth(1),
    );
    this.sprites.set(
      'player',
      this.add
        .sprite(GAME_WIDTH * 0.3, GAME_HEIGHT * 0.66, TEXTURE.creatures, 0)
        .setScale(5.2)
        .setDepth(2)
        .setFlipX(true),
    );

    this.refreshSprites();
    this.accumulator = 0;

    const unsubscribe = this.ctx.controller.subscribe(() => {
      this.refreshSprites();
    });
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, unsubscribe);
  }

  override update(_time: number, delta: number): void {
    const active = this.ctx.controller.current();
    if (active === undefined) return;

    this.accumulator += Math.min(delta, MAX_FRAME_MS);
    while (this.accumulator >= TICK_MS) {
      this.accumulator -= TICK_MS;
      this.ctx.controller.tick();
    }
  }

  private refreshSprites(): void {
    const active = this.ctx.controller.current();
    if (active === undefined) return;
    const context = this.ctx.controller.context();

    for (const side of ['player', 'enemy'] as const) {
      const team = side === 'player' ? active.state.player : active.state.enemy;
      const member = team.members[team.active];
      const sprite = this.sprites.get(side);
      if (member === undefined || sprite === undefined) continue;

      const species = context.species.get(member.speciesId);
      sprite.setFrame(species?.spriteFrame ?? 0);
      // Un Ferale a terra sbiadisce: informazione ridondante rispetto alla
      // barra dei PV, ed è esattamente il punto (PDR §7.2).
      sprite.setAlpha(member.hp <= 0 ? 0.35 : 1);
      if (member.isAlpha) sprite.setScale(side === 'player' ? 3.2 : 2.6);
    }
  }
}
