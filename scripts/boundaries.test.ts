/**
 * I confini architetturali, verificati per davvero.
 *
 * `eslint.config.js` dichiara le regole; questo file dimostra che scattano.
 * Serve perche' il modo tipico in cui un confine muore non e' qualcuno che lo
 * viola: e' qualcuno che commenta tre righe di configurazione per sbloccarsi
 * un venerdi' sera, e nessuno se ne accorge fino alla Fase 4.
 *
 * Il metodo: si scrive un file temporaneo nella cartella da testare (serve un
 * file vero, perche' il type-checking di typescript-eslint rifiuta i file
 * fantasma), lo si passa a ESLint e lo si cancella nel `finally`. Il nome e'
 * in .gitignore, cosi' un crash non puo' sporcare un commit.
 */
import { rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';
import { beforeAll, describe, expect, it } from 'vitest';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));

let eslint: ESLint;

beforeAll(() => {
  eslint = new ESLint({ cwd: ROOT });
});

/** Lint di uno snippet come se vivesse in `relativePath`. Restituisce le regole scattate. */
async function rulesTriggeredIn(relativePath: string, code: string): Promise<string[]> {
  const absolute = join(ROOT, relativePath);
  writeFileSync(absolute, code, 'utf8');
  try {
    const [result] = await eslint.lintText(code, { filePath: absolute });
    return (result?.messages ?? [])
      .map((message) => message.ruleId)
      .filter((ruleId): ruleId is string => ruleId !== null);
  } finally {
    rmSync(absolute, { force: true });
  }
}

const DOMAIN_PROBE = 'src/domain/__boundary-probe.ts';
const ENGINE_PROBE = 'src/engine/__boundary-probe.ts';
const SCENE_PROBE = 'src/scenes/__boundary-probe.ts';
const UI_PROBE = 'src/ui/__boundary-probe.ts';

describe('src/domain resta puro', { timeout: 60_000 }, () => {
  it('rifiuta l import di Phaser', async () => {
    const rules = await rulesTriggeredIn(
      DOMAIN_PROBE,
      "import { Phaser } from 'phaser';\nexport const engine = Phaser;\n",
    );
    expect(rules).toContain('no-restricted-imports');
  });

  it('rifiuta l import dei layer impuri', async () => {
    const rules = await rulesTriggeredIn(
      DOMAIN_PROBE,
      "import { createGame } from '@engine/index';\nexport const make = createGame;\n",
    );
    expect(rules).toContain('no-restricted-imports');
  });

  it('rifiuta Math.random()', async () => {
    const rules = await rulesTriggeredIn(
      DOMAIN_PROBE,
      'export const roll = (): number => Math.random();\n',
    );
    expect(rules).toContain('no-restricted-syntax');
  });

  it('rifiuta Date.now() e new Date()', async () => {
    const now = await rulesTriggeredIn(
      DOMAIN_PROBE,
      'export const t = (): number => Date.now();\n',
    );
    expect(now).toContain('no-restricted-syntax');

    const constructed = await rulesTriggeredIn(
      DOMAIN_PROBE,
      'export const d = (): Date => new Date();\n',
    );
    expect(constructed).toContain('no-restricted-syntax');
  });

  it('rifiuta i globali del browser', async () => {
    const rules = await rulesTriggeredIn(
      DOMAIN_PROBE,
      'export const stored = (): string | null => localStorage.getItem("x");\n',
    );
    expect(rules).toContain('no-restricted-globals');
  });

  it('lascia passare la logica pura', async () => {
    const rules = await rulesTriggeredIn(
      DOMAIN_PROBE,
      [
        "import { createRng } from './rng';",
        'export function firstRoll(seed: number): number {',
        '  return createRng(seed).next();',
        '}',
        '',
      ].join('\n'),
    );
    expect(rules).toEqual([]);
  });
});

describe('Phaser vive solo in src/engine', { timeout: 60_000 }, () => {
  it('src/engine puo importarlo', async () => {
    const rules = await rulesTriggeredIn(
      ENGINE_PROBE,
      "import * as Phaser from 'phaser';\nexport const auto = Phaser.AUTO;\n",
    );
    expect(rules).not.toContain('no-restricted-imports');
  });

  it('src/scenes deve passare dal wrapper', async () => {
    const direct = await rulesTriggeredIn(
      SCENE_PROBE,
      "import * as Phaser from 'phaser';\nexport const auto = Phaser.AUTO;\n",
    );
    expect(direct).toContain('no-restricted-imports');

    const wrapped = await rulesTriggeredIn(
      SCENE_PROBE,
      "import { Phaser } from '@engine/phaser';\nexport const auto = Phaser.AUTO;\n",
    );
    expect(wrapped).not.toContain('no-restricted-imports');
  });
});

describe('nessuna stringa visibile hardcoded', { timeout: 60_000 }, () => {
  it('rifiuta textContent assegnato a un letterale', async () => {
    const rules = await rulesTriggeredIn(
      UI_PROBE,
      [
        'export function render(node: HTMLElement): void {',
        "  node.textContent = 'Cattura';",
        '}',
        '',
      ].join('\n'),
    );
    expect(rules).toContain('no-restricted-syntax');
  });

  it('accetta textContent assegnato da t()', async () => {
    const rules = await rulesTriggeredIn(
      UI_PROBE,
      [
        "import { t } from '@i18n/index';",
        'export function render(node: HTMLElement): void {',
        "  node.textContent = t('app.title');",
        '}',
        '',
      ].join('\n'),
    );
    expect(rules).toEqual([]);
  });

  it('rifiuta innerHTML ovunque', async () => {
    const rules = await rulesTriggeredIn(
      UI_PROBE,
      [
        'export function render(node: HTMLElement, html: string): void {',
        '  node.innerHTML = html;',
        '}',
        '',
      ].join('\n'),
    );
    expect(rules).toContain('no-restricted-syntax');
  });
});
