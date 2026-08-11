# Feralis — PDR (Product Design Requirements)

> **Cos'è questo documento**
> Specifica operativa e fonte di verità del progetto. Ogni sistema ha regole, formule e
> criteri di accettazione verificabili. Non è un pitch: è una specifica implementabile.
>
> Versione: 1.1 — Data: 11 agosto 2026 — Nome del gioco: **Feralis**

---

## 0. Errata — correzioni applicate alla v1.0

Questa sezione elenca i punti in cui la v1.0 era contraddittoria o incompleta, e la
risoluzione adottata. Serve a evitare che qualcuno "ripristini" i valori originali
credendo di correggere un errore.

| #   | Problema nella v1.0                                                                                                                                                                       | Risoluzione in v1.1                                                                                                                                                   |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| E1  | La formula di cattura non poteva soddisfare il criterio della Fase 2. Con `baseCatchRate` Comune = 0.55 e `hpFactor` = 0.30 a HP pieni si otteneva **16.5%**, contro il 25–35% richiesto. | Range di `baseCatchRate` ridefinito a **0.18 (Alfa) … 1.00 (Comune)**. Comune a HP pieni: `1.00 × 0.30` = **30%**. Vedi §5.3.                                         |
| E2  | Lo stato Bagnato veniva contato due volte (`status` ×1.25 **e** `wet` ×1.15).                                                                                                             | **Mantenuto di proposito**: Bagnato è lo stato da cattura, moltiplicatore effettivo ×1.4375. Documentato qui perché non venga "corretto" per errore.                  |
| E3  | «Bagnato: +cattura, −RES fuoco». Un bersaglio bagnato più vulnerabile al fuoco è controintuitivo e rompe la leggibilità.                                                                  | **Bagnato: +cattura, −RES Fulmine.** Crea la sinergia Acqua→Fulmine. Vedi §5.2.                                                                                       |
| E4  | ATB definito come `atb += VEL * dt` senza unità, in conflitto con il tick fisso da 100 ms di §7.1.                                                                                        | ATB avanza **solo in tick da 100 ms**, in modalità _wait_: la simulazione si congela quando tocca al giocatore. Vedi §5.2.                                            |
| E5  | La simulazione offline a 100 ms richiedeva 288 000 iterazioni (864 000 col cap a 24 h).                                                                                                   | **Segmenti omogenei**, stesso riduttore. Vedi ADR 0002.                                                                                                               |
| E6  | `SaveFile` conteneva `rngSeed` ma non la posizione nello stream: al reload le sequenze si ripetevano.                                                                                     | Stream separati (`world`, `battle`, `loot`, `breeding`), ognuno con il proprio stato serializzato. Implementato in `src/domain/rng.ts`.                               |
| E7  | Mancava la formula delle statistiche per livello; gli `ivs` non comparivano in nessun calcolo.                                                                                            | Da definire in Fase 3 come funzione pura `computeStats(...)`. I tratti sono **modificatori derivati**, mai valori scritti nel salvataggio.                            |
| E8  | Un solo `inventory`, ma §5.6 punisce il KO con «il 10% delle risorse trasportate».                                                                                                        | Separati `player.inventory` (trasportato, penalizzabile) e `base.storage` (mai toccato dal KO).                                                                       |
| E9  | Non era chiaro se `/data` fosse importato o servito staticamente.                                                                                                                         | Import statico per i dati core, `import()` dinamico per specie e mappe. Vedi ADR 0003.                                                                                |
| E10 | `deflate` per il salvataggio senza indicazione di implementazione.                                                                                                                        | `CompressionStream('deflate-raw')` con fallback a base64 non compresso; il prefisso di versione indica quale dei due.                                                 |
| E11 | Assalti alla base e incubazione durante l'assenza: non specificati.                                                                                                                       | Gli assalti avvengono **solo online** (punire l'assenza contraddice «la frustrazione non è una meccanica»). L'incubazione **avanza offline** e non è soggetta al cap. |
| E12 | `hasInitiative` (bonus ×1.15) mai definito.                                                                                                                                               | Vero **solo al primo turno**, e solo se il giocatore ha avviato l'incontro avvicinandosi da dietro nel mondo.                                                         |
| E13 | «24 specie» vs «33 entry nell'archivio».                                                                                                                                                  | **24 linee evolutive → 33 file** in `data/species/`.                                                                                                                  |
| E14 | `catchChance(target, sphere, ...)`: il termine "sphere" avvicina al marchio da cui §3.5 chiede di stare lontani.                                                                          | Rinominato **`tool`**. Nel lessico italiano è il **Nodo**. Gli identificatori di codice restano neutri e in inglese.                                                  |
| E15 | «IT+EN dal day one» (§1.4) vs «IT/EN completi in Fase 7» (§8).                                                                                                                            | Infrastruttura i18n e divieto di stringhe hardcoded **dalla Fase 0**; rifinitura delle traduzioni in Fase 7.                                                          |

