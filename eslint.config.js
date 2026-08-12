// @ts-check
import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

/*
 * ============================================================================
 *  I CONFINI ARCHITETTURALI DI FERALIS
 * ----------------------------------------------------------------------------
 *  Le regole di `docs/ADR/0001-domain-puro-e-confini-lint.md` non sono
 *  raccomandazioni: sono errori di lint. Un confine che dipende dalla buona
 *  volonta' viene violato entro tre settimane, e la Fase 4 diventa una
 *  riscrittura. Qui vengono resi meccanici.
 * ============================================================================
 */

/**
 * Phaser esiste solo dentro src/engine/. Tutto il resto lo ignora.
 *
 * Va espresso come `paths` (match esatto) e non come `patterns`: i pattern di
 * no-restricted-imports usano una semantica alla gitignore, per cui il gruppo
 * 'phaser' catturava anche il nostro wrapper '@engine/phaser' e vietava
 * l'unica rotta che invece vogliamo lasciare aperta.
 */
const PHASER_IS_ENGINE_ONLY = {
  name: 'phaser',
  message:
    'Phaser si importa SOLO in src/engine/. Il resto del codice parla con il wrapper (@engine/phaser), cosi una migrazione a Phaser 5 tocca una cartella sola. Vedi docs/ADR/0001.',
};

/** src/domain/ non conosce i layer impuri. La dipendenza va in una direzione sola. */
const DOMAIN_KNOWS_NOTHING_IMPURE = {
  group: [
    '@engine/*',
    '@ui/*',
    '@scenes/*',
    '@state/*',
    '@save/*',
    '@i18n/*',
    '**/engine/**',
    '**/ui/**',
    '**/scenes/**',
    '**/state/**',
    '**/save/**',
    '**/i18n/**',
  ],
  message:
    'src/domain/ e logica PURA: non importa engine, ui, scenes, state, save o i18n. Se ti serve un valore da fuori, passalo come argomento.',
};

/** Globali che tradiscono un effetto collaterale dentro il dominio. */
const IMPURE_GLOBALS = [
  'window',
  'document',
  'localStorage',
  'sessionStorage',
  'indexedDB',
  'navigator',
  'location',
  'performance',
  'fetch',
  'alert',
  'console',
  'requestAnimationFrame',
  'setTimeout',
  'setInterval',
].map((name) => ({
  name,
  message: `'${name}' rende src/domain/ impuro e non testabile a passo fisso. Usa il Clock iniettato (src/domain/clock.ts) o passa il dato come argomento.`,
}));

/** Vietato ovunque, non solo nel dominio: e igiene, non architettura. */
const FORBIDDEN_EVERYWHERE = [
  {
    selector:
      "AssignmentExpression[left.type='MemberExpression'][left.property.name=/^(innerHTML|outerHTML)$/]",
    message:
      'innerHTML/outerHTML vietati: usa textContent. Il testo visibile arriva sempre da t(), mai da una concatenazione.',
  },
  {
    selector: "MemberExpression[object.name='document'][property.name='write']",
    message: 'document.write non si usa nel 2026.',
  },
];

/** Vietato solo dentro src/domain/. */
const FORBIDDEN_IN_DOMAIN = [
  {
    selector: "NewExpression[callee.name='Date']",
    message:
      'Niente new Date() nel dominio: il tempo arriva dal Clock iniettato, altrimenti i test non sono riproducibili e la simulazione offline diverge.',
  },
  {
    selector: "CallExpression[callee.object.name='Date'][callee.property.name='now']",
    message: 'Niente Date.now() nel dominio: usa il Clock iniettato (src/domain/clock.ts).',
  },
  {
    selector: "CallExpression[callee.object.name='Math'][callee.property.name='random']",
    message:
      'Niente Math.random(): usa il RNG seeded (src/domain/rng.ts), altrimenti i test e i seed condivisi non funzionano.',
  },
];

