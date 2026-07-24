import type { BuildingKind } from '../../shared/types';

// Asset URLs are versioned so a device with an older service-worker/image
// cache receives the new illustration set immediately after an app update.
const BUILDING_ART_VERSION = 'cute-tile-v8-ranked';

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
};

/** Image-led top-down construction art for every installable building. */
export function buildingAssetUrl(kind: BuildingKind, level = 1): string | null {
  if (kind === 'shield-device')
    return `/assets/buildings/cute-shield-device-${Math.max(1, Math.floor(level))}-v2.png?v=${BUILDING_ART_VERSION}`;
  if (LEVELLED_BUILDINGS.has(kind))
    return kind === 'golden-turret'
      ? `/assets/buildings/golden-turret-${Math.max(1, Math.min(10, Math.floor(level)))}.png?v=${BUILDING_ART_VERSION}`
      : `/assets/buildings/cute-${kind}-${Math.max(1, Math.floor(level))}.png?v=${BUILDING_ART_VERSION}`;
  const filename = STATIC_ART[kind];
  return filename ? `/assets/buildings/${filename}.png?v=${BUILDING_ART_VERSION}` : null;
}
