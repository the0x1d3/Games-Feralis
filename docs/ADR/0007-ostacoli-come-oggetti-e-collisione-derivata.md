# ADR 0007 — Gli ostacoli sono oggetti della mappa, e la collisione si deriva

**Stato**: accettata · **Data**: 12 agosto 2026 · **Fase**: 5 · **Da rivedere**: Fase 6

## Contesto

Il PDR §4.3 fissa la "regola d'oro": ogni mansione deve sbloccare anche un
ostacolo nel mondo, così catturare per lavorare e catturare per esplorare sono
la stessa attività. In Fase 5 gli ostacoli diventano sei, uno per mansione, e il
criterio di accettazione chiede un percorso preciso: Estrazione 2 → masso →
Altopiano.

`data/world/tiles.json` aveva già un campo `clearedBy` su masso e arbusto,
pensato in Fase 1 come "la mansione che un giorno lo toglierà". Sembrava la
strada naturale: un ostacolo è un tile, e rimuoverlo è cambiare quel tile.

Non regge, per tre motivi.

**Un tile non ha identità.** In una zona ci sono nove massi. Se rimuovere un
masso significa "il tile 6 diventa il tile 5", allora o si tolgono tutti insieme
o serve una lista di coordinate — cioè un id, cioè un oggetto.

**La collisione è costruita una volta.** `buildCollisionGrid` gira al
caricamento della zona. Se il gioco cambia i tile a partita in corso, la griglia
va rigenerata o mutata: nel primo caso si paga tutto il costo per una casella,
nel secondo una struttura condivisa cambia sotto ai piedi di chi la sta
leggendo, che è il tipo di bug che si manifesta una volta ogni cento partite.

**Il salvataggio non deve contenere la mappa.** Salvare i tile modificati
significa che una correzione alla mappa in una versione futura non arriverebbe
mai a chi ha già giocato quella zona.

## Decisione

**1. Un ostacolo è un oggetto della mappa**, accanto a comparse, uscite e
cartelli: ha un `id`, una mansione, un livello, un'impronta in caselle,
facoltativamente un equipaggiamento richiesto, e il tile che deve restare quando
viene rimosso (`clearedTile`).

**2. Lo stato salvato è una bandiera**, `cleared.<zona>.<ostacolo>`. Nel
salvataggio finisce solo quella.

**3. La collisione è una funzione pura dello stato.**
`collisionWithObstacles(zone, flags)` restituisce la griglia della zona quando
non c'è nulla di rimosso — il caso comune non copia un byte — e altrimenti una
copia con le caselle degli ostacoli rimossi liberate. `src/state/collisionCache.ts`
la memoizza per combinazione (zona, insieme rimosso), perché il tick gira dieci
volte al secondo.

**4. Il disegno segue.** La scena chiede alla mappa di sostituire le caselle
degli ostacoli rimossi con `clearedTile`. È l'unico punto in cui il rendering
sa che gli ostacoli esistono.

## Conseguenze

**Positive**

- Il masso che chiude il corridoio verso l'Altopiano è verificabile
  staticamente, e lo è: `worldData.test.ts` prova che senza rimuoverlo l'uscita
  **non** è raggiungibile, e che rimuovendo tutti gli ostacoli il mondo torna
  connesso. Un gate che si aggira è un gate che non esiste.
- La mappa resta un dato aggiornabile: correggerla in una versione futura non
  entra in conflitto con nessun salvataggio.
- La regola "chi può rimuoverlo" vive in `domain/world/obstacles.ts` e guarda la
  **squadra**, non il deposito: portarsi dietro lo specialista è la decisione.

**Negative**

- Due sorgenti di solidità (il tile e l'oggetto) invece di una. È mitigato dal
  fatto che l'oggetto vince sempre: rimosso l'ostacolo, le sue caselle sono
  libere qualunque cosa dica il tile.
- Il campo `clearedBy` in `tiles.json` resta senza un uso reale. Va tolto in
  Fase 6, quando le mappe passeranno a Tiled.

**Rischi**

- Un ostacolo con un `clearedTile` sbagliato lascia sulla mappa un terreno
  incoerente — solido a vedersi, calpestabile nei fatti. Non è verificabile
  automaticamente oggi; lo diventerà quando `validate:data` conoscerà la
  solidità dei tile lasciati.

## Alternative scartate

**Tile mutabili con rigenerazione della griglia.** Semplice da scrivere, ma
mette la mappa nel salvataggio e rende la collisione uno stato invece che una
conseguenza.

**Ostacoli come strutture della Radura.** Condividono l'idea di "cosa occupa
caselle", ma le strutture si costruiscono e si smontano dentro un raggio
rivendicato: sono un altro sistema, con altre regole.
