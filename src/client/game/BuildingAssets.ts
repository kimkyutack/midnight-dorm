import type { BuildingKind } from '../../shared/types';
import { turretSkinAssetUrl } from '../../shared/customization';

// Asset URLs are versioned so a device with an older service-worker/image
// cache receives the new illustration set immediately after an app update.
const BUILDING_ART_VERSION = 'cute-tile-v13-hide-and-seek-doll';

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
  'hide-and-seek-doll': 'cute-hide-and-seek-doll',
};

/** Every random-box result owns a distinct, centered in-world illustration. */
const RANDOM_ITEM_ART: Record<string, string> = {
  'mythic-ark': 'mythic-ark',
  'golden-ticket': 'golden-ticket',
  'void-cat': 'void-cat',
  'royal-money-tree': 'royal-money-tree',
  'golden-goose': 'golden-goose',
  'hundred-robot': 'hundred-robot',
  'red-lens': 'red-lens',
  'time-gear': 'time-gear',
  'moon-battery': 'moon-battery',
  'gold-frog': 'gold-frog',
  'overdrive-core': 'overdrive-core',
  'eclipse-dynamo': 'eclipse-dynamo',
  'black-market-coin': 'black-market-coin',
  'moon-piggy-bank': 'moon-piggy-bank',
  'moon-gem-reward': 'moon-gem-reward',
  'candle-coin-chest': 'candle-coin-chest',
  'iron-heart': 'iron-heart',
  'long-scope': 'long-scope',
  'repair-spider': 'repair-spider',
  'turret-overhaul-kit': 'turret-overhaul-kit',
  'silver-moth': 'silver-moth',
  'lucky-coin-pouch': 'lucky-coin-pouch',
  'armored-hinge': 'armored-hinge',
  'field-medkit': 'field-medkit',
  'tracking-chip': 'tracking-chip',
  'pocket-cell': 'pocket-cell',
  'oiled-spring': 'oiled-spring',
  'sharp-nail': 'sharp-nail',
  'copper-pig': 'copper-pig',
  'coin-candle': 'coin-candle',
  'tiny-wrench': 'tiny-wrench',
  'reinforced-nails': 'reinforced-nails',
  'tuned-rotor': 'tuned-rotor',
  'spare-fuse': 'spare-fuse',
  'cracked-mirror': 'cracked-mirror',
  'wet-socks': 'wet-socks',
};

/** Image-led top-down construction art for every installable building. */
export function randomItemAssetUrl(itemId?: string): string {
  const file = itemId ? RANDOM_ITEM_ART[itemId] : undefined;
  return file
    ? `/assets/items/rewards/${file}.png?v=${BUILDING_ART_VERSION}`
    : `/assets/items/random-loot-turret.png?v=${BUILDING_ART_VERSION}`;
}

export function buildingAssetUrl(
  kind: BuildingKind,
  level = 1,
  itemId?: string,
  skinId?: string,
): string | null {
  if (kind === 'random-item') return randomItemAssetUrl(itemId);
  // Moon gems become normal gem cores after placement, but retain their unique
  // drop art at level one so they are distinguishable from purchased gems.
  if (kind === 'gem-core' && itemId === 'moon-gem-reward' && Math.floor(level) <= 1)
    return randomItemAssetUrl(itemId);
  if (kind === 'shield-device')
    return `/assets/buildings/cute-shield-device-${Math.max(1, Math.floor(level))}-v2.png?v=${BUILDING_ART_VERSION}`;
  const turretSkinAsset = kind === 'basic-turret'
    ? turretSkinAssetUrl(skinId, level)
    : undefined;
  if (turretSkinAsset) return `${turretSkinAsset}?v=${BUILDING_ART_VERSION}`;
  if (LEVELLED_BUILDINGS.has(kind))
    return kind === 'golden-turret'
      ? `/assets/buildings/golden-turret-${Math.max(1, Math.min(10, Math.floor(level)))}.png?v=${BUILDING_ART_VERSION}`
      : `/assets/buildings/cute-${kind}-${Math.max(1, Math.floor(level))}.png?v=${BUILDING_ART_VERSION}`;
  const filename = STATIC_ART[kind];
  return filename ? `/assets/buildings/${filename}.png?v=${BUILDING_ART_VERSION}` : null;
}
