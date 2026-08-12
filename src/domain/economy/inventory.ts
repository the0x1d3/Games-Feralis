/**
 * Lo zaino del giocatore.
 *
 * La sconfitta costa una frazione di quel che si portava addosso (PDR §4.6). Il
 * deposito della Radura non si tocca mai: perdere quello sarebbe una punizione
 * sproporzionata in un gioco che si apre a ritagli.
 *
 * La frazione è un numero di bilanciamento e arriva da `/data`, mai da qui.
 */

export interface InventoryLoss {
  readonly inventory: Readonly<Record<string, number>>;
  readonly lost: Readonly<Record<string, number>>;
}

function totalOf(inventory: Readonly<Record<string, number>>): number {
  return Object.values(inventory).reduce((sum, count) => sum + Math.max(0, count), 0);
}

/**
 * Toglie una frazione da ogni pila, arrotondando per difetto.
 *
 * Per difetto e non per eccesso: con l'arrotondamento in su una pila da due
 * oggetti ne perderebbe uno, cioè il 50% invece del 10%. Ma se in questo modo
 * non si perde nulla e qualcosa nello zaino c'era, se ne toglie **uno** dalla
 * pila più alta: una penalità che non si vede mai non è una penalità, e la
 * pila più alta è quella che il giocatore può permettersi di intaccare.
 */
export function applyLossFraction(
  inventory: Readonly<Record<string, number>>,
  fraction: number,
): InventoryLoss {
  const safe = Math.max(0, Math.min(1, fraction));
  if (safe === 0 || totalOf(inventory) === 0) return { inventory, lost: {} };

  const next: Record<string, number> = {};
  const lost: Record<string, number> = {};

  for (const [id, count] of Object.entries(inventory)) {
    const held = Math.max(0, Math.floor(count));
    const taken = Math.floor(held * safe);
    next[id] = held - taken;
    if (taken > 0) lost[id] = taken;
  }

  if (Object.keys(lost).length === 0) {
    const biggest = Object.entries(next).reduce<[string, number] | undefined>(
      (top, entry) => (top === undefined || entry[1] > top[1] ? entry : top),
      undefined,
    );
    if (biggest !== undefined && biggest[1] > 0) {
      next[biggest[0]] = biggest[1] - 1;
      lost[biggest[0]] = 1;
    }
  }

  return { inventory: next, lost };
}
