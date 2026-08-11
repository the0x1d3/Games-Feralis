# ADR 0005 — Le mappe si disegnano in ASCII e si esportano in formato Tiled

**Stato**: accettata · **Data**: 11 agosto 2026 · **Fase**: 1 · **Da rivedere**: Fase 6

## Contesto

Il PDR §6.1 indica Tiled come strumento di mappatura, con export in JSON. È la
scelta giusta per il contenuto definitivo: Tiled è fatto per disegnare a mano, e
la Fase 6 ha 4 zone da 64×64 tile da curare.

Ma in Fase 1 le mappe sono placeholder, con un tileset generato da uno script, e
serviranno decine di iterazioni rapide mentre si mette a punto il movimento. Un
file Tiled è un JSON con un array di 1200 numeri per layer: in una pull request
è illeggibile, e un errore di battitura non si vede finché non si cammina
esattamente su quella casella.

## Decisione

Le mappe si disegnano in **ASCII** dentro `scripts/author-maps.ts`, e lo script
le esporta come **JSON in formato Tiled** in `data/maps/*.json`.

```
'T:,,,,,,,,'   →  ground: tronco d'albero, over: chioma una casella più su
'=,,,,,,,,,'   →  sentiero, poi erba
```

Il file prodotto è un file Tiled valido: si apre in Tiled, si modifica e si
riesporta senza conversioni. Non è un formato parallelo, è lo stesso formato
raggiunto da una strada diversa.

Ogni riga è spezzata in quattro segmenti da dieci caratteri, e lo script
verifica le lunghezze. Contare fino a 40 a mano è il modo più rapido di
introdurre un bug invisibile.

Il comando è `npm run maps:build`. L'output è **committato**: è quello che il
gioco carica, e non deve dipendere dall'esecuzione di uno script per esistere.

## Conseguenze

**Positive.** Una modifica alla mappa si legge in un diff. Le tre zone si
riscrivono in minuti. La legenda dei caratteri documenta il tileset meglio di
qualsiasi commento, e lo script fallisce forte su un carattere sconosciuto o su
una riga di lunghezza sbagliata.

**Negative.** Ci sono due fonti per lo stesso contenuto — l'ASCII nello script e
il JSON committato — e possono divergere se qualcuno modifica il JSON a mano.
Finché la fonte è l'ASCII, il JSON va rigenerato e mai toccato.

**Quando rivedere.** In **Fase 6**, quando arrivano i contenuti veri: a quel
punto la fonte diventa Tiled, `scripts/author-maps.ts` si cancella e i file in
`data/maps/` diventano l'originale. Il formato non cambia, quindi la migrazione
non tocca il codice di gioco.

## Nota sul lettore

`src/domain/world/tiled.ts` legge il formato Tiled con controlli espliciti
invece di fidarsi di un cast, e traduce i `gid` 1-based di Tiled in indici
0-based con `-1` per la casella vuota. Il gioco usa **lo stesso file** per due
scopi diversi: Phaser lo passa al proprio parser per disegnare i layer, il
dominio lo legge per costruire la griglia di collisione e la lista degli
oggetti. Le collisioni non passano dal motore fisico di Phaser — vedi il
commento in `src/domain/world/collision.ts`.

## Alternative scartate

- **Disegnare subito in Tiled.** Corretto per la Fase 6, sproporzionato per
  placeholder che verranno buttati: richiede di installare e aprire un editor
  esterno per spostare un albero.
- **Array 2D direttamente in TypeScript, senza formato Tiled.** Più semplice
  ancora, ma butta via il parser di Phaser e obbliga a riscrivere il caricamento
  quando arriveranno le mappe vere.
- **Generazione procedurale.** Esplicitamente esclusa dal PDR (Appendice A,
  punto 3): tre biomi curati valgono più di trenta generati.
