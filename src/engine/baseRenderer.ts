import type { BaseConfig, StructureDef } from '@domain/base/config';
import type { BaseState } from '@domain/base/state';
import { DEPTH, STRUCTURE_FRAME, TEXTURE } from './assets';
import { type Phaser } from './phaser';

/**
 * Disegna la Radura: area rivendicata, strutture, fantasma della costruzione.
 *
 * Nessuna validazione qui dentro: se una casella e' buona lo decide
 * `domain/base/layout.ts`, e la scena si limita a colorare il fantasma di verde
 * o di rosso in base a quella risposta. Una regola che vive nel disegno si
 * aggira con un pulsante dimenticato.
 */

export interface BaseViewDeps {
  readonly structures: ReadonlyMap<string, StructureDef>;
  readonly config: BaseConfig;
  readonly tileSize: number;
}

export interface Ghost {
  readonly def: StructureDef;
  readonly tx: number;
  readonly ty: number;
  readonly ok: boolean;
}

export interface BaseView {
  /** Riallinea il disegno allo stato. Ridisegna solo se qualcosa e' cambiato. */
  sync(base: BaseState, zoneId: string): void;
  setGhost(ghost: Ghost | undefined): void;
  destroy(): void;
}

const CLAIM_COLOR = 0xffd479;
const OK_TINT = 0x88ff88;
const NO_TINT = 0xff8888;

/** Impronta e posizione dello sprite non coincidono: vedi STRUCTURE_FRAME. */
function frameOrigin(tx: number, ty: number, tileSize: number): { x: number; y: number } {
  return { x: tx * tileSize, y: ty * tileSize };
}

export function createBaseView(scene: Phaser.Scene, deps: BaseViewDeps): BaseView {
  const sprites = new Map<string, Phaser.GameObjects.Image>();
  const claim = scene.add.graphics().setDepth(DEPTH.claim);

  const ghost = scene.add
    .image(0, 0, TEXTURE.structures, 0)
    .setOrigin(0, 0)
    .setDepth(DEPTH.ghost)
    .setAlpha(0.55)
    .setVisible(false);

  let signature = '';

  function drawClaim(base: BaseState, zoneId: string): void {
    claim.clear();
    const totem = base.totem;
    if (totem === undefined || totem.zoneId !== zoneId) return;

    const centerX = (totem.tx + 1) * deps.tileSize;
    const centerY = (totem.ty + 1) * deps.tileSize;
    const radius = deps.config.totemRadiusTiles * deps.tileSize;

    claim.fillStyle(CLAIM_COLOR, 0.06);
    claim.fillCircle(centerX, centerY, radius);
    claim.lineStyle(2, CLAIM_COLOR, 0.4);
    claim.strokeCircle(centerX, centerY, radius);
  }

  function drawStructures(base: BaseState, zoneId: string): void {
    const alive = new Set<string>();

    if (base.totem?.zoneId === zoneId) {
      for (const placed of base.structures) {
        const def = deps.structures.get(placed.structureId);
        if (def === undefined) continue;

        const at = frameOrigin(placed.tx, placed.ty, deps.tileSize);
        let sprite = sprites.get(placed.id);
        if (sprite === undefined) {
          sprite = scene.add
            .image(at.x, at.y, TEXTURE.structures, def.frame)
            .setOrigin(0, 0)
            .setDepth(DEPTH.structure);
          sprites.set(placed.id, sprite);
        }
        sprite.setPosition(at.x, at.y).setFrame(def.frame);
        // Una struttura senza lavoratore resta visibile ma spenta: si vede a
        // colpo d'occhio dove manca qualcuno, senza aprire il pannello.
        sprite.setAlpha(placed.workerUid === undefined ? 0.65 : 1);
        alive.add(placed.id);
      }
    }

    for (const [id, sprite] of sprites) {
      if (alive.has(id)) continue;
      sprite.destroy();
      sprites.delete(id);
    }
  }

  return {
    sync(base, zoneId): void {
      // La firma evita di ricostruire le immagini a ogni frame: la Radura cambia
      // quando si costruisce o si assegna, non sessanta volte al secondo.
      const next = [
        zoneId,
        base.totem === undefined ? '-' : `${base.totem.zoneId}:${base.totem.tx},${base.totem.ty}`,
        base.structures
          .map((s) => `${s.id}@${s.tx},${s.ty}:${s.structureId}:${s.workerUid ?? ''}`)
          .join('|'),
      ].join('#');
      if (next === signature) return;
      signature = next;

      drawClaim(base, zoneId);
      drawStructures(base, zoneId);
    },

    setGhost(next): void {
      if (next === undefined) {
        ghost.setVisible(false);
        return;
      }
      const at = frameOrigin(next.tx, next.ty, deps.tileSize);
      ghost
        .setVisible(true)
        .setPosition(at.x, at.y)
        .setFrame(next.def.frame)
        .setTint(next.ok ? OK_TINT : NO_TINT);
    },

    destroy(): void {
      for (const sprite of sprites.values()) sprite.destroy();
      sprites.clear();
      claim.destroy();
      ghost.destroy();
    },
  };
}

export { STRUCTURE_FRAME };
