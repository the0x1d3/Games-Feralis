import { TICK_MS } from '@domain/clock';
import type { WorldConfig } from '@domain/world/config';
import { exitUnder, facingSign } from '@domain/world/interaction';
import { ambientAt, readClock } from '@domain/world/time';
import type { Encounter } from '@domain/world/encounters';
import {
  facingFrame,
  findSpawn,
  triggersEncounter,
  type TileRules,
  type Zone,
} from '@domain/world/zone';
import { assetUrl, DEPTH, TEXTURE } from '@engine/assets';
import { createWorldInput, type WorldInput } from '@engine/input';
import { Phaser } from '@engine/phaser';
import { renderZone, type ZoneView } from '@engine/zoneRenderer';
import { GAME_HEIGHT, GAME_WIDTH } from '@engine/config';
import type { Store } from '@state/store';

/**
 * La scena del mondo: disegna e raccoglie input. Nessuna regola di gioco.
 *
 * Il ciclo e' a passo fisso da 100 ms (PDR §7.1) con interpolazione in
 * disegno. Senza l'interpolazione il personaggio si muoverebbe a 10 scatti al
 * secondo su uno schermo che ne aggiorna 60; senza il passo fisso il gioco si
 * comporterebbe diversamente a 30 e a 144 fps, che e' il bug classico e
 * insidioso che il PDR chiede di evitare.
 */

export interface WorldSceneContext {
  readonly store: Store;
  readonly config: WorldConfig;
  readonly zones: ReadonlyMap<string, Zone>;
  readonly rawMaps: ReadonlyMap<string, unknown>;
  readonly tileRules: TileRules;
  readonly onSignRead: (textKey: string) => void;
  readonly onZoneChanged: (zone: Zone) => void;
  /**
   * Chiamata quando il giocatore ha percorso `distancePx` dentro l'erba alta.
   * Restituisce l'incontro se ne è scattato uno.
   */
  readonly rollEncounter: (distancePx: number, biome: string) => Encounter | undefined;
  readonly onEncounter: (encounter: Encounter) => void;
  /** Falso mentre un combattimento è già in corso o la squadra è vuota. */
  readonly canEncounter: () => boolean;
}

/** Oltre questa soglia si smette di recuperare tempo: una scheda in background
 *  non deve produrre mille tick tutti insieme alla riapertura. */
const MAX_FRAME_MS = 250;

function lerp(from: number, to: number, t: number): number {
  return from + (to - from) * t;
}

export class WorldScene extends Phaser.Scene {
  static readonly KEY = 'world';

  private readonly ctx: WorldSceneContext;

  private view?: ZoneView;
  private player?: Phaser.GameObjects.Sprite;
  private ambient?: Phaser.GameObjects.Rectangle;
  private worldInput?: WorldInput;

  private accumulator = 0;
  private mountedZoneId?: string;
  private previous = { x: 0, y: 0 };
  private snapNextFrame = true;
  private bobPhase = 0;

  constructor(context: WorldSceneContext) {
    super({ key: WorldScene.KEY });
    this.ctx = context;
  }

  preload(): void {
    this.load.image(TEXTURE.terrain, assetUrl('tilesets/terrain.png'));
    this.load.spritesheet(TEXTURE.player, assetUrl('sprites/player.png'), {
      frameWidth: 32,
      frameHeight: 32,
    });
  }

