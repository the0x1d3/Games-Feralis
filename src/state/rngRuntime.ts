import {
  createRng,
  RNG_STREAM_NAMES,
  type Rng,
  type RngStreamName,
  type RngStreamStates,
} from '@domain/rng';

/**
 * Gli stream di casualita' vivi durante una sessione.
 *
 * Esistono gia' in Fase 1 anche se nulla, nel mondo esplorabile, estrae ancora
 * un numero: servono a chiudere il buco E6 del PDR. Il salvataggio memorizza
 * la POSIZIONE di ogni stream, non solo il seme, e al caricamento la sessione
 * riprende esattamente da li'. Aggiungerlo dopo, quando in Fase 2 la cattura
 * comincera' a pescare, significherebbe scoprire che tutte le partite salvate
 * rivedono la stessa sequenza a ogni ricarica.
 */

export interface RngRuntime {
  stream(name: RngStreamName): Rng;
  /**
   * Riporta uno stream a una posizione nota.
   *
   * Serve al combattimento, che porta il proprio stato del RNG dentro lo stato
   * dello scontro per restare riproducibile da un seme: a fine scontro la
   * posizione raggiunta va restituita alla sessione, o le estrazioni fatte in
   * battaglia si ripeterebbero fuori.
   */
  setState(name: RngStreamName, state: number): void;
  /** Lo stato corrente di tutti gli stream, pronto per il salvataggio. */
  snapshot(): RngStreamStates;
}

export function createRngRuntime(states: RngStreamStates): RngRuntime {
  const streams = new Map<RngStreamName, Rng>();
  for (const name of RNG_STREAM_NAMES) {
    streams.set(name, createRng(states[name]));
  }

  return {
    stream(name) {
      const rng = streams.get(name);
      if (rng === undefined) throw new Error(`Stream RNG sconosciuto: "${name}"`);
      return rng;
    },
    setState(name, state) {
      streams.set(name, createRng(state));
    },

    snapshot() {
      const result = {} as Record<RngStreamName, number>;
      for (const name of RNG_STREAM_NAMES) {
        result[name] = streams.get(name)?.getState() ?? states[name];
      }
      return result;
    },
  };
}