---

## 1. Executive summary

### 1.1 Concept in una riga

Un gioco 2D top-down nel browser dove esplori un arcipelago, catturi creature originali,
le usi in combattimento a turni e **le assegni come lavoratori** in un accampamento che
produce risorse anche mentre non giochi.

### 1.2 Da dove viene ogni pezzo

| Da Pokémon                                                                                         | Da Palworld                                                                                             | Originale nostro                                                                                                                    |
| -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Combattimento a turni leggibile, tipi con triangoli, cattura come skill, collezionismo come motore | Creature come **forza lavoro**, base building, automazione produttiva, ciclo giorno/notte, boss custodi | Progressione **offline-first**: la base produce a tempo reale anche a browser chiuso, e il gioco è pensato per sessioni da 5 minuti |

### 1.3 I tre pilastri

Se una feature non serve a uno di questi, si taglia.

1. **Catturare è un puzzle, non un lancio di dado.** Indebolire, applicare stati,
   colpire alle spalle: la percentuale di cattura è visibile e influenzabile.
2. **Ogni creatura ha due vite.** Una scheda di combattimento e una scheda di lavoro.
   Il Ferale debole in battaglia può essere il migliore in fornace.
3. **La base lavora per te.** Torni dopo 4 ore e trovi risorse, uova incubate, campi
   raccolti. È il gancio di retention di un gioco senza notifiche push.

### 1.4 Target e formato

- **Piattaforma**: browser desktop (primario), mobile in landscape (secondario).
- **Sessione tipo**: 5–15 minuti. Run completa MVP: 3–5 ore.
- **Monetizzazione**: nessuna (vincolo GitHub Pages, §3.4).
- **Lingue**: IT + EN dal day one (stringhe esternalizzate, mai hardcoded).

### 1.5 Lessico

| Concetto             | Nome nel gioco              | Identificatore nel codice |
| -------------------- | --------------------------- | ------------------------- |
| Creature             | **Ferali** (sing. _Ferale_) | `creature`, `species`     |
| Strumento di cattura | **Nodo**                    | `captureTool`, `tool`     |
| Base                 | **Radura**                  | `base`                    |
| Tagline              | _Nulla si doma davvero._    | —                         |

Gli identificatori restano neutri e in inglese; il lessico italiano vive solo in i18n.

---

## 2. Vincolo GitHub Pages

Il progetto è interamente realizzabile su GitHub Pages: un gioco single-player
client-side è il caso d'uso ideale. I limiti vanno però progettati intorno.

### 2.1 Limiti tecnici

| Limite                 | Valore                                                 | Impatto                                                                                 |
| ---------------------- | ------------------------------------------------------ | --------------------------------------------------------------------------------------- |
| Solo contenuti statici | nessun server, nessun DB                               | Tutta la logica nel client. Nessun account, nessun salvataggio cloud, nessun anti-cheat |
| Dimensione sito        | 1 GB                                                   | Ampio, se non si committano asset non compressi                                         |
| Banda                  | 100 GB/mese (soft)                                     | Con build da 8 MB → ~12 000 caricamenti/mese                                            |
| Build                  | 10/ora (non si applica con un workflow Actions custom) | Usiamo Actions: il limite sparisce                                                      |
| Timeout deploy         | 10 minuti                                              | La build attuale è sotto il secondo                                                     |
| Repo privati           | richiedono piano a pagamento                           | Sul piano free il codice è pubblico                                                     |

### 2.2 Conseguenze di design

- **Salvataggio locale**: IndexedDB primario, `localStorage` di riserva, più
  export/import come stringa base64 per i backup manuali.
- **Nessun multiplayer sincrono in MVP.** Baratto e sfide con **codici di scambio**:
  una creatura serializzata in una stringa con checksum, che l'amico incolla nel suo
  gioco. Zero server.
- **Nessuna classifica globale** in MVP.
- **Il tempo offline è calcolato client-side** → l'utente può barare cambiando
  l'orologio. Non è un problema in un single-player; la mitigazione anti-frustrazione
  è in §5.4.

### 2.3 Ottimizzazioni obbligatorie

- Sprite atlas unici per categoria (creature / tileset / UI), non file singoli.
- Audio `.ogg` + `.m4a` di riserva, loop < 60 s, musica ≤ 96 kbps.
- Budget totale build **≤ 12 MB**; primo caricamento giocabile **≤ 3 MB**.
- Cache tramite nomi file con hash (Vite lo fa) + service worker opzionale in Fase 7.

### 2.4 Vincolo di policy

GitHub Pages non è consentito per attività commerciali. Quindi: gioco gratuito, nessun
acquisto, nessun ad network. Il progetto deve restare spostabile su Vercel/Netlify in
dieci minuti: **nessun path assoluto hardcoded**, sempre `import.meta.env.BASE_URL`.

### 2.5 Proprietà intellettuale