/** Vietato in ui/ e scenes/: e la regola 3 di CLAUDE.md, attiva dalla Fase 0. */
const NO_HARDCODED_UI_STRINGS = [
  {
    selector:
      "AssignmentExpression[left.type='MemberExpression'][left.property.name=/^(textContent|innerText|title|placeholder|ariaLabel)$/][right.type='Literal'][right.value!='']",
    message:
      'Nessuna stringa visibile hardcoded: usa t("chiave"). Aggiungere le chiavi in Fase 7 e archeologia, non i18n.',
  },
  {
    selector: 'CallExpression[callee.property.name=/^(setText|setTitle)$/] > Literal:first-child',
    message: 'Nessuna stringa visibile hardcoded: usa t("chiave").',
  },
];

export default tseslint.config(
  {
    ignores: ['dist/**', 'coverage/**', 'node_modules/**', '**/*.tsbuildinfo'],
  },

  /* ---------- File JS di configurazione ---------- */
  {
    files: ['**/*.js'],
    extends: [js.configs.recommended],
    languageOptions: { globals: { ...globals.node } },
  },

  /* ---------- Tutto il TypeScript, con type information ---------- */
  {
    files: ['**/*.ts'],
    extends: [js.configs.recommended, ...tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      /*
       * `const { status: _scarta, ...resto } = oggetto` è il modo tipizzato di
       * togliere una chiave opzionale con `exactOptionalPropertyTypes`, dove
       * assegnare `undefined` non è ammesso. Il prefisso `_` dichiara che la
       * variabile esiste solo per essere scartata.
       */
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          ignoreRestSiblings: true,
          varsIgnorePattern: '^_',
          argsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
      '@typescript-eslint/ban-ts-comment': [
        'error',
        {
          'ts-ignore': true,
          'ts-nocheck': true,
          'ts-expect-error': 'allow-with-description',
          minimumDescriptionLength: 10,
        },
      ],
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
      '@typescript-eslint/switch-exhaustiveness-check': 'error',
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'no-restricted-syntax': ['error', ...FORBIDDEN_EVERYWHERE],
    },
  },

  /* ---------- src/**: il codice di gioco ---------- */
  {
    files: ['src/**/*.ts'],
    languageOptions: { globals: { ...globals.browser } },
    rules: {
      'no-restricted-imports': ['error', { paths: [PHASER_IS_ENGINE_ONLY] }],
      'no-console': ['warn', { allow: ['warn', 'error'] }],
    },
  },

  /* ---------- src/engine/**: l'unica cartella che vede Phaser ---------- */
  {
    files: ['src/engine/**/*.ts'],
    rules: {
      'no-restricted-imports': 'off',
    },
  },

  /* ---------- src/domain/**: logica pura, zero effetti ---------- */
  {
    files: ['src/domain/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        { paths: [PHASER_IS_ENGINE_ONLY], patterns: [DOMAIN_KNOWS_NOTHING_IMPURE] },
      ],
      'no-restricted-globals': ['error', ...IMPURE_GLOBALS],
      'no-restricted-syntax': ['error', ...FORBIDDEN_EVERYWHERE, ...FORBIDDEN_IN_DOMAIN],
    },
  },

  /* ---------- src/ui/** e src/scenes/**: nessuna stringa hardcoded ---------- */
  {
    files: ['src/ui/**/*.ts', 'src/scenes/**/*.ts'],
    rules: {
      'no-restricted-syntax': ['error', ...FORBIDDEN_EVERYWHERE, ...NO_HARDCODED_UI_STRINGS],
    },
  },

  /* ---------- Script di build e config: girano in Node ---------- */
  {
    files: ['scripts/**/*.ts', 'vite.config.ts'],
    languageOptions: { globals: { ...globals.node } },
    rules: {
      'no-console': 'off',
      'no-restricted-imports': 'off',
    },
  },

  /* ---------- Test ---------- */
  {
    files: ['**/*.test.ts'],
    rules: {
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  },
);
