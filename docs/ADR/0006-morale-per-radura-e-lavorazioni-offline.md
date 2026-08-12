# ADR 0006 — Il morale è della Radura, e le lavorazioni con ingredienti non girano offline

**Stato**: accettata · **Data**: 12 agosto 2026 · **Fase**: 4 · **Da rivedere**: Fase 6

## Contesto

Il PDR §4.4 descrive la produzione della Radura con questa formula:

```
rate = base_rate * (1 + 0.35 * (workerLevel - 1)) * moraleFactor
     * (isNight && !worker.nocturnal ? 0.5 : 1.0) * traitModifiers
```

e §5.2 dà a ogni `CreatureInstance` un campo `morale: number`. Letti insieme, i
due passaggi dicono che ogni Ferale ha il **suo** morale, e che la velocità di
una struttura dipende dal morale di chi ci lavora.

L'ADR 0002 ha però già deciso che la produzione offline si calcola a **segmenti
omogenei**: dentro un segmento le condizioni non cambiano, e il criterio di
accettazione della Fase 4 pretende che la simulazione a tick e quella a segmenti
diano risultati **esattamente** uguali.

Le due cose entrano in conflitto in due punti.

**Primo: il morale per Ferale moltiplica i confini.** Ogni lavoratore
attraverserebbe le soglie di morale in un istante diverso, e un segmento
omogeneo dovrebbe finire al primo confine di *chiunque*. Con dodici lavoratori
in una Radura matura, otto ore di gioco produrrebbero centinaia di segmenti — e
soprattutto ogni struttura avrebbe una velocità propria che cambia in momenti
propri, cioè esattamente la situazione che l'ADR 0002 voleva evitare.

**Secondo: le catene di lavorazione dipendono dall'ordine.** Una miniera che
produce minerale e una fornace che lo consuma danno risultati diversi a seconda
di come si spezza il tempo: con un segmento da otto ore la fornace trova
minerale per zero cicli all'inizio e per molti alla fine; a tick da cento
millisecondi lo consuma man mano. Nessuna delle due risposte è "sbagliata", ma
non sono la stessa, e l'uguaglianza richiesta dal criterio di accettazione
diventa indimostrabile.

## Decisione

**1. Il morale è uno solo, ed è della Radura.**

`BaseState.morale` è un intero 0..100 che vale per tutte le strutture. Sale
quando c'è cibo nella mangiatoia, scende quando manca, e attraversa due soglie
(`full` a 70, `low` a 30) che definiscono tre fasce con tre moltiplicatori.

Il campo `morale` di `CreatureInstance` resta nello schema — è nel PDR §5.2 e
serve alla riproduzione in Fase 6 — ma **non entra nella formula di produzione**.

**2. Le lavorazioni con ingredienti si fermano mentre non ci sei.**

Una struttura con `input` produce solo online (`allowInputs: true` nel tick,
`false` nel recupero offline). Le strutture che estraggono dal mondo — legna,
pietra, minerale, cibo, acqua — lavorano invece anche a scheda chiusa.

## Conseguenze

**Positive**

- L'uguaglianza fra tick e segmenti diventa dimostrabile, ed è dimostrata:
  `src/domain/base/offline.test.ts` confronta otto ore simulate nei due modi e
  verifica risorse, morale, debito di cibo e lavoro accumulato di ogni struttura.
- Otto ore costano una quarantina di segmenti invece di 288 000 tick.
- Il giocatore ha una cosa sola da guardare — "come stanno i miei Ferali" — invece
  di dodici barre da tenere d'occhio singolarmente.
- Le catene di produzione restano un motivo per *stare* nella Radura: la
  raccolta è passiva, la trasformazione no.

**Negative**

- Si perde una sfumatura di gioco: un Ferale stanco in mezzo a Ferali riposati
  non esiste. È il prezzo dell'uguaglianza fra i due percorsi di simulazione.
- Un giocatore che si aspetta la fornace attiva al rientro resta deluso. Va detto
  nell'interfaccia, non lasciato indovinare.

**Rischi**

- Se in Fase 6 la riproduzione userà il morale del singolo Ferale, ci saranno due
  concetti con lo stesso nome. Vanno chiamati diversamente prima di allora.

## Alternative scartate

**Morale per Ferale con segmenti per lavoratore.** Corretto e costoso: ogni
struttura avrebbe la sua linea del tempo, e il confronto fra tick e segmenti
diventerebbe una somma di casi particolari. Rimandato, non escluso.

**Lavorazioni offline con consumo proporzionale.** Distribuire gli ingredienti
sull'intero segmento darebbe un risultato *plausibile* ma diverso da quello dei
tick, e il criterio di accettazione della Fase 4 chiede l'uguaglianza esatta, non
la somiglianza.