  create(): void {
    const state = this.ctx.store.getState();

    this.player = this.add.sprite(state.player.x, state.player.y, TEXTURE.player, 0);
    this.player.setDepth(DEPTH.player);

    this.ambient = this.add
      .rectangle(0, 0, GAME_WIDTH, GAME_HEIGHT, 0x000000, 0)
      .setOrigin(0, 0)
      .setScrollFactor(0)
      .setDepth(DEPTH.ambient);

    this.worldInput = createWorldInput(this);
    this.mountZone(state.player.zoneId);

    this.cameras.main.startFollow(
      this.player,
      true,
      this.ctx.config.cameraLerp,
      this.ctx.config.cameraLerp,
    );

    // PDR §7.1: le entita' distrutte devono rimuovere i loro listener.
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.worldInput?.destroy();
      this.view?.destroy();
    });
  }

  override update(_time: number, delta: number): void {
    const input = this.worldInput?.read();
    if (input === undefined) return;

    this.accumulator += Math.min(delta, MAX_FRAME_MS);

    while (this.accumulator >= TICK_MS) {
      const before = this.ctx.store.getState().player;
      this.previous = { x: before.x, y: before.y };
      this.ctx.store.dispatch({ type: 'tick', deltaMs: TICK_MS, input });
      this.accumulator -= TICK_MS;
      this.checkExit();
      if (this.checkEncounter(before)) return;
    }

    if (this.worldInput?.interactPressed() === true) this.tryInteract();

    this.draw(delta);
  }

  /* ------------------------------------------------------------------ zona */

  /**
   * Riallinea la scena allo stato dopo che qualcun altro ha spostato il
   * giocatore — oggi solo il risveglio dopo un KO. Senza, si tornerebbe dal
   * combattimento con la mappa vecchia sotto i piedi.
   */
  syncZone(): void {
    const zoneId = this.ctx.store.getState().player.zoneId;
    if (zoneId === this.mountedZoneId) {
      this.snapNextFrame = true;
      return;
    }
    this.mountZone(zoneId);
  }

  private mountZone(zoneId: string): void {
    const zone = this.ctx.zones.get(zoneId);
    const raw = this.ctx.rawMaps.get(zoneId);
    if (zone === undefined || raw === undefined) {
      throw new Error(`Zona "${zoneId}" non caricata`);
    }

    this.view?.destroy();
    this.view = renderZone(this, zoneId, raw);
    this.mountedZoneId = zoneId;
    this.cameras.main.setBounds(0, 0, this.view.widthPx, this.view.heightPx);
    this.snapNextFrame = true;
    this.ctx.onZoneChanged(zone);
  }

  private checkExit(): void {
    const state = this.ctx.store.getState();
    const zone = this.ctx.zones.get(state.player.zoneId);
    if (zone === undefined) return;

    const exit = exitUnder(zone, { ...state.player, moving: false });
    if (exit === undefined) return;

    const destination = this.ctx.zones.get(exit.toZone);
    if (destination === undefined) return;

    const spawn = findSpawn(destination, exit.toSpawn);
    this.ctx.store.dispatch({
      type: 'enterZone',
      zoneId: exit.toZone,
      x: spawn.x,
      y: spawn.y,
    });
    this.previous = { x: spawn.x, y: spawn.y };
    this.mountZone(exit.toZone);
  }

  /**
   * Incontro nell'erba alta.
   *
   * Si misura la distanza davvero percorsa nel tick, non il tempo: camminare
   * lentamente non deve essere un modo di evitare gli incontri. Restituisce
   * vero quando lo scontro parte, così il ciclo si ferma subito invece di
   * simulare altri tick di un mondo ormai in pausa.
   */
  private checkEncounter(before: { x: number; y: number }): boolean {
    if (!this.ctx.canEncounter()) return false;

    const state = this.ctx.store.getState();
    const zone = this.ctx.zones.get(state.player.zoneId);
    if (zone === undefined) return false;

    const distance = Math.hypot(state.player.x - before.x, state.player.y - before.y);
    if (distance <= 0) return false;

    const tx = Math.floor(state.player.x / zone.tileSize);
    const ty = Math.floor(state.player.y / zone.tileSize);
    if (!triggersEncounter(zone, this.ctx.tileRules, tx, ty)) return false;

    const encounter = this.ctx.rollEncounter(distance, zone.id);
    if (encounter === undefined) return false;

    this.ctx.onEncounter(encounter);
    return true;
  }

  private tryInteract(): void {
    const state = this.ctx.store.getState();
    const zone = this.ctx.zones.get(state.player.zoneId);
    if (zone === undefined) return;

    const sign = facingSign(zone, { ...state.player, moving: false });
    if (sign !== undefined) this.ctx.onSignRead(sign.textKey);
  }

  /* --------------------------------------------------------------- disegno */

  private draw(delta: number): void {
    const state = this.ctx.store.getState();
    const sprite = this.player;
    if (sprite === undefined) return;

    const alpha = this.snapNextFrame ? 1 : Math.min(1, this.accumulator / TICK_MS);
    this.snapNextFrame = false;

    const x = lerp(this.previous.x, state.player.x, alpha);
    const y = lerp(this.previous.y, state.player.y, alpha);

    const moving =
      Math.abs(state.player.x - this.previous.x) > 0.01 ||
      Math.abs(state.player.y - this.previous.y) > 0.01;

    // Un'oscillazione di un pixel: non e' un'animazione vera (arriva con gli
    // sprite definitivi) ma toglie l'effetto "icona che scivola".
    this.bobPhase = moving ? this.bobPhase + delta : 0;
    const bob = moving ? Math.round(Math.sin(this.bobPhase / 90)) : 0;

    sprite.setPosition(x, y + this.ctx.config.player.spriteOffsetY + bob);
    sprite.setFrame(facingFrame(state.player.facing));

    const clock = readClock(state.world.gameTimeMs, this.ctx.config.time);
    const light = ambientAt(clock.hourFloat, this.ctx.config.time.ambient);
    this.ambient?.setFillStyle(light.color, light.alpha);
  }
}
