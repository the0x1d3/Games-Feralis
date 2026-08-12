# Feralis — istruzioni per Claude Code

## Cos'è

Browser game 2D creature-collector + base automation. TypeScript + Vite + Phaser 4.
Deploy statico su GitHub Pages: `https://the0x1d3.github.io/Games-Feralis/`.
Nessun backend, mai.

Lessico di gioco (per i testi, mai per gli identificatori):
creature = **Ferali** (sing. Ferale) · strumento di cattura = **Nodo** · base = **Radura**.

## Fonte di verità

`docs/PDR.md`. Se una richiesta contraddice il PDR, segnalalo prima di implementare.
Le correzioni già applicate al PDR originale sono elencate nella sua §0 (Errata).

## Regole non negoziabili

1. `src/domain/**` è logica **pura**: nessun import di Phaser, nessun accesso al DOM,
   nessun `Date.now()` diretto (usa il `Clock` iniettato), nessun `Math.random()`
   (usa il RNG seeded). Queste regole sono ESLint, non buone intenzioni, e
   `scripts/boundaries.test.ts` verifica che scattino davvero.
2. Nessun numero di bilanciamento nel codice: sta in `/data/*.json`, validato con Zod.
   Le costanti _tecniche_ (`TICK_MS`, dimensione del tile, risoluzione) restano nel codice.
3. Nessuna stringa visibile all'utente hardcoded: solo chiavi i18n. Vale **da subito**,
   non dalla Fase 7.
4. Ogni nuova regola di gioco arriva con un test Vitest nello stesso commit.
5. Gli `id` in `/data` sono immutabili. Cambiare uno schema di salvataggio richiede
   una migrazione in `src/state/migrations.ts` + un test che carica un vecchio save.
6. **Phaser 4 ≠ Phaser 3.** Prima di usare una API non banale leggi la skill ufficiale
   in `node_modules/phaser/skills/<argomento>/SKILL.md` — il pacchetto ne include 28,
   fra cui `v3-to-v4-migration`, `scenes`, `tilemaps`, `input-keyboard-mouse-touch`,
   `physics-arcade`, `scale-and-responsive`. **Non copiare pattern da tutorial Phaser 3**:
   sono la fonte di errore numero uno su questo stack.
7. Niente path assoluti: usa `import.meta.env.BASE_URL` (nel codice) o percorsi
   relativi `./` (in `index.html`). Il gioco deve restare spostabile su un'altra
   origine senza modifiche.
8. File sotto le 300 righe. Se cresce, si divide per responsabilità.

## Struttura

```
data/maps/     mappe in formato Tiled (generate, vedi ADR 0005)
data/species/  una specie per file, id immutabile = nome del file
data/world/    tiles.json, world.json, encounters.json
data/          battle.json, creatures.json, moves.json, items.json
data/locales/  traduzioni IT/EN
scripts/       guardie di CI + generatori: validate-data, size-check,
               boundaries.test, gen-assets, author-maps, balance-sim
src/domain/    ⭐ logica pura, zero dipendenze impure — è dove vive il gioco
  world/       tempo, collisioni, movimento, interazione, incontri, Tiled
  battle/      ATB, danno, tipi, stati, cattura, IA, macchina a stati
  creature/    specie, statistiche, esperienza, evoluzione, squadra e deposito
  economy/     oggetti consumabili
src/engine/    l'unica cartella che importa Phaser
src/scenes/    viste: leggono lo stato e disegnano. Nessuna regola di gioco.
src/state/     store, riduttori, migrazioni, sessione, caricamento contenuti
src/save/      serializzazione, storage, codici di scambio
src/ui/        pannelli DOM sopra il canvas (HUD, dialoghi, combattimento)
src/i18n/      traduzioni
docs/ADR/      una decisione architetturale per file
```

## Bilanciamento

I numeri non si scelgono a occhio: si cambia un JSON in `/data` e si esegue
`npm run balance:sim`, che simula 1000 combattimenti e **fallisce** se la durata
mediana esce da 20–40 s o se la cattura di una Comune a HP pieni esce da 25–35%.
Fa parte di `npm run verify` e della CI.

## Come si verifica il gioco senza browser

Phaser mette in pausa il game loop quando la pagina non è visibile, quindi un
browser automatizzato non può guidare una partita. La simulazione vive invece in
`src/state/store.test.ts`: esegue gli stessi tick della scena e verifica
percorsi, transizioni di zona, orologio e salvataggio. Se una regola di gioco
non è verificabile lì, è nel posto sbagliato.

In sviluppo `window.__feralis` espone store, mondo e `step(frames)` per far
avanzare il ciclo a mano dalla console. Il blocco è dentro `import.meta.env.DEV`
e non finisce nella build di produzione.

## Comandi

```
npm run dev            server di sviluppo
npm run test           Vitest (include i test sui confini e la simulazione di gioco)
npm run test:watch
npm run lint           ESLint: confini architetturali + stile
npm run validate:data  Zod su /data + parità lingue + chiavi i18n + integrità mappe
npm run assets:gen     rigenera tileset e sprite placeholder (deterministico)
npm run maps:build     rigenera data/maps/*.json dall'ASCII (vedi ADR 0005)
npm run balance:sim    simulatore di bilanciamento (dalla Fase 2)
npm run build
npm run size-check     budget 12 MB, fallisce se superato
npm run verify         tutto quanto sopra, nell'ordine della CI
```

## Definition of done di ogni task

- `npm run verify` verde
- niente `any`, niente `@ts-ignore`
- se hai preso una decisione architetturale, scrivi un ADR in `docs/ADR/`
- se hai aggiunto un asset, aggiorna `ASSETS.md` **nello stesso commit**

## Anti-pattern vietati esplicitamente

- Logica di gioco dentro le scene Phaser → impossibile da testare, si riscrive in Fase 4.
- Salvataggio senza `schemaVersion` → primo update = tutti i giocatori ripartono da zero.
- Un `GameManager.ts` da 2000 righe che sa tutto.
- Bilanciamento a occhio senza `balance-sim.ts`.
- Asset non compressi committati direttamente.
- Sistemi aggiunti "perché ce li ha Palworld" → l'MVP non arriva mai.
  Ogni idea fuori dai tre pilastri va in `docs/BACKLOG.md`, non nel codice.
