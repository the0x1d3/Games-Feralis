import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vitest/config';

const resolvePath = (relative: string): string => fileURLToPath(new URL(relative, import.meta.url));

/**
 * `base` deve combaciare con il path di GitHub Pages: https://the0x1d3.github.io/Games-Feralis/
 * Nel codice non si scrive MAI questo valore a mano: si usa `import.meta.env.BASE_URL`.
 * Se un giorno il progetto migra su Vercel/Netlify, qui si mette '/' e non cambia altro.
 */
export default defineConfig({
  base: '/Games-Feralis/',
  resolve: {
    alias: {
      '@domain': resolvePath('./src/domain'),
      '@state': resolvePath('./src/state'),
      '@engine': resolvePath('./src/engine'),
      '@scenes': resolvePath('./src/scenes'),
      '@save': resolvePath('./src/save'),
      '@ui': resolvePath('./src/ui'),
      '@i18n': resolvePath('./src/i18n'),
      '@data': resolvePath('./data'),
    },
  },
  build: {
    target: 'es2022',
    sourcemap: false,
    // Phaser da solo supera il warning di default: alziamo la soglia per non
    // avere rumore costante, il budget vero lo impone `npm run size-check`.
    chunkSizeWarningLimit: 1600,
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'scripts/**/*.test.ts'],
    restoreMocks: true,
  },
});