- **Zero asset, nomi, suoni o testi presi da altri giochi.** Nessuna creatura
  riconoscibilmente "ispirata a", nessun font ufficiale, nessuna musica remixata.
- Evitare nomi che facciano il verso ai marchi: niente suffisso `-mon`, niente sfere di
  cattura, niente enciclopedie con nomi assonanti.
- Contesto: la causa Nintendo/Pocketpair (settembre 2024, Tribunale di Tokyo) riguarda
  **brevetti** su meccaniche specifiche, non il genere. La lezione pratica: le
  meccaniche di genere generiche non sono un rischio, la riproduzione _identica e
  specifica_ di una meccanica brevettata sì. Per un gioco gratuito, open source e con
  asset originali il rischio è trascurabile.

---

## 3. Loop di gioco

### 3.1 Core loop (30–90 secondi)

```
Esplori → incontri un Ferale selvatico → combatti a turni →
indebolisci + applichi stato → catturi (o sconfiggi per materiali) →
entra in squadra O va al lavoro nella Radura
```

### 3.2 Meso loop (10–20 minuti)

```
La Radura produce → sblocchi ricetta/struttura → crafti equipaggiamento migliore →
accedi a un bioma più ostile → catturi Ferali con mansioni migliori → la Radura produce di più
```

### 3.3 Macro loop (1–3 ore)

```
Squadra pronta → sfidi il Custode del bioma → vinci → sblocchi
nuovo bioma + nuovo tier tecnologico + nuova mansione → ricomincia più su
```

### 3.4 La prima ora

Da scrivere come test, non come speranza.

| Minuto | Cosa accade                                                                               |
| ------ | ----------------------------------------------------------------------------------------- |
| 0–2    | Risveglio sulla spiaggia, movimento, primo Ferale _già alleato_ (regalato, non catturato) |
| 2–5    | Primo combattimento contro un selvatico debole, prima cattura guidata                     |
| 5–10   | Piazzi il totem della Radura, assegni il Ferale a "Raccolta legna", vedi la prima risorsa |
| 10–20  | Prima ricetta craftata (Nodo migliore), prima notte, i Ferali vanno a dormire             |
| 20–40  | Secondo bioma visibile ma bloccato da un masso → serve Estrazione 2                       |
| 40–60  | Primo mini-boss. Sblocca l'incubatrice → meta-progressione lunga                          |

**Criterio di accettazione**: un tester nuovo, senza spiegazioni, arriva al minuto 10
(base + primo lavoratore assegnato) senza chiedere aiuto.

---

## 4. Sistemi di gioco

### 4.1 Creature

Ogni Ferale ha **due schede indipendenti**: combattimento e lavoro. È la meccanica firma.

**Attributi di combattimento**: HP, ATT, DIF, VEL, ELE (attacco elementale),
RES (resistenza elementale).

**Attributi di lavoro**: livelli 0–3 in ciascuna delle 6 mansioni.

**Tratti passivi**: 0–2 per esemplare, estratti alla generazione
(es. _Mattiniero_: +20% lavoro di giorno; _Fragile_: −15% HP, +15% VEL).
I tratti sono **modificatori derivati a runtime** (E7): le statistiche effettive si
ricalcolano sempre da specie + livello + IV + tratti + morale, e non vengono mai
scritte nel salvataggio.

**Mansioni (6)**

| Mansione     | Produce / abilita             | Ostacolo che sblocca                  |
| ------------ | ----------------------------- | ------------------------------------- |
| Raccolta     | legna, fibra                  | taglia arbusti                        |
| Estrazione   | pietra, minerale              | rompe massi                           |
| Coltivazione | cibo vegetale, semi           | ara terreni                           |
| Fiamma       | fusione, cottura, incubazione | scioglie barriere di ghiaccio         |
| Acqua        | irrigazione, raffreddamento   | spegne fuochi, attraversa acqua bassa |
| Artigianato  | velocità dei banchi da lavoro | ripara ponti                          |

> **Regola d'oro**: ogni mansione deve sbloccare anche un ostacolo nel mondo, così
> catturare per lavorare e catturare per esplorare sono la stessa attività.

**Tipi elementali (6 + Neutro, due triangoli)**

```
Triangolo A:  Flora → Acqua → Fuoco → Flora
Triangolo B:  Fulmine → Vento → Terra → Fulmine
Neutro: 1.0x contro tutto, subisce 1.0x da tutto
Vantaggio 1.5x · Svantaggio 0.66x · Doppio tipo: i moltiplicatori si moltiplicano
```

Sei tipi invece di diciotto: bilanciabili da una persona sola, imparabili in dieci minuti.

**Rarità**: Comune / Non comune / Raro / Alfa (esemplare gigante, unico per zona,
statistiche ×1.35, mantiene lo stato Alfa se catturato).

### 4.2 Combattimento — turni con barra ATB

- Squadra attiva: **3 Ferali** per lato. Il giocatore non combatte: comanda.
- Ogni creatura accumula `atb += VEL × ATB_TICK_SCALE` **a ogni tick da 100 ms**;
  a `atb >= atbThreshold` agisce e la barra si azzera (E4).
