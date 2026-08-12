import './ui/styles.css';

import { checkEncounter } from '@domain/world/encounters';
import { canClear } from '@domain/world/obstacles';
import { readClock } from '@domain/world/time';
import { findSpawn, type ObstacleObject, type Zone } from '@domain/world/zone';
import { createGame } from '@engine/index';
import { detectLocale, setLocale, t, type TranslationKey } from '@i18n/index';
import { BattleScene } from '@scenes/Battle';
import { WorldScene } from '@scenes/World';
import { createBattleController } from '@state/battleController';
import { startSession, storageKind } from '@state/session';
import { systemClock } from '@state/systemClock';
import { mountBase } from '@ui/base';
import { displayName } from '@ui/baseRows';
import { mountBattleUi } from '@ui/battleUi';
import { mountDialog } from '@ui/dialog';
import { mountHud } from '@ui/hud';
import { mountLanding } from '@ui/landing';
import { mountRoster } from '@ui/roster';
import { mountTech } from '@ui/tech';

/**
 * Punto di ingresso. Qui, e solo qui, il mondo impuro (DOM, orologio, browser)
 * incontra il resto del progetto.
 */

const GAME_VERSION = '0.4.0';

function requireElement(id: string): HTMLElement {
  const node = document.getElementById(id);
  if (node === null) throw new Error(`Elemento #${id} assente da index.html`);
  return node;
}

async function bootstrap(): Promise<void> {
  setLocale(detectLocale(navigator.languages));

  const overlay = requireElement('ui-overlay');

  /*
   * La schermata di ingresso si monta PRIMA di caricare la sessione: copre il
   * rettangolo nero del caricamento, e il clic su "Gioca" è anche il gesto
   * esplicito che in Fase 7 servirà a far partire l'audio.
   */
  const landing = mountLanding(requireElement('landing'), () => {
    landing.hide();
  });

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

  /**
   * Dove ci si risveglia dopo un KO: ai piedi del Totem se la Radura esiste,
   * altrimenti al punto di comparsa iniziale (PDR §4.6, errata E18).
   */
  const wakeUpPoint = (): { zone: Zone; x: number; y: number } | undefined => {
    const totem = store.getState().base.totem;
    const totemZone = totem === undefined ? undefined : world.zones.get(totem.zoneId);

    if (totem !== undefined && totemZone !== undefined) {
      // Una casella sotto il Totem: risvegliarsi dentro la sua impronta
      // significherebbe comparire incastrati in una collisione.
      return {
        zone: totemZone,
        x: (totem.tx + 1) * totemZone.tileSize,
        y: (totem.ty + 2.5) * totemZone.tileSize,
      };
    }

    const startZone = world.zones.get(config.startZoneId);
    if (startZone === undefined) return undefined;
    const spawn = findSpawn(startZone, config.startSpawn);
    return { zone: startZone, x: spawn.x, y: spawn.y };
  };

  const battle = createBattleController({
    store,
    content,
    rng,
    clock: systemClock,
    isNight,
    onDefeat: () => {
      const wake = wakeUpPoint();
      if (wake === undefined) return;

      store.dispatch({ type: 'enterZone', zoneId: wake.zone.id, x: wake.x, y: wake.y });
      // Si perde una frazione di quel che si portava addosso (PDR §4.6). Il
      // deposito della Radura non si tocca mai: E8.
      store.dispatch({ type: 'loseOnDefeat' });
      hud.setZone(wake.zone.nameKey);
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

  const roster = mountRoster(overlay, {
    getState: () => store.getState(),
    content,
    dispatch: (action) => {
      store.dispatch(action);
    },
    onOpen: () => {
      base.close();
    },
  });

  const base = mountBase(overlay, {
    getState: () => store.getState(),
    content,
    zones: world.zones,
    dispatch: (action) => {
      store.dispatch(action);
    },
    onOpen: () => {
      roster.close();
      tech.close();
    },
  });

  const tech = mountTech(overlay, {
    getState: () => store.getState(),
    content,
    dispatch: (action) => {
      store.dispatch(action);
    },
    onOpen: () => {
      roster.close();
      base.close();
    },
  });

  /**
   * Il tasto interagisci davanti a un ostacolo.
   *
   * Chi decide se si può rimuovere è `domain/world/obstacles.ts`: qui si
   * traduce il verdetto in una frase e, se è sì, si alza la bandiera.
   */
  const tryClearObstacle = (obstacle: ObstacleObject): void => {
    const state = store.getState();
    const workName = t(`work.${obstacle.work}` as TranslationKey);
    const check = canClear(obstacle, state.party, content.species, state.inventory);

    if (!check.ok) {
      const item = content.items.get(obstacle.requiresItem ?? '');
      dialog.show(
        t(`obstacle.refusal.${check.refusal ?? 'wrongWork'}` as TranslationKey, {
          work: workName,
          level: obstacle.level,
          item: item === undefined ? '' : t(item.nameKey as TranslationKey),
        }),
      );
      return;
    }

    store.dispatch({
      type: 'clearObstacle',
      zoneId: state.player.zoneId,
      obstacleId: obstacle.id,
    });
    worldScene.syncObstacles();
    dialog.show(
      t('obstacle.cleared', {
        who: check.by === undefined ? '' : displayName(check.by, content),
        name: t(obstacle.nameKey as TranslationKey),
      }),
    );
    void save();
  };

  const initialZone = world.zones.get(store.getState().player.zoneId);
  if (initialZone !== undefined) hud.setZone(initialZone.nameKey);
  hud.setClock(readClock(store.getState().world.gameTimeMs, config.time));

  store.subscribe((state) => {
    hud.setClock(readClock(state.world.gameTimeMs, config.time));
    hud.setParty(state.party.length);
    roster.refresh();
    base.refresh();
    tech.refresh();
  });
  hud.setParty(store.getState().party.length);

  // Il riepilogo del rientro compare una volta sola, e solo se c'è qualcosa da
  // dire: aprirlo per una ricarica di dieci secondi sarebbe rumore.
  if (session.offline !== undefined && Object.keys(session.offline.produced).length > 0) {
    base.showOffline(session.offline);
  }

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
    baseConfig: content.base,
    structureDefs: content.structures,
    buildGhost: () => base.ghost(),
    onBuildConfirm: () => {
      base.confirmBuild();
      void save();
    },
    onObstacle: tryClearObstacle,
    canEncounter: () =>
      battle.current() === undefined &&
      store.getState().party.length > 0 &&
      // Costruire non è il momento di incontrare qualcuno: si perderebbe la
      // struttura che si ha in mano insieme al filo del discorso.
      base.ghost() === undefined,
    onEncounter: (encounter) => {
      dialog.hide();
      // La squadra si gestisce fuori dallo scontro: dentro c'è già il menu
      // Cambia, e due pannelli aperti insieme sono solo confusione.
      roster.close();
      base.close();
      tech.close();
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

  landing.setReady();

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
      roster,
      base,
      session,
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
