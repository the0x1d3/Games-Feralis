/**
 * Simulatore di bilanciamento.
 *
 * Il PDR §12 elenca "bilanciamento infinito" fra i rischi principali e fissa la
 * mitigazione: questo script esiste dalla Fase 2, non dalla Fase 6.
 *
 * Verifica i criteri di accettazione della Fase 2 (PDR §7):
 *  · 1000 combattimenti simulati senza crash
 *  · durata mediana fra 20 e 40 secondi
 *  · una Comune a HP pieni con Nodo base si cattura fra il 25% e il 35%
 *
 * Gira sulle stesse funzioni del gioco, non su una copia: se qui il
 * combattimento dura trenta secondi, dura trenta secondi anche nel browser.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createBattle, reduceBattle, type BattleAction } from '../src/domain/battle/battle';
import { captureChance } from '../src/domain/battle/capture';
import { parseBattleConfig } from '../src/domain/battle/config';
import { decide, type AiActor, type AiLevel } from '../src/domain/battle/ai';
import { activeOf, type BattleContext, type BattleState } from '../src/domain/battle/state';
import { createCreature } from '../src/domain/creature/instance';
import { parseMoves, parseSpecies, type Move, type Species } from '../src/domain/creature/species';
import { parseCreatureConfig } from '../src/domain/creature/stats';
import { createRng, createStreamStates } from '../src/domain/rng';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const readJson = (...parts: string[]): unknown =>
  JSON.parse(readFileSync(join(ROOT, ...parts), 'utf8'));

const battleConfig = parseBattleConfig(readJson('data', 'battle.json'));
const creatureConfig = parseCreatureConfig(readJson('data', 'creatures.json'));
const moves = parseMoves(readJson('data', 'moves.json'));

const species = new Map<string, Species>();
for (const file of readdirSync(join(ROOT, 'data', 'species'))) {
  if (!file.endsWith('.json')) continue;
  const id = file.replace(/\.json$/, '');
  species.set(id, parseSpecies(readJson('data', 'species', file), id));
}

const SIMULATIONS = 1000;
const PLAYER_LEVEL = 8;
const WILD_LEVEL_MIN = 5;
const WILD_LEVEL_MAX = 9;

/** Il giocatore simulato gioca al livello dell'IA "greedy": né perfetto né sciocco. */
const PLAYER_AI: AiLevel = 'greedy';

const context: BattleContext = {
  config: battleConfig,
  creatures: creatureConfig,
  moves,
  species,
  isNight: false,
  teamLevel: PLAYER_LEVEL,
};

function actorOf(state: BattleState, side: 'player' | 'enemy'): AiActor {
  const active = activeOf(state, side);
  return {
    level: active.level,
    stats: active.stats,
    types: active.types,
    status: active.status,
    hp: active.hp,
    moves: active.moves
      .map((id) => moves.get(id))
      .filter((move): move is Move => move !== undefined),
  };
}

interface Outcome {
  readonly outcome: string;
  readonly seconds: number;
  readonly turns: number;
}

function simulate(seed: number): Outcome {
  const streams = createStreamStates(seed);
  const setup = createRng(streams.world);
  const speciesList = [...species.values()];

  const playerTeam = Array.from({ length: battleConfig.partySize }, () =>
    createCreature(
      { species: setup.pick(speciesList), level: PLAYER_LEVEL, isAlpha: false, caughtAt: 0 },
      creatureConfig,
      setup,
    ),
  );

  const wild = createCreature(
    {
      species: setup.pick(speciesList),
      level: setup.int(WILD_LEVEL_MIN, WILD_LEVEL_MAX),
      isAlpha: false,
      caughtAt: 0,
    },
    creatureConfig,
    setup,
  );

  let state = createBattle(
    { playerTeam, enemyTeam: [wild], aiLevel: 'greedy', rngState: streams.battle },
    context,
  );

  const decisionRng = createRng(streams.loot);

  for (let guard = 0; guard < 100_000 && state.phase !== 'over'; guard += 1) {
    if (state.phase === 'running') {
      state = reduceBattle(state, { type: 'tick' }, context);
      continue;
    }

    const decision = decide(
      PLAYER_AI,
      actorOf(state, 'player'),
      actorOf(state, 'enemy'),
      [],
      battleConfig,
      decisionRng,
    );
    const action: BattleAction =
      decision.kind === 'switch'
        ? { type: 'switch', index: decision.index }
        : { type: 'move', moveId: decision.moveId };
    state = reduceBattle(state, action, context);
  }

  return {
    outcome: state.outcome ?? 'incompiuto',
    seconds: state.elapsedMs / 1000,
    turns: state.turn,
  };
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[middle] ?? 0;
  return ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
}