- **Modalità wait**: quando tocca a un Ferale del giocatore la simulazione si congela e
  attende l'input. Così il combattimento è deterministico e riproducibile da seed.
- `atbThreshold` e `ATB_TICK_SCALE` stanno in `data/battle.json`, non nel codice.
- Azioni: 4 mosse, cambio, oggetto, **tentativo di cattura** (solo il giocatore).
- Durata target di un combattimento selvatico: **20–40 secondi**.

**Formula danno**

```ts
function damage(attacker, defender, move, rng): number {
  const isSpecial = move.category === 'elemental';
  const atk = isSpecial ? attacker.ele : attacker.att;
  const def = isSpecial ? defender.res : defender.dif;
  const levelScale = 1 + attacker.level / 40;
  const ratio = atk / (atk + def); // 0..1, autobilanciante
  const type = typeMultiplier(move.type, defender.types);
  const crit = rng.next() < critChance(attacker) ? 1.5 : 1;
  const back = attacker.hasInitiative ? 1.15 : 1; // solo al primo turno (E12)
  const variance = 0.92 + rng.next() * 0.16;
  return Math.max(
    1,
    Math.floor(move.power * ratio * 2 * levelScale * type * crit * back * variance),
  );
}
```

`ratio = atk/(atk+def)` invece di `atk/def` evita l'esplosione di danno tipica dei
cloni amatoriali: nessun one-shot casuale, nessun combattimento infinito.

**Stati**

| Stato       | Effetto                         |
| ----------- | ------------------------------- |
| Bruciato    | danno nel tempo, −ATT           |
| **Bagnato** | **+cattura, −RES Fulmine** (E3) |
| Paralizzato | −50% VEL                        |
| Radicato    | non può cambiare                |
| Stordito    | salta un turno                  |

Durata 2–4 turni, nessuno stacking dello stesso stato.

### 4.3 Cattura

La cattura deve essere **leggibile**: la UI mostra la percentuale in tempo reale.

```ts
function catchChance(target, tool, player, rng): number {
  const hpRatio = target.hp / target.maxHp;
  const hpFactor = 1 - 0.7 * hpRatio; // 0.30 a HP pieni → 1.00 a 1 HP
  const status = target.status ? 1.25 : 1.0;
  const wet = target.status === 'wet' ? 1.15 : 1.0; // cumulativo, voluto (E2)
  const lvlDelta = clamp(1 + 0.03 * (player.teamLevel - target.level), 0.45, 1.3);
  const rarity = target.baseCatchRate; // 0.18 (Alfa) .. 1.00 (Comune)  (E1)
  const raw = rarity * tool.multiplier * hpFactor * status * wet * lvlDelta;
  return clamp(raw, 0.02, 0.95); // mai 0%, mai garantito
}
```

**`baseCatchRate` per rarità** (E1): Comune 1.00 · Non comune 0.65 · Raro 0.40 · Alfa 0.18.

Verifica: una Comune a HP pieni con Nodo base ottiene `1.00 × 1.0 × 0.30` = **30%**,
dentro il 25–35% richiesto dalla Fase 2. Un Alfa a 1 HP, con stato e Nodo superiore,
ottiene `0.18 × 2.4 × 1.0 × 1.25` ≈ **54%**: una scelta tattica, non un automatismo.

**Nodi**: base ×1.0 · migliorato ×1.6 · superiore ×2.4 · notturno ×3.0 (solo di notte).

**Animazione**: tre scosse, con esito calcolato in anticipo. L'attesa è teatro, non
ricalcolo.

### 4.4 Radura e automazione

- Il giocatore piazza un **Totem** che rivendica un'area circolare (raggio 12 tile,
  espandibile a 16 e 20).
- Costruzione su griglia, snapping, controllo collisioni, costo in risorse, rimozione
  con rimborso del 50%.
- Ogni struttura produttiva definisce: mansione richiesta, livello minimo, input,
  output, tempo base.
- I Ferali assegnati consumano **cibo** da una mangiatoia; senza cibo il **Morale**
  scende e la produzione rallenta — mai a zero: la frustrazione non è una meccanica.

**Tick di produzione** (deterministico, in secondi di gioco)

```
rate = base_rate
     * (1 + 0.35 * (workerLevel - 1))              // 1→1.0x, 2→1.35x, 3→1.70x
     * moraleFactor                                 // 1.0 pieno, 0.6 basso, 0.35 esausto
     * (isNight && !worker.nocturnal ? 0.5 : 1.0)
     * traitModifiers
```

**Progressione offline**: alla riapertura si calcola `elapsed = now − lastSaveTimestamp`
e si simulano i tick.

- Cap **8 ore** (elevabile a 12 e 24 con strutture avanzate). Serve a dare un motivo per
  tornare, non a punire.
