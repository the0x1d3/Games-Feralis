# ADR 0002 — La produzione si simula a segmenti omogenei, non tick per tick

**Stato**: accettata · **Data**: 11 agosto 2026 · **Fase**: 0 (vincola la Fase 4)

## Contesto

Il PDR pone due requisiti che, presi alla lettera, si scontrano:

- §7.1: «Il tick logico è a passo fisso 100 ms».
- §5.4: la produzione offline si recupera fino a un cap di 8 ore (elevabile a 12 e 24),
  e «la simulazione offline usa gli stessi puri riduttori della simulazione online.
  Mai due codebase per la stessa regola».

Simulare 8 ore a 100 ms significa 288 000 iterazioni; con il cap a 24 ore, 864 000.
Moltiplicato per il numero di strutture produttive, è un calcolo che si fa sentire
all'apertura della pagina — cioè nel momento peggiore, quello in cui il giocatore sta
aspettando di vedere il riepilogo "mentre eri via".

La scorciatoia ovvia — una formula chiusa `risorse = rate × tempo` — è però sbagliata:
il ciclo giorno/notte (1 giorno = 24 minuti reali, §8 Fase 1) alterna circa 20 volte in
8 ore, e i lavoratori non notturni producono a metà di notte. Una moltiplicazione
secca darebbe un risultato diverso da quello della simulazione online, e il criterio di
accettazione della Fase 4 chiede che i due numeri coincidano **esattamente**.

## Decisione

Il riduttore di produzione ha la forma:

```ts
produce(state: BaseState, dtSeconds: number, ctx: ProductionContext): BaseState
```

e assume che le condizioni restino **costanti** dentro `dt`.

- **Online**: viene chiamato con `dt = 1s` (il tick di produzione), guidato dal tick
  logico da 100 ms.
- **Offline**: l'intervallo da recuperare viene tagliato in **segmenti omogenei** e il
  riduttore viene chiamato una volta per segmento, con `dt` pari alla durata del segmento.

Un segmento finisce quando cambia qualcosa che influenza il tasso di produzione:

1. il passaggio giorno → notte o notte → giorno;
2. l'esaurimento del cibo nella mangiatoia (cambia il morale, quindi il `moraleFactor`);
3. il riempimento di un magazzino (la produzione si ferma);
4. il completamento di una lavorazione in coda;
5. il raggiungimento del cap offline.

Otto ore di assenza si riducono così a poche decine di chiamate invece di 288 000, con
lo **stesso identico codice** della simulazione online.

## Conseguenze

**Positive.** Un solo insieme di regole, come chiede il PDR. Il recupero offline è
istantaneo anche con il cap a 24 ore. Il criterio di accettazione della Fase 4
("riapri dopo 10 minuti e trovi esattamente le risorse calcolate dal test") diventa
verificabile con un `fixedClock`, senza aspettare 10 minuti veri.

**Negative.** Il codice deve saper calcolare _quando_ avverrà il prossimo evento, non
solo applicarlo. Ogni nuova meccanica che modifica il tasso di produzione deve
dichiarare il proprio "prossimo istante interessante", altrimenti la simulazione
offline diverge silenziosamente da quella online.

**Mitigazione obbligatoria in Fase 4.** Un test che simula lo stesso intervallo nei due
modi — a tick da 1 s e a segmenti — e pretende risultati identici. Senza quel test
questa decisione è un rischio, non una soluzione.

## Note già implementate in Fase 0

`src/domain/clock.ts` contiene `elapsedSince(now, lastSavedAt, capMs)`, che applica
entrambe le regole del PDR §5.4: il cap, e il ritorno a `0` quando l'orologio è stato
spostato indietro (nessuna risorsa, nessuna penalità, nessuna accusa all'utente).
Il cap è un numero di bilanciamento e arriva quindi da `/data`, non dal codice.

## Alternative scartate

- **Tick da 100 ms anche offline.** Fedele ma inutilmente costosa; il primo giocatore
  con il cap a 24 ore aprirebbe la pagina su un blocco di calcolo.
- **Formula chiusa.** Veloce ma produce numeri diversi dall'online. Viola §5.4.
- **Tick offline più grossolano (es. 1 minuto).** Sarebbe una seconda regola di gioco
  travestita da ottimizzazione: esattamente le "due codebase per la stessa regola"
  che il PDR vieta.
