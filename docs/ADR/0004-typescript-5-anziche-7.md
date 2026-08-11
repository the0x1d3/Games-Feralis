# ADR 0004 — TypeScript 5.9, non 7.0

**Stato**: accettata · **Data**: 11 agosto 2026 · **Fase**: 0 · **Da rivedere**: quando
`typescript-eslint` dichiarerà il supporto a TypeScript 7

## Contesto

All'avvio del progetto la versione più recente pubblicata di TypeScript è la **7.0.2**
(la riscrittura nativa del compilatore). È molto più veloce, ed è la scelta ovvia
guardando solo al numero di versione.

Ma `typescript-eslint@8.67.0` dichiara:

```
peerDependencies: { typescript: '>=4.8.4 <6.1.0' }
```

Con TypeScript 7 il linting **type-aware** non è supportato. E il linting type-aware,
in questo progetto, non è un contorno: è il meccanismo che tiene in piedi i confini
architetturali dell'ADR 0001. Un linter degradato significa un `src/domain` che diventa
impuro senza che nessuno se ne accorga.

## Decisione

Si pinna **TypeScript 5.9.3**.

Il resto della toolchain resta all'ultima versione: Vite 8.2.1, Vitest 4.1.10,
ESLint 10.8.1, Zod 4.4.3, Phaser **4.2.1 pinnato esatto** (senza `^`, come chiede il
PDR §6.1).

## Conseguenze

**Positive.** ESLint con type information funziona, quindi i confini sono verificati
davvero. Nessuna incompatibilità da diagnosticare durante la Fase 1.

**Negative.** Si rinuncia alla velocità del compilatore nativo. Su una base di codice
di questa dimensione la differenza è irrilevante: il typecheck completo è oggi sotto
il secondo.

**Quando rivedere.** Quando `typescript-eslint` alzerà il tetto della peer dependency.
Il cambiamento sarà una riga in `package.json` e una esecuzione di `npm run verify`.

## Alternative scartate

- **TypeScript 7 con linting non type-aware.** Scambia la garanzia architetturale con
  qualche centinaio di millisecondi. È il baratto sbagliato: la velocità di compilazione
  non è mai stata un problema di questo progetto, la deriva architetturale sì.
- **TypeScript 7 con `typescript-eslint` in versione pre-release.** Introduce
  instabilità in Fase 0, cioè nell'unico punto del progetto dove tutto deve essere noioso.