- Se `elapsed < 0` (orologio spostato indietro): si ignora, si aggiorna il timestamp,
  **nessuna penalità e nessuna accusa all'utente**.
- La simulazione offline usa **gli stessi riduttori puri** di quella online, invocati a
  **segmenti omogenei** anziché tick per tick (E5, ADR 0002).

Entrambe le regole sono già implementate in `elapsedSince()` (`src/domain/clock.ts`).

**Assalti alla base**: ogni N minuti di gioco, con 60 secondi di preavviso, creature
ostili attaccano. Difese: trappole, palizzate, Ferali in ruolo guardia. In MVP: 3 ondate
scriptate. Gli assalti avvengono **solo online** (E11).

### 4.5 Crafting e tech tree

- **Punti Tecnologia** da: primo incontro con una specie (+1), Custodi (+5),
  obiettivi (+1…3).
- Albero a 4 tier, ~28 nodi in MVP. Ogni tier gated da un Custode.
- Ricette con input/output/tempo, code di lavorazione ai banchi; la velocità dipende
  dai lavoratori con mansione Artigianato.

### 4.6 Sopravvivenza leggera

Fame, temperatura e sanità in un browser game gratuito diventano noia. Quindi:

- **Nessuna fame per il giocatore.** Solo per i Ferali, e serve al loop della Radura.
- **Temperatura solo come gate per bioma**, non come timer che uccide.
- **Nessuna morte con perdita di oggetti.** KO → risvegli al Totem, perdi il 10% di
  `player.inventory`; `base.storage` non viene mai toccato (E8).

### 4.7 Progressione, evoluzione, incubazione

- XP da combattimento e da lavoro (metà rate): anche gli operai salgono di livello.
- Livello massimo MVP: 40. Evoluzione: uno stadio per ~40% delle linee, a livello soglia
  o con oggetto.
- **Incubatrice**: due Ferali nella Radura producono un uovo in tempo reale (30–90
  minuti, riducibile con la mansione Fiamma). Il nascituro eredita: la specie di uno dei
  due genitori, il **miglior** livello di mansione fra i due (−1), un tratto a caso da
  un genitore. L'incubazione **avanza offline** e non è soggetta al cap (E11).

### 4.8 Mondo e contenuti MVP

| Elemento  | Quantità                               | Note                                        |
| --------- | -------------------------------------- | ------------------------------------------- |
| Biomi     | 3 (Costa, Bosco, Altopiano)            | 4° e 5° post-MVP                            |
| Mappa     | 4 zone da 64×64 tile, tile 32px        | handcrafted in Tiled                        |
| Specie    | **24 linee evolutive → 33 file** (E13) | ogni specie: 2 varianti cromatiche + 1 Alfa |
| Mosse     | 40                                     | riusate fra specie, con movepool per tipo   |
| Strutture | 22                                     | di cui 9 produttive                         |
| Ricette   | 30                                     |                                             |
| Custodi   | 3 + 1 finale                           |                                             |
| Quest     | 12 principali, 15 secondarie           |                                             |

---

## 5. Architettura tecnica

### 5.1 Stack

| Livello          | Scelta                                                  | Perché                                                                                                                |
| ---------------- | ------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Linguaggio       | **TypeScript 5.9 strict**                               | Con 33 specie e 40 mosse i tipi salvano. Non la 7: vedi ADR 0004                                                      |
| Build            | **Vite 8**                                              | Zero config, output statico perfetto per Pages                                                                        |
| Motore           | **Phaser 4.2.1**, pinnato esatto                        | Tilemap, atlas, input, audio, camere già risolti                                                                      |
| UI di gioco      | **DOM/HTML+CSS sopra il canvas**                        | Menu, inventario, base, tooltip: più veloci da fare e accessibili in DOM. Il canvas fa il mondo, il DOM fa i pannelli |
| Stato            | store custom + riduttori puri                           | La logica dev'essere testabile senza Phaser                                                                           |
| Validazione dati | **Zod 4** + `validate-data.ts` in CI                    | Un JSON malformato non arriva in produzione                                                                           |
| Test             | **Vitest 4** (logica pura) + Playwright (smoke, Fase 7) |                                                                                                                       |
| Mappe            | **Tiled** → export JSON                                 |                                                                                                                       |
| Storage          | IndexedDB (`idb-keyval`) + `localStorage` di riserva    |                                                                                                                       |
| RNG              | `mulberry32` seeded, mai `Math.random()`                | Test riproducibili e seed condivisibili                                                                               |

> **Phaser 4 ≠ Phaser 3.** Il pacchetto `phaser` include 28 skill ufficiali in
> `node_modules/phaser/skills/`, fra cui `v3-to-v4-migration`. Prima di usare una API
> non banale, leggile. La maggior parte dei tutorial in circolazione è per la v3 ed è
> la fonte di errore numero uno su questo stack.

### 5.2 Struttura del repository

