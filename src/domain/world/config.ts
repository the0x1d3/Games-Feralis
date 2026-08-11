import { asArray, asColor, asNumber, asRecord, asString } from '../guards';
import type { Body } from './collision';
import type { AmbientKeyframe, TimeConfig } from './time';

/** Lettura di `data/world/world.json`. Nessun numero di bilanciamento vive qui. */

export interface PlayerConfig {
  readonly speedTilesPerSecond: number;
  readonly body: Body;
  /** Scostamento verticale dello sprite rispetto al centro del corpo. */
  readonly spriteOffsetY: number;
}

export interface SaveConfig {
  readonly autosaveIntervalMs: number;
  readonly offlineCapMs: number;
}

export interface WorldConfig {
  readonly startZoneId: string;
  readonly startSpawn: string;
  readonly time: TimeConfig;
  readonly player: PlayerConfig;
  readonly cameraLerp: number;
  readonly save: SaveConfig;
}

function parseAmbient(raw: unknown): AmbientKeyframe[] {
  const frames = asArray(raw, 'world.json.time.ambient').map((entry, index) => {
    const record = asRecord(entry, `world.json.time.ambient[${index}]`);
    return {
      hour: asNumber(record['hour'], `world.json.time.ambient[${index}].hour`),
      color: asColor(record['color'], `world.json.time.ambient[${index}].color`),
      alpha: asNumber(record['alpha'], `world.json.time.ambient[${index}].alpha`),
    };
  });

  if (frames.length < 2) {
    throw new RangeError('world.json.time.ambient: servono almeno due fotogrammi chiave');
  }
  for (let i = 1; i < frames.length; i += 1) {
    const previous = frames[i - 1];
    const current = frames[i];
    if (previous !== undefined && current !== undefined && current.hour <= previous.hour) {
      throw new RangeError('world.json.time.ambient: le ore devono essere in ordine crescente');
    }
  }
  return frames;
}

export function parseWorldConfig(raw: unknown): WorldConfig {
  const root = asRecord(raw, 'world.json');
  const time = asRecord(root['time'], 'world.json.time');
  const player = asRecord(root['player'], 'world.json.player');
  const camera = asRecord(root['camera'], 'world.json.camera');
  const save = asRecord(root['save'], 'world.json.save');

  return {
    startZoneId: asString(root['startZoneId'], 'world.json.startZoneId'),
    startSpawn: asString(root['startSpawn'], 'world.json.startSpawn'),
    time: {
      dayLengthRealMs: asNumber(time['dayLengthRealMs'], 'world.json.time.dayLengthRealMs'),
      startHour: asNumber(time['startHour'], 'world.json.time.startHour'),
      dawnStartHour: asNumber(time['dawnStartHour'], 'world.json.time.dawnStartHour'),
      dayStartHour: asNumber(time['dayStartHour'], 'world.json.time.dayStartHour'),
      duskStartHour: asNumber(time['duskStartHour'], 'world.json.time.duskStartHour'),
      nightStartHour: asNumber(time['nightStartHour'], 'world.json.time.nightStartHour'),
      ambient: parseAmbient(time['ambient']),
    },
    player: {
      speedTilesPerSecond: asNumber(
        player['speedTilesPerSecond'],
        'world.json.player.speedTilesPerSecond',
      ),
      body: {
        halfWidth: asNumber(player['bodyWidth'], 'world.json.player.bodyWidth') / 2,
        halfHeight: asNumber(player['bodyHeight'], 'world.json.player.bodyHeight') / 2,
      },
      spriteOffsetY: asNumber(player['spriteOffsetY'], 'world.json.player.spriteOffsetY'),
    },
    cameraLerp: asNumber(camera['lerp'], 'world.json.camera.lerp'),
    save: {
      autosaveIntervalMs: asNumber(
        save['autosaveIntervalMs'],
        'world.json.save.autosaveIntervalMs',
      ),
      offlineCapMs: asNumber(save['offlineCapMs'], 'world.json.save.offlineCapMs'),
    },
  };
}
