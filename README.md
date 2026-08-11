# Feralis

> _Nulla si doma davvero._

Gioco 2D top-down nel browser: esplori un arcipelago, catturi creature originali (i
**Ferali**), le usi in combattimento a turni e **le assegni come lavoratori** in una
**Radura** che produce risorse anche mentre non giochi.

Gratuito, senza account, senza backend. Il salvataggio resta sul tuo dispositivo.

**Gioca**: https://the0x1d3.github.io/Games-Feralis/

## Cosa lo distingue

Ogni creatura ha **due schede indipendenti**: una di combattimento e una di lavoro. Il
Ferale che perde ogni scontro può essere il migliore in fornace. Catturare non è
collezionare doppioni: è cercare lo strumento giusto.

## Stato

**Fase 0 — Fondamenta.** Toolchain, confini architetturali, RNG deterministico, i18n,
deploy automatico. Il mondo esplorabile arriva nella Fase 1.

La roadmap completa è in [`docs/PDR.md`](docs/PDR.md) §7.

## Sviluppo

```bash
npm install
npm run dev
```

| Comando                 | Cosa fa                                           |
| ----------------------- | ------------------------------------------------- |
| `npm run dev`           | server di sviluppo                                |
| `npm run test`          | Vitest, inclusi i test sui confini architetturali |
| `npm run lint`          | ESLint: confini + stile                           |
| `npm run validate:data` | Zod su `/data`, parità delle lingue, chiavi i18n  |
| `npm run build`         | build di produzione                               |
| `npm run size-check`    | budget 12 MB                                      |
| `npm run verify`        | tutto quanto sopra, nell'ordine della CI          |

### Regole del progetto

`src/domain/` è logica pura: niente Phaser, niente DOM, niente `Date.now()`, niente
`Math.random()`. Non è una convenzione — è ESLint, e
[`scripts/boundaries.test.ts`](scripts/boundaries.test.ts) verifica che le regole
scattino davvero.

Il perché è in [`docs/ADR/`](docs/ADR/). Le istruzioni operative sono in
[`CLAUDE.md`](CLAUDE.md).

## Documentazione

| Documento                            | Contenuto                              |
| ------------------------------------ | -------------------------------------- |
| [`docs/PDR.md`](docs/PDR.md)         | Specifica completa e fonte di verità   |
| [`docs/ADR/`](docs/ADR/)             | Decisioni architetturali, una per file |
| [`docs/BACKLOG.md`](docs/BACKLOG.md) | Idee fuori dall'MVP                    |
| [`ASSETS.md`](ASSETS.md)             | Origine e licenza di ogni asset        |

## Licenza

Tutti gli asset sono originali o con licenza compatibile: vedi [`ASSETS.md`](ASSETS.md).
Nessun contenuto è ripreso da giochi esistenti.