```
/
├─ .github/workflows/deploy.yml     build + deploy su Pages (e controlli sulle PR)
├─ index.html
├─ vite.config.ts                   base: '/Games-Feralis/'
├─ eslint.config.js                 ⭐ i confini architetturali, come errori
├─ public/
│  ├─ .nojekyll
│  └─ favicon.svg
├─ data/                            contenuto di gioco, versionato, modificabile a mano
│  ├─ species/*.json
│  ├─ moves.json · items.json · structures.json · recipes.json · tech.json
│  └─ locales/{it,en}.json
├─ scripts/
│  ├─ validate-data.ts              Zod su /data, gira in CI
│  ├─ boundaries.test.ts            ⭐ verifica che i confini scattino davvero
│  ├─ size-check.ts                 budget 12 MB
│  └─ balance-sim.ts                simula 1000 combattimenti (dalla Fase 2)
├─ src/
│  ├─ main.ts
│  ├─ engine/                       wrapper Phaser (l'unico posto che lo importa)
│  ├─ scenes/{Boot,World,Battle,BaseEdit,UIOverlay}.ts
│  ├─ domain/                       ⭐ LOGICA PURA, zero import di Phaser
│  │  ├─ rng.ts · clock.ts
│  │  ├─ battle/{atb,damage,status,capture}.ts
│  │  ├─ base/{production,workers,morale,offline}.ts
│  │  ├─ creature/{stats,growth,breeding,traits}.ts
│  │  └─ economy/{crafting,inventory,tech}.ts
│  ├─ state/{store,actions,selectors,migrations,systemClock}.ts
│  ├─ save/{codec,storage,exportCode}.ts
│  ├─ ui/
│  └─ i18n/
└─ docs/{PDR.md, BACKLOG.md, ADR/}
```

**Regola architetturale non negoziabile**: `src/domain/**` non importa mai Phaser né
tocca il DOM. È matematica pura, testabile in millisecondi. Le scene leggono lo stato e
disegnano; le azioni passano dai riduttori. Il confine è imposto da ESLint e verificato
da un test: vedi ADR 0001.

### 5.3 Schemi dati

```ts
interface Species {
  id: string; // 'ember_pup' — snake_case, immutabile per sempre
  nameKey: string; // chiave i18n, mai testo diretto
  types: [ElementType] | [ElementType, ElementType];
  baseStats: { hp: number; att: number; dif: number; vel: number; ele: number; res: number };
  growthCurve: 'fast' | 'medium' | 'slow';
  work: Partial<Record<WorkKind, 0 | 1 | 2 | 3>>;
  movepool: Array<{ moveId: string; level: number }>;
  baseCatchRate: number; // 0.18 .. 1.00  (E1)
  rarity: 'common' | 'uncommon' | 'rare' | 'alpha';
  spawn: Array<{ biome: string; timeOfDay: 'any' | 'day' | 'night'; weight: number }>;
  evolution?: { toId: string; level?: number; itemId?: string };
  size: 'S' | 'M' | 'L';
  rideable?: { landSpeed?: number; canSwim?: boolean; canGlide?: boolean };
  sprite: { atlas: string; key: string; frames: Record<AnimName, number[]> };
}

interface CreatureInstance {
  uid: string;
  speciesId: string;
  nickname?: string;
  level: number;
  xp: number;
  ivs: Record<StatKey, number>; // 0..31
  traits: string[]; // max 2
  hp: number;
  status?: StatusId;
  moves: string[]; // max 4
  isAlpha: boolean;
  assignment?: { structureId: string } | { party: 0 | 1 | 2 };
  morale: number; // 0..100
  caughtAt: number;
}
```

**Regole sui dati**

1. Gli `id` sono **immutabili**: rinominarne uno rompe i salvataggi. Il nome
   visualizzato sta in i18n.
2. Nessun numero di bilanciamento nel codice: tutto in `/data`. Bilanciare deve
   significare modificare un JSON, non ricompilare la logica.
3. Ogni file in `/data` è validato in CI. Build rotta = merge bloccato.

### 5.4 Salvataggio

```ts
interface SaveFile {
  schemaVersion: number;
  gameVersion: string;
  createdAt: number; lastSavedAt: number;
  rngStreams: Record<RngStreamName, number>;   // stato, non solo seme (E6)
  player: {...}; creatures: CreatureInstance[]; base: {...};
  inventory: Record<string, number>;           // trasportato (E8)
  tech: string[]; flags: Record<string, boolean>;
  archive: Record<string, { seen: boolean; caught: number }>;
  stats: {...};
}
```

- **Autosave** ogni 30 s, su `visibilitychange`, prima di ogni cambio scena, dopo ogni
  cattura.
- **Migrazioni obbligatorie**: `migrations.ts` con funzioni `v1→v2`, `v2→v3`… Un
  salvataggio non deve **mai** essere invalidato da un update. È la promessa più
  importante verso i giocatori di un gioco web.
- **3 slot** + export/import: `base64(deflate(json)) + '.' + crc32`, con prefisso di
  versione. `deflate` via `CompressionStream('deflate-raw')`, con fallback a base64 non
  compresso (E10).
