import type { Clock } from '@domain/clock';

/**
 * L'unico punto del progetto che legge l'orologio di sistema.
 *
 * Il dominio riceve sempre un `Clock`: in produzione questo, nei test un
 * `fixedClock`. E' la ragione per cui il criterio di accettazione della Fase 4
 * ("riapri dopo 10 minuti e trovi esattamente le risorse calcolate dal test")
 * potra' essere verificato senza aspettare 10 minuti veri.
 */
export const systemClock: Clock = {
  now: () => Date.now(),
};
