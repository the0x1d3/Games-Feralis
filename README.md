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

**Fase 4 — La Radura.** Tre zone percorribili (Costa, Bosco, Altopiano), ciclo
giorno/notte da 24 minuti reali, incontri nell'erba alta, combattimento a turni con
barra ATB, sei tipi in due triangoli, undici specie con tre linee evolutive, cattura
con la percentuale **visibile prima di lanciare il Nodo**, deposito, esperienza,
livelli e soprannomi — e ora il Totem, nove strutture produttive, i Ferali assegnati
al lavoro e la produzione che continua **mentre la scheda è chiusa**, fino a otto ore.

Il recupero offline non è una formula a parte: è lo stesso codice del gioco, chiamato
a segmenti invece che a tick, e un test verifica che i due percorsi diano risultati
identici fino all'unità ([ADR 0002](docs/ADR/0002-simulazione-a-segmenti-omogenei.md)).

La roadmap è in [`docs/PDR.md`](docs/PDR.md) §7.

Il gioco riempie la finestra e l'interfaccia vive **dentro** la schermata, non
accanto: orologio, zona e pannelli galleggiano sul mondo. Una schermata di
ingresso spiega in due righe di cosa si tratta e dà il gesto di avvio.

Comandi: **frecce o WASD** per muoverti, **E** o **Spazio** per interagire, **S**
per la squadra, **B** per la Radura, **Esc** per chiudere. Tutto è raggiungibile da
tastiera. Per ora è pensato per il desktop; il touch arriva in Fase 7.

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
| `npm run balance:sim`   | 1000 combattimenti: durata e tasso di cattura     |
| `npm run balance:base`  | otto ore di Radura: autosufficienza e resa        |
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