- **Codice di scambio**: ~120 caratteri con `speciesId, level, ivs, traits, moves,
isAlpha, checksum`. Import rifiutato se il checksum non torna. Non è sicuro contro la
  manomissione: è un single-player, e va bene così.

### 5.5 Deploy

Vedi `.github/workflows/deploy.yml`. Checklist Pages: `base: '/Games-Feralis/'`,
`public/.nojekyll`, nessun path assoluto, **nessun router con history API**.

---

## 6. Requisiti non funzionali

### 6.1 Performance

- **60 fps** stabili su laptop integrato del 2020 con 200 entità in scena.
- Boot → menu giocabile **< 2.5 s** su connessione 10 Mbit.
- Memoria < 300 MB. Nessun leak: le entità distrutte rimuovono i listener.
- Il tick logico è a **passo fisso 100 ms**, indipendente dal framerate. Nessuna logica
  dipendente da un `dt` variabile.

### 6.2 Accessibilità

- Tutto giocabile da tastiera; rebinding dei tasti.
- Nessuna informazione trasmessa **solo** dal colore (i tipi hanno icona e sigla).
- Opzioni: riduci flash/shake, dimensione testo (100/125/150%), font ad alta
  leggibilità, velocità del testo di combattimento regolabile e "istantaneo".
- Contrasto AA sui pannelli.

### 6.3 Mobile

- Joystick virtuale + tap. Landscape obbligato, con avviso in portrait.
- UI in `rem` con scaling, hit target ≥ 44 px. Da testare su viewport 380 px.

### 6.4 Robustezza

- Il gioco non deve **mai** perdere un salvataggio: doppia scrittura (slot corrente +
  `slot_backup`), e in caso di JSON corrotto si offre il ripristino.
- Errore non gestito → schermata con "copia rapporto" e "torna al menu conservando il
  salvataggio", non schermo nero.
- Se IndexedDB non è disponibile: fallback a `localStorage` e avviso chiaro.

---

## 7. Roadmap

Ogni fase ha criteri di accettazione binari. **Non si passa alla fase successiva se i
criteri non sono verdi.**

### Fase 0 — Fondamenta ✅ completata

Setup Vite+TS+Phaser pinnato, ESLint con i confini architetturali, Vitest, workflow di
deploy, RNG seeded, clock iniettabile, i18n, `CLAUDE.md`, `docs/ADR/`.

✅ Pagina live sull'URL Pages · `npm run verify` verde in CI · `.nojekyll` presente ·
i confini architetturali falliscono davvero se violati (`scripts/boundaries.test.ts`).

### Fase 1 — Mondo esplorabile (2 giorni)

Tilemap da Tiled, movimento a 8 direzioni con collisioni, camera con lerp, layer di
profondità, ciclo giorno/notte (1 giorno = 24 min reali) con tinta ambientale,
interazione con oggetti, store + salvataggio/caricamento con migrazioni.

✅ Cammini per 3 zone, salvi, ricarichi la pagina e ricompari nella stessa posizione con
lo stesso orario di gioco. Il RNG riprende dallo stato salvato, non dall'inizio.

### Fase 2 — Combattimento e cattura (3 giorni)

Scena Battle, ATB in modalità wait, 6 tipi, 12 mosse, 5 stati, IA a 3 livelli, cattura
con percentuale visibile, erba alta con spawn pesati per bioma e ora.

✅ 1000 combattimenti simulati da `balance-sim.ts` senza crash · durata mediana 20–40 s ·
test unitari su danno, cattura e ATB con seed fisso · **a HP pieni una Comune con Nodo
base ha 25–35% di cattura** (con i valori corretti di E1).

### Fase 3 — Squadra, archivio, inventario (2 giorni)

Deposito, archivio specie, XP e livelli, una evoluzione funzionante, inventario,
consumabili, nickname, IV e tratti generati alla cattura, `computeStats` (E7).

✅ Catturi 10 Ferali, ne evolvi uno, riordini la squadra, tutto persiste dopo il reload.
UI navigabile solo da tastiera.

### Fase 4 — La Radura (4 giorni — la fase più importante)

Totem, editor di costruzione su griglia, 9 strutture produttive, assegnazione
lavoratori, tick di produzione, morale e mangiatoia, **progressione offline con cap 8h**,
riepilogo "mentre eri via".

✅ Assegni 3 Ferali, chiudi la scheda, riapri dopo 10 minuti reali e trovi la quantità di
risorse **esattamente uguale** a quella calcolata dal test · spostare l'orologio indietro
non genera risorse né penalità · **la simulazione a tick e quella a segmenti danno lo
stesso risultato** (test obbligatorio, ADR 0002).

### Fase 5 — Crafting, tecnologie, gate ambientali (2 giorni)

Banchi con coda, 30 ricette, albero a 4 tier, 6 ostacoli ambientali, equipaggiamento per
bioma freddo e caldo.

