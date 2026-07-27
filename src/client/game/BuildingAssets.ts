import type { BuildingKind } from '../../shared/types';
import { getRandomItem } from '../../shared/randomItems';

// Asset URLs are versioned so a device with an older service-worker/image
// cache receives the new illustration set immediately after an app update.
const BUILDING_ART_VERSION = 'cute-tile-v11-rewards';

const LEVELLED_BUILDINGS = new Set<BuildingKind>([
  'basic-turret',
  'golden-turret',
  'generator',
  'repair-drone',
  'electric-coil',
  'shield-device',
  'gem-core',
  'range-amplifier',
]);

const STATIC_ART: Partial<Record<BuildingKind, string>> = {
  'frost-turret': 'cute-frost-spray',
  'lucky-machine': 'cute-lucky-machine',
  'ghost-net': 'cute-ghost-net',
  'starter-grave': 'cute-starter-grave',
  'overload-capacitor': 'cute-overload-capacitor',
  'turret-enhancer': 'cute-turret-enhancer',
  'door-anchor': 'cute-door-anchor',
  'reflect-mirror': 'cute-reflect-mirror',
  'power-panel': 'cute-power-panel',
  'cursed-contract': 'cute-cursed-contract',
  'soul-vial': 'cute-soul-vial',
};

/** Image-led top-down construction art for every installable building. */
export function randomItemAssetUrl(itemId?: string): string {
  if (itemId === 'golden-ticket')
    return `/assets/items/golden-ticket.png?v=${BUILDING_ART_VERSION}`;
  const effect = itemId ? getRandomItem(itemId)?.effect : undefined;
  const goldRewardArt: Record<number, string> = {
    1: 'reward-grave-1',
    2: 'reward-chicken-2',
    5: 'reward-piggy-gray-5',
    10: 'reward-piggy-red-10',
    20: 'reward-piggy-moon-20',
    50: 'reward-golden-frog-50',
    100: 'reward-golden-bull-100',
    500: 'reward-black-card-500',
  };
  const file = goldRewardArt[effect?.goldPerSecond ?? 0]
    ?? (effect?.powerPerSecond
      ? 'random-loot-power'
      : 'random-loot-turret');
  return `/assets/items/${file}.png?v=${BUILDING_ART_VERSION}`;
}

export function buildingAssetUrl(kind: BuildingKind, level = 1, itemId?: string): string | null {
  if (kind === 'random-item') return randomItemAssetUrl(itemId);
  if (kind === 'shield-device')
    return `/assets/buildings/cute-shield-device-${Math.max(1, Math.floor(level))}-v2.png?v=${BUILDING_ART_VERSION}`;
  if (LEVELLED_BUILDINGS.has(kind))
    return kind === 'golden-turret'
      ? `/assets/buildings/golden-turret-${Math.max(1, Math.min(10, Math.floor(level)))}.png?v=${BUILDING_ART_VERSION}`
      : `/assets/buildings/cute-${kind}-${Math.max(1, Math.floor(level))}.png?v=${BUILDING_ART_VERSION}`;
  const filename = STATIC_ART[kind];
  return filename ? `/assets/buildings/${filename}.png?v=${BUILDING_ART_VERSION}` : null;
}
