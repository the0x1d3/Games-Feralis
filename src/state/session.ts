import type { Clock } from '@domain/clock';
import { createCreature } from '@domain/creature/instance';
import { findSpawn } from '@domain/world/zone';
import { loadGame, saveGame, storageKind, type SlotId } from '@save/storage';
import { createNewGame, type GameState } from './gameState';
import { loadContent, type GameContent } from './loadContent';
import { loadWorld, type LoadedWorld } from './loadWorld';
import { createRngRuntime, type RngRuntime } from './rngRuntime';
import { createStore, type Store } from './store';

/**
 * Mette insieme mondo, stato e persistenza, e tiene vivo l'autosalvataggio.
 *
 * L'autosalvataggio scatta a intervalli, quando la scheda passa in secondo
 * piano e alla chiusura della pagina (PDR §6.4). I due eventi contano piu'
 * dell'intervallo: su mobile una scheda puo' essere terminata senza preavviso,
 * e `pagehide` e' l'ultimo momento utile per non perdere la partita.
 */

const SLOT: SlotId = 1;

export interface SessionOptions {
  readonly clock: Clock;
  readonly gameVersion: string;
  readonly onSaveStateChange: (savedAt: number | undefined) => void;
}

export interface Session {
  readonly store: Store;
  readonly world: LoadedWorld;
  readonly content: GameContent;
  readonly rng: RngRuntime;
  /** Vero se lo slot principale era illeggibile e si e' ripescato il backup. */
  readonly recoveredFromBackup: boolean;
  save(): Promise<void>;
  dispose(): void;
}

function resolveInitialState(
  world: LoadedWorld,
  loaded: GameState | undefined,
  options: SessionOptions,
): GameState {
  if (loaded !== undefined && world.zones.has(loaded.player.zoneId)) return loaded;

  // Salvataggio assente, oppure che punta a una zona non piu' esistente (puo'
  // succedere fra due versioni): si riparte dall'inizio invece di lasciare il
  // giocatore in un mondo che non c'e'.
  const startZone = world.zones.get(world.config.startZoneId);
  if (startZone === undefined) {
    throw new Error(`La zona iniziale "${world.config.startZoneId}" non esiste`);
  }
  const spawn = findSpawn(startZone, world.config.startSpawn);

  return createNewGame({
    now: options.clock.now(),
    masterSeed: options.clock.now() >>> 0,
    gameVersion: options.gameVersion,
    config: world.config,
    spawn: { x: spawn.x, y: spawn.y },
  });
}

export async function startSession(options: SessionOptions): Promise<Session> {
  const [world, content] = await Promise.all([loadWorld(), loadContent()]);
  const loaded = await loadGame(SLOT);
  const initial = resolveInitialState(world, loaded?.state, options);

  const rng = createRngRuntime(initial.rngStreams);
  const store = createStore(initial, {
    config: world.config,
    zones: world.zones,
    partySize: content.battle.partySize,
  });

  /*
   * Il primo Ferale è un regalo, non una cattura (PDR §3.4, minuto 0-2).
   *
   * La stessa regola serve due casi: una partita nuova e un salvataggio dello
   * schema 1, che la migrazione porta avanti con la squadra vuota. Un percorso
   * solo significa un comportamento solo da testare.
   */
  if (store.getState().party.length === 0) {
    const starterSpecies = content.species.get(world.config.starter.speciesId);
    if (starterSpecies === undefined) {
      throw new Error(`Il Ferale iniziale "${world.config.starter.speciesId}" non esiste`);
    }
    const creature = createCreature(
      {
        species: starterSpecies,
        level: world.config.starter.level,
        isAlpha: false,
        caughtAt: options.clock.now(),
      },
      content.creatures,
      rng.stream('world'),
    );
    store.dispatch({ type: 'grantCreature', creature, caught: false });
    store.dispatch({ type: 'syncRng', streams: rng.snapshot() });
  }

  let saving = false;

  async function save(): Promise<void> {
    if (saving) return;
    saving = true;
    options.onSaveStateChange(undefined);
    try {
      const now = options.clock.now();
      store.dispatch({ type: 'markSaved', at: now });
      // Gli stream RNG vivi sono la verita': lo store ne conserva solo la
      // fotografia iniziale, quindi al salvataggio si sovrascrivono.
      await saveGame(SLOT, { ...store.getState(), rngStreams: rng.snapshot() });
      options.onSaveStateChange(now);
    } finally {
      saving = false;
    }
  }

  const timer = setInterval(() => {
    void save();
  }, world.config.save.autosaveIntervalMs);

  const onVisibility = (): void => {
    if (document.visibilityState === 'hidden') void save();
  };
  const onPageHide = (): void => {
    void save();
  };

  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('pagehide', onPageHide);

  return {
    store,
    world,
    content,
    rng,
    recoveredFromBackup: loaded?.fromBackup === true,
    save,
    dispose(): void {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', onPageHide);
    },
  };
}

export { storageKind };