function percentile(values: readonly number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] ?? 0;
}

/* ---------------------------------------------------------- combattimenti */

console.log(`balance:sim — ${SIMULATIONS} combattimenti selvatici\n`);

const results: Outcome[] = [];
const failures: string[] = [];

for (let i = 0; i < SIMULATIONS; i += 1) {
  try {
    results.push(simulate(1000 + i));
  } catch (error) {
    failures.push(`seme ${1000 + i}: ${(error as Error).message}`);
  }
}

const durations = results.map((r) => r.seconds);
const outcomes = new Map<string, number>();
for (const result of results) outcomes.set(result.outcome, (outcomes.get(result.outcome) ?? 0) + 1);

const medianSeconds = median(durations);

console.log('  durata');
console.log(`    mediana        ${medianSeconds.toFixed(1)} s   (target 20–40)`);
console.log(`    10° percentile ${percentile(durations, 0.1).toFixed(1)} s`);
console.log(`    90° percentile ${percentile(durations, 0.9).toFixed(1)} s`);
console.log(`    turni mediani  ${median(results.map((r) => r.turns)).toFixed(0)}`);
console.log('\n  esiti');
for (const [outcome, count] of [...outcomes].sort((a, b) => b[1] - a[1])) {
  console.log(`    ${outcome.padEnd(14)} ${((count / results.length) * 100).toFixed(1)}%`);
}

/* --------------------------------------------------------------- cattura */

const foundTool = battleConfig.tools.find((tool) => tool.id === 'nodo_base');
if (foundTool === undefined) throw new Error('battle.json: manca il Nodo base');
const baseTool = foundTool;

const foundCommon = [...species.values()].find((entry) => entry.rarity === 'common');
if (foundCommon === undefined) throw new Error('serve almeno una specie comune');
const common = foundCommon;

function chanceAt(hpRatio: number, statusId?: 'wet'): number {
  return captureChance(
    {
      hp: 100 * hpRatio,
      maxHp: 100,
      level: PLAYER_LEVEL,
      baseCatchRate: common.baseCatchRate,
      ...(statusId === undefined ? {} : { status: { id: statusId, turnsLeft: 3 } }),
    },
    baseTool,
    { teamLevel: PLAYER_LEVEL, isNight: false },
    battleConfig,
  );
}

const fullHp = chanceAt(1);

console.log('\n  cattura di una Comune con Nodo base');
console.log(`    HP pieni       ${(fullHp * 100).toFixed(1)}%   (target 25–35)`);
console.log(`    metà HP        ${(chanceAt(0.5) * 100).toFixed(1)}%`);
console.log(`    quasi KO       ${(chanceAt(0.05) * 100).toFixed(1)}%`);
console.log(`    quasi KO + Bagnato ${(chanceAt(0.05, 'wet') * 100).toFixed(1)}%`);

/* --------------------------------------------------------------- verdetto */

const problems: string[] = [];

if (failures.length > 0) {
  problems.push(`${failures.length} combattimenti sono andati in errore`);
  for (const failure of failures.slice(0, 5)) problems.push(`  ${failure}`);
}
if (outcomes.get('incompiuto') !== undefined) {
  problems.push(`${outcomes.get('incompiuto') ?? 0} combattimenti non sono mai finiti`);
}
if (medianSeconds < 20 || medianSeconds > 40) {
  problems.push(`durata mediana ${medianSeconds.toFixed(1)} s, fuori dal target 20–40 s`);
}
if (fullHp < 0.25 || fullHp > 0.35) {
  problems.push(
    `cattura di una Comune a HP pieni al ${(fullHp * 100).toFixed(1)}%, fuori dal target 25–35%`,
  );
}

if (problems.length > 0) {
  console.error('\nbalance:sim — FALLITO\n');
  for (const problem of problems) console.error(`  ${problem}`);
  console.error('');
  process.exit(1);
}

console.log('\nbalance:sim — ok');
