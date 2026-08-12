import baseData from '@data/base.json';
import battleData from '@data/battle.json';
import creatureData from '@data/creatures.json';
import itemData from '@data/items.json';
import moveData from '@data/moves.json';
import structureData from '@data/structures.json';
import {
  parseBaseConfig,
  parseStructures,
  type BaseConfig,
  type StructureDef,
} from '@domain/base/config';
import { parseBattleConfig, type BattleConfig } from '@domain/battle/config';
import { parseSpecies, parseMoves, type Move, type Species } from '@domain/creature/species';
import { parseCreatureConfig, type CreatureConfig } from '@domain/creature/stats';
import { parseItems, type ItemDef } from '@domain/economy/items';

/**
 * Contenuto di gioco: mosse, specie, regole di combattimento.
 *
 * Le specie arrivano da un `import.meta.glob` non eager, così Vite ne fa chunk
 * separati (ADR 0003) e aggiungerne una in Fase 6 non richiede di toccare
 * questo file. Il glob vuole un percorso relativo letterale: gli alias non
 * vengono risolti a tempo di analisi.
 */

const SPECIES_MODULES = import.meta.glob<{ default: unknown }>('../../data/species/*.json');

export interface GameContent {
  readonly battle: BattleConfig;
  readonly creatures: CreatureConfig;
  readonly moves: ReadonlyMap<string, Move>;
  readonly species: ReadonlyMap<string, Species>;
  readonly items: ReadonlyMap<string, ItemDef>;
  readonly base: BaseConfig;
  readonly structures: ReadonlyMap<string, StructureDef>;
}

function speciesIdFromPath(path: string): string {
  return (
    path
      .split('/')
      .pop()
      ?.replace(/\.json$/, '') ?? path
  );
}

export async function loadContent(): Promise<GameContent> {
  const battle = parseBattleConfig(battleData);
  const creatures = parseCreatureConfig(creatureData);
  const moves = parseMoves(moveData);
  const items = parseItems(itemData);
  const base = parseBaseConfig(baseData);
  const structureDefs = parseStructures(structureData);

  const entries = await Promise.all(
    Object.entries(SPECIES_MODULES).map(async ([path, load]) => {
      const module = await load();
      const id = speciesIdFromPath(path);
      return [id, parseSpecies(module.default, id)] as const;
    }),
  );

  const species = new Map<string, Species>(entries);

  // Integrità referenziale: una mossa nel movepool che non esiste diventerebbe
  // un esemplare senza mosse, cioè un combattimento bloccato. `validate:data`
  // lo intercetta in CI, ma un controllo qui costa nulla e non lascia dubbi.
  for (const entry of species.values()) {
    for (const slot of entry.movepool) {
      if (!moves.has(slot.moveId)) {
        throw new Error(`La specie "${entry.id}" usa la mossa "${slot.moveId}", che non esiste`);
      }
    }

    // Un'evoluzione che punta a una specie inesistente è un vicolo cieco che si
    // manifesterebbe solo al livello soglia, cioè settimane dopo l'errore.
    const evolution = entry.evolution;
    if (evolution !== undefined && !species.has(evolution.toId)) {
      throw new Error(`La specie "${entry.id}" evolve in "${evolution.toId}", che non esiste`);
    }
  }

  return { battle, creatures, moves, species, items, base, structures: structureDefs };
}