✅ Percorso verificato: catturi un Ferale con Estrazione 2 → rompi il masso → accedi
all'Altopiano → crafti l'oggetto tier 3 · nessun deadlock possibile (test di
raggiungibilità di ogni nodo tech).

### Fase 6 — Progressione e contenuti (4 giorni)

3 Custodi + boss finale, 12 quest principali con tracker, 3 assalti, incubazione e
riproduzione, 33 file specie completi, 3 biomi popolati.

✅ Una run completa fino al boss finale in 3–5 ore senza blocchi, giocata almeno una
volta interamente da un tester esterno.

### Fase 7 — Polish, i18n, mobile, accessibilità (3 giorni)

Audio, transizioni, feedback di impatto, tutorial contestuale, IT/EN rifiniti, controlli
touch, menu opzioni, schermata di errore, ottimizzazione atlas.

✅ Build ≤ 12 MB · 60 fps sull'hardware di riferimento · zero stringhe hardcoded ·
giocabile su un telefono reale · Lighthouse performance ≥ 90.

### Fase 8 — Post-MVP

Codici di scambio · sfide asincrone · scambio P2P via WebRTC · 4° e 5° bioma · supporto
mod da JSON esterni · classifica su servizio free-tier.

**Stima MVP: ~20 giornate.** Le fasi 4 e 6 sono quelle dove si sfora, e sono anche
quelle che decidono se il gioco è buono.

---

## 8. Asset e licenze

**Servono**: 24 linee × 4 animazioni × 4 direzioni, tileset per 3 biomi, ~30 icone UI,
6 tracce musicali, ~30 sfx.

**Tre strade combinabili**

1. **Pixel art originale** (Aseprite/Libresprite). 32×32 per i Ferali, 48×48 per gli
   Alfa. Palette limitata a 24 colori: rende coerente anche una mano non ferma.
2. **Asset pack CC0** (es. Kenney.nl). Verifica **sempre** la licenza reale: alcuni pack
   popolari sono CC-BY-SA o GPL e obbligano a condividere alle stesse condizioni.
3. **Generazione AI** per bozze da ripassare a mano. Mai "nello stile di" un franchise.

**Obbligo di progetto**: `ASSETS.md` elenca ogni file, l'origine e la licenza, e si
aggiorna **nello stesso commit** dell'asset.

---

## 9. Metriche di successo

Senza analytics né server, le metriche sono qualitative e si testano su 5 persone.

| Metrica                                        | Target                       |
| ---------------------------------------------- | ---------------------------- |
| Un tester nuovo assegna il primo lavoratore    | entro 10 minuti, senza aiuto |
| Sa spiegare il triangolo dei tipi              | dopo 20 minuti               |
| Torna a giocare il giorno dopo spontaneamente  | 3 su 5                       |
| Sa dire cosa distingue questo gioco da Pokémon | 5 su 5                       |
| Crash o salvataggi persi                       | zero, sempre                 |

---

## 10. Rischi

| Rischio                                     | Probabilità | Mitigazione                                                                                             |
| ------------------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------- |
| **Scope creep**                             | Alta        | I tre pilastri di §1.3 sono un filtro: ogni feature che non serve a uno di essi va in `docs/BACKLOG.md` |
| Asset art sottovalutati                     | Alta        | Placeholder colorati; blocca lo stile su 3 creature prima di disegnarne 24                              |
| Bilanciamento infinito                      | Media       | `balance-sim.ts` dalla Fase 2, non dalla Fase 6                                                         |
| Salvataggi rotti da un update               | Media       | Migrazioni + test che carica un save v1 a ogni release                                                  |
| API Phaser 3 e 4 mischiate                  | Media       | Versione pinnata, wrapper in `src/engine/`, skill ufficiali in `node_modules/phaser/skills/`            |
| Divergenza fra simulazione online e offline | Media       | Stessi riduttori + test di equivalenza obbligatorio (ADR 0002)                                          |
| Banda Pages esaurita                        | Bassa       | Budget 12 MB imposto in CI                                                                              |
| Somiglianza a franchise esistenti           | Bassa       | Asset e nomi originali, `ASSETS.md`, nessuna riproduzione 1:1 di meccaniche brevettate                  |

---

## Appendice A — Decisioni già prese

1. Combattimento **a turni con ATB in modalità wait**, non action in tempo reale.
2. Il giocatore **non combatte**: comanda i Ferali. Niente armi da fuoco.
3. Mondo **handcrafted**, non procedurale: 3 biomi curati valgono più di 30 generati.
4. **6 mansioni, 6 tipi**: bilanciabile da una persona sola.
5. **Una sola base** in MVP, espandibile. Le basi multiple moltiplicano i bug.
6. **Nessun multiplayer** in MVP.
7. **TypeScript 5.9**, non la 7 (ADR 0004).

## Appendice B — Backlog

Vedi `docs/BACKLOG.md`.
