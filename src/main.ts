import './ui/styles.css';

import { checkEncounter } from '@domain/world/encounters';
import { readClock } from '@domain/world/time';
import { findSpawn } from '@domain/world/zone';
import { createGame } from '@engine/index';
import { detectLocale, setLocale } from '@i18n/index';
import { BattleScene } from '@scenes/Battle';
import { WorldScene } from '@scenes/World';
import { createBattleController } from '@state/battleController';
import { startSession, storageKind } from '@state/session';
import { systemClock } from '@state/systemClock';
import { mountBattleUi } from '@ui/battleUi';
import { mountDialog } from '@ui/dialog';
import { mountHud } from '@ui/hud';

/**
 * Punto di ingresso. Qui, e solo qui, il mondo impuro (DOM, orologio, browser)
 * incontra il resto del progetto.
 */

const GAME_VERSION = '0.3.0';

function requireElement(id: string): HTMLElement {
  const node = document.getElementById(id);
  if (node === null) throw new Error(`Elemento #${id} assente da index.html`);
  return node;
}

async function bootstrap(): Promise<void> {
  setLocale(detectLocale(navigator.languages));

  const overlay = requireElement('ui-overlay');
  const hud = mountHud(requireElement('brand'), overlay);
  const dialog = mountDialog(overlay);

  const session = await startSession({
    clock: systemClock,
    gameVersion: GAME_VERSION,
    onSaveStateChange: (savedAt) => {
      hud.setSaved(savedAt);
    },
  });

  if (storageKind() === 'localstorage') hud.showStorageWarning();

  const { store, world, content, rng } = session;
  const config = world.config;
  const save = (): Promise<void> => session.save();

  const isNight = (): boolean =>
    readClock(store.getState().world.gameTimeMs, config.time).phase === 'night';

  const battle = createBattleController({
    store,
    content,
    rng,
    clock: systemClock,
    isNight,
    onDefeat: () => {
      // Ci si risveglia dove è cominciata la partita. In Fase 4 diventerà il
      // Totem della Radura, e allora avrà senso anche la penalità del PDR §5.6.
      const startZone = world.zones.get(config.startZoneId);
      if (startZone === undefined) return;
      const spawn = findSpawn(startZone, config.startSpawn);
      store.dispatch({ type: 'enterZone', zoneId: startZone.id, x: spawn.x, y: spawn.y });
      hud.setZone(startZone.nameKey);
    },
  });

  const battleUi = mountBattleUi(overlay, {
    getState: () => store.getState(),
    context: () => battle.context(),
    submit: (action) => {
      battle.submit(action);
    },
    end: () => {
      battle.end();
    },
  });

  const initialZone = world.zones.get(store.getState().player.zoneId);
  if (initialZone !== undefined) hud.setZone(initialZone.nameKey);
  hud.setClock(readClock(store.getState().world.gameTimeMs, config.time));

  store.subscribe((state) => {
    hud.setClock(readClock(state.world.gameTimeMs, config.time));
    hud.setParty(state.party.length);
  });
  hud.setParty(store.getState().party.length);

  const worldScene = new WorldScene({
    store,
    config,
    zones: world.zones,
    rawMaps: world.rawMaps,
    tileRules: world.tileRules,
    onSignRead: (textKey) => {
      dialog.toggle(textKey);
    },
    onZoneChanged: (zone) => {
      dialog.hide();
      hud.setZone(zone.nameKey);
      // Cambiare zona è un momento sensato per fissare i progressi: è anche il
      // punto in cui un giocatore chiude la scheda.
      void save();
    },
    rollEncounter: (distancePx, biome) =>
      checkEncounter(
        {
          distancePx,
          onEncounterTile: true,
          biome,
          isNight: isNight(),
          species: content.species.values(),
        },
        world.encounters,
        rng.stream('world'),
      ),
    canEncounter: () => battle.current() === undefined && store.getState().party.length > 0,
    onEncounter: (encounter) => {
      dialog.hide();
      battle.start(encounter);
      // Dal livello del gioco si usa `run` e non `launch`: quest'ultimo esiste
      // solo sul plugin di scena, cioè dentro una scena.
      game.scene.pause(WorldScene.KEY);
      game.scene.run(BattleScene.KEY);
    },
  });

  const battleScene = new BattleScene({ controller: battle });

  battle.subscribe(() => {
    const active = battle.current();
    battleUi.render(active);

    if (active === undefined && game.scene.isActive(BattleScene.KEY)) {
      game.scene.stop(BattleScene.KEY);
      game.scene.resume(WorldScene.KEY);
      worldScene.syncZone();
      store.dispatch({ type: 'syncRng', streams: rng.snapshot() });
      void save();
    }
  });

  const game = createGame({
    parent: requireElement('game-canvas'),
    scenes: [worldScene, battleScene],
  });

  /*
   * Sonda di sviluppo. `import.meta.env.DEV` è falso nella build di produzione,
   * quindi Vite elimina del tutto questo blocco: non è un gancio di test
   * lasciato nel gioco. Serve a ispezionare lo stato dalla console e ad
   * avanzare il ciclo a mano quando la scheda è in secondo piano — Phaser mette
   * in pausa il game loop quando la pagina non è visibile, il che è corretto ma
   * rende impossibile verificare qualsiasi cosa da un browser automatizzato.
   */
  if (import.meta.env.DEV) {
    (window as unknown as Record<string, unknown>)['__feralis'] = {
      store,
      world,
      content,
      battle,
      game,
      save,
      step: (frames: number, deltaMs = 1000 / 60): void => {
        for (let i = 0; i < frames; i += 1) {
          game.step(performance.now() + i * deltaMs, deltaMs);
        }
      },
    };
  }
}

void bootstrap();
