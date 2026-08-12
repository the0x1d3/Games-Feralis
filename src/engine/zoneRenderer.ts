import { DEPTH, LAYER, TEXTURE, TILESET_NAME } from './assets';
import { Phaser } from './phaser';

/**
 * Disegna una zona a partire dal suo JSON in formato Tiled.
 *
 * Il JSON arriva gia' in memoria (import dinamico, ADR 0003) e non dal loader
 * di Phaser: lo si registra nella cache dei tilemap con lo stesso formato che
 * userebbe `load.tilemapTiledJSON`, cosi' il parser di Phaser resta quello
 * ufficiale e in Fase 6 basta cambiare la sorgente.
 *
 * La collisione NON viene impostata qui: vive in `src/domain/world/collision.ts`
 * e non passa dal motore fisico (vedi il commento in quel file).
 */

export interface ZoneView {
  readonly widthPx: number;
  readonly heightPx: number;
  /**
   * Sostituisce le caselle di un ostacolo rimosso con il terreno che resta.
   *
   * Serve perche' l'aspetto di un ostacolo e' un tile, non uno sprite: tolto il
   * masso, la mappa deve smettere di disegnarlo. Il tile da mettere al suo
   * posto arriva dal dato (`clearedTile`), non da un'ipotesi del renderer.
   */
  clearTiles(tiles: ReadonlyArray<{ tx: number; ty: number }>, tileIndex: number): void;
  destroy(): void;
}

export function renderZone(scene: Phaser.Scene, zoneId: string, tiled: unknown): ZoneView {
  const cacheKey = `map:${zoneId}`;

  if (!scene.cache.tilemap.has(cacheKey)) {
    scene.cache.tilemap.add(cacheKey, {
      format: Phaser.Tilemaps.Formats.TILED_JSON,
      data: tiled,
    });
  }

  const map = scene.make.tilemap({ key: cacheKey });
  const tileset = map.addTilesetImage(TILESET_NAME, TEXTURE.terrain);
  if (tileset === null) {
    throw new Error(`Zona "${zoneId}": tileset "${TILESET_NAME}" non associabile alla texture`);
  }

  const layers = (
    [
      [LAYER.ground, DEPTH.ground],
      [LAYER.decor, DEPTH.decor],
      [LAYER.over, DEPTH.over],
    ] as const
  ).map(([name, depth]) => {
    const layer = map.createLayer(name, tileset, 0, 0);
    if (layer === null) {
      throw new Error(`Zona "${zoneId}": layer "${name}" assente dalla mappa`);
    }
    layer.setDepth(depth);
    return layer;
  });

  const ground = layers[0];

  return {
    widthPx: map.widthInPixels,
    heightPx: map.heightInPixels,
    clearTiles(tiles, tileIndex): void {
      // I gid di Tiled sono 1-based: l'indice 0-based del dato va spostato di 1.
      for (const tile of tiles) ground?.putTileAt(tileIndex + 1, tile.tx, tile.ty);
    },
    destroy(): void {
      for (const layer of layers) layer.destroy();
      map.destroy();
    },
  };
}
