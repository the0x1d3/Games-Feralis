# ADR 0003 — Come `/data` arriva al client, e come viene validato

**Stato**: accettata · **Data**: 11 agosto 2026 · **Fase**: 0

## Contesto

Il PDR §6.2 mette il contenuto di gioco in `/data`, fuori da `public/`. Vite non serve
quella cartella come statica, quindi il PDR non dice **come** i JSON raggiungano il
browser. Le due strade hanno conseguenze opposte sul budget di §3.3 (primo caricamento
giocabile ≤ 3 MB):

- **Import statico**: i dati finiscono nel bundle JS. Type-safety gratuita, hash e
  cache gestiti da Vite, nessuna richiesta di rete in più — ma tutto pesa sul primo
  caricamento.
- **`fetch` a runtime** da `public/data/`: caricamento pigro per scena, ma nessun
  controllo di tipo, un percorso da costruire a mano (che invita ai path assoluti,
  vietati dalla regola 7) e la gestione degli errori di rete.

## Decisione

**Import statico per i dati piccoli e sempre necessari, import dinamico per i dati
voluminosi e specifici di una scena.**

| Dato                                        | Come                | Perché                                                |
| ------------------------------------------- | ------------------- | ----------------------------------------------------- |
| `locales/*.json`, `moves`, `items`, `types` | `import` statico    | pochi kB, servono ovunque, e le chiavi diventano tipi |
| `species/*` per bioma, `tilemaps`           | `import()` dinamico | si caricano quando si entra nel bioma                 |
| `structures`, `recipes`, `tech`             | `import()` dinamico | servono solo alla base e ai banchi                    |

Gli alias (`@data/*`) rendono i percorsi indipendenti dalla posizione del file, e
`import.meta.env.BASE_URL` resta l'unico modo di costruire URL.

La validazione **non** avviene a runtime nel client: sarebbe peso morto in ogni sessione
per proteggere da un errore che è già stato commesso a monte. Avviene in CI, con
`npm run validate:data`, e una build rotta blocca il merge (§6.3 regola 3).

In Fase 0 `scripts/validate-data.ts` controlla:

1. che ogni file di lingua sia un dizionario piatto `chiave → stringa non vuota`;
2. che IT ed EN abbiano **esattamente** le stesse chiavi;
3. che ogni chiave usata da un `t('...')` letterale nel codice esista davvero.

Il punto 2 merita una nota: il PDR promette due lingue "dal day one". Una chiave che
esiste solo in italiano è un buco che si scopre in produzione, in inglese, davanti a un
tester — cioè nel momento in cui costa di più.

Il controllo 3 è volutamente **letterale**: non segue le chiavi passate tramite
variabile, e quelle risultano "definite ma mai usate". È un avviso, non un errore,
perché il falso positivo è previsto e innocuo, mentre trasformarlo in errore
spingerebbe a disattivare il controllo.

## Conseguenze

**Positive.** Il primo caricamento resta piccolo. Le chiavi i18n sono un tipo
TypeScript (`TranslationKey`), quindi un refuso non compila. Nessun errore di rete da
gestire per i dati core.

**Negative.** Aggiungere un bioma significa aggiungere anche un punto di `import()`
dinamico: un passaggio in più che va documentato quando arriverà la Fase 6.

**Da fare nelle fasi successive.** Estendere `validate-data.ts` all'integrità
referenziale: ogni `moveId` in un `movepool` deve esistere in `moves.json`, ogni
`evolution.toId` deve puntare a una specie reale, ogni nodo tech deve essere
raggiungibile (il test anti-deadlock della Fase 5).

## Alternative scartate

- **Tutto in `public/` con fetch.** Perde la type-safety, che su 33 specie e 40 mosse
  è la rete di sicurezza principale.
- **Validazione Zod a runtime nel client.** Costo permanente per tutti i giocatori a
  fronte di un errore che la CI ha già escluso.
- **Un unico megafile `data.json`.** Comodo da caricare, impossibile da rivedere in una
  pull request e da modificare a mano — che è invece il punto di avere `/data`.
