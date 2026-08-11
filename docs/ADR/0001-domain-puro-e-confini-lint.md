# ADR 0001 — `src/domain` è puro, e il confine è una regola di lint

**Stato**: accettata · **Data**: 11 agosto 2026 · **Fase**: 0

## Contesto

Il PDR §6.2 definisce una regola "non negoziabile": `src/domain/**` non importa mai
Phaser né tocca il DOM. Il PDR stesso la definisce «l'errore numero uno dei giochi
browser scritti in fretta».

Il problema è che una regola scritta in un documento non è una regola: è un auspicio.
La fase in cui verrà violata è prevedibile — la Fase 4 (la base), dove serve leggere
"che ora è" dentro un calcolo di produzione e la scorciatoia `Date.now()` è a portata
di mano. A quel punto la simulazione offline non è più verificabile, e il criterio di
accettazione della Fase 4 diventa non testabile.

## Decisione

I confini sono espressi in `eslint.config.js` come errori:

| Confine                                                                           | Meccanismo                                         |
| --------------------------------------------------------------------------------- | -------------------------------------------------- |
| Phaser solo in `src/engine/**`                                                    | `no-restricted-imports` con `paths` (match esatto) |
| `domain` non importa layer impuri                                                 | `no-restricted-imports` con `patterns`             |
| Niente `Math.random()`, `Date.now()`, `new Date()` in `domain`                    | `no-restricted-syntax`                             |
| Niente `window`, `document`, `localStorage`, `console`, `setTimeout`… in `domain` | `no-restricted-globals`                            |
| Niente `innerHTML` in tutto `src`                                                 | `no-restricted-syntax`                             |
| Niente stringhe visibili hardcoded in `ui` e `scenes`                             | `no-restricted-syntax`                             |

E, soprattutto: `scripts/boundaries.test.ts` verifica che ognuna di queste regole
**scatti davvero**, lintando snippet di codice violante e controllando che l'errore
esca. Il test protegge dal modo tipico in cui un confine muore, che non è qualcuno che
lo viola ma qualcuno che commenta tre righe di configurazione per sbloccarsi.

Corollari già implementati:

- `src/domain/clock.ts` definisce l'interfaccia `Clock`; l'unica implementazione che
  legge l'orologio di sistema è `src/state/systemClock.ts`.
- `src/domain/rng.ts` è l'unica sorgente di casualità, ed è seeded.
- `src/engine/phaser.ts` è l'unico file che scrive `from 'phaser'`.

## Conseguenze

**Positive.** La logica di gioco si testa in millisecondi senza avviare un browser.
La simulazione offline può usare gli stessi riduttori di quella online (vedi ADR 0002).
Una migrazione a Phaser 5 tocca una cartella sola.

**Negative.** Passare il `Clock` e il `Rng` come argomenti rende le firme più lunghe.
È un costo reale e va accettato: è il prezzo della testabilità.

**Nota di attrito noto.** `no-restricted-imports` usa per i `patterns` una semantica
alla gitignore: il gruppo `'phaser'` catturava anche `@engine/phaser`. Per questo il
divieto su Phaser è espresso come `paths` (match esatto) e non come `patterns`.

## Alternative scartate

- **Convenzione documentata senza lint.** È lo stato di partenza del PDR. Scartata:
  è esattamente ciò che il PDR stesso indica come il rischio da mitigare.
- **Pacchetti separati / monorepo** con dipendenze imposte dal package manager.
  Sovradimensionato per un progetto da una persona; aggiunge attrito a ogni file nuovo.
- **`eslint-plugin-boundaries`.** Più espressivo, ma una dipendenza in più per
  esprimere cinque regole che le regole native coprono già.
