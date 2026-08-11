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
data/        contenuto di gioco in JSON, versionato, validato in CI
scripts/     guardie di CI: validate-data, size-check, boundaries.test, balance-sim
src/domain/  ⭐ logica pura, zero dipendenze impure — è dove vive il gioco
src/engine/  l'unica cartella che importa Phaser
src/scenes/  viste: leggono lo stato e disegnano. Nessuna regola di gioco.
src/state/   store, azioni, selettori, migrazioni, orologio di sistema
src/save/    serializzazione, storage, codici di scambio
src/ui/      pannelli DOM sopra il canvas
src/i18n/    traduzioni
docs/ADR/    una decisione architetturale per file
```

## Comandi

```
npm run dev            server di sviluppo
npm run test           Vitest (include i test sui confini)
npm run test:watch
npm run lint           ESLint: confini architetturali + stile
npm run validate:data  Zod su /data + parità delle lingue + chiavi i18n usate
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
