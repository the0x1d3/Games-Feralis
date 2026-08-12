# ASSETS — origine e licenza di ogni file

**Regola di progetto**: questo file si aggiorna **nello stesso commit** in cui entra
l'asset. Senza, fra sei mesi non si saprà più se il gioco è pubblicabile — ed è un
problema che non si può risolvere a posteriori.

Per ogni asset servono: percorso, origine, autore, licenza, e link alla licenza se non
è una delle standard.

## Licenze ammesse

| Licenza                                | Ammessa | Nota                                                               |
| -------------------------------------- | ------- | ------------------------------------------------------------------ |
| Originale (creato per questo progetto) | ✅      | Da preferire                                                       |
| CC0 / Public Domain                    | ✅      | Nessun obbligo                                                     |
| CC-BY                                  | ✅      | Obbligo di attribuzione: va citata anche nei crediti in gioco      |
| CC-BY-SA                               | ⚠️      | Contagia: obbliga a rilasciare il derivato alle stesse condizioni  |
| GPL                                    | ⚠️      | Come sopra. Attenzione ai pack tipo Liberated Pixel Cup            |
| CC-NC (non commerciale)                | ⚠️      | Compatibile con questo progetto (è gratuito) ma blocca ogni futuro |
| Ripresa da altri giochi                | ❌      | Mai. Vedi PDR §2.5                                                 |

## Grafica

| File                                  | Origine                          | Autore           | Licenza   |
| ------------------------------------- | -------------------------------- | ---------------- | --------- |
| `public/favicon.svg`                  | Originale, disegnato a mano      | Progetto Feralis | Originale |
| `public/assets/tilesets/terrain.png`  | Generato da `npm run assets:gen` | Progetto Feralis | Originale |
| `public/assets/sprites/player.png`    | Generato da `npm run assets:gen` | Progetto Feralis | Originale |
| `public/assets/sprites/creatures.png` | Generato da `npm run assets:gen` | Progetto Feralis | Originale |
| `public/assets/sprites/structures.png` | Generato da `npm run assets:gen` | Progetto Feralis | Originale |

**Il tileset e lo sprite sono placeholder.** Li produce `scripts/gen-assets.ts`,
che scrive i PNG senza dipendenze esterne. Rigenerarli dà file identici bit per
bit, quindi non sporcano il diff. Esistono per essere buttati via quando arriverà
l'arte vera — PDR §12: prototipa con placeholder colorati, e blocca lo stile su
tre creature prima di disegnarne 24.

Ogni struttura sta in un fotogramma unico da 3x2 tile (96x64 px), ancorata in alto a
sinistra; quel che avanza resta trasparente. Un fotogramma di misura unica evita un
atlante a misure variabili: l'impronta vera è quella dichiarata in
`data/structures.json`, e la scena piazza lo sprite sull'angolo di quell'impronta.

Palette limitata, coerente fra tileset e sprite.

## Mappe

| File                       | Origine                                | Licenza   |
| -------------------------- | -------------------------------------- | --------- |
| `data/maps/costa.json`     | Disegnata in ASCII, esportata in Tiled | Originale |
| `data/maps/bosco.json`     | Disegnata in ASCII, esportata in Tiled | Originale |
| `data/maps/altopiano.json` | Disegnata in ASCII, esportata in Tiled | Originale |

La fonte è `scripts/author-maps.ts`; si rigenerano con `npm run maps:build`.
Vedi [ADR 0005](docs/ADR/0005-mappe-da-ascii-a-tiled.md).

## Audio

_(nessun asset audio: arriva in Fase 7)_

## Font

_(nessun font incorporato: la UI usa gli stack di sistema)_
