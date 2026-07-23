import type { BuildingKind } from '../../shared/types';

const LEVELLED_BUILDINGS = new Set<BuildingKind>([
  'basic-turret',
  'generator',
  'repair-drone',
  'electric-coil',
  'floor-trap',
  'shield-device',
  'gem-core',
  'range-amplifier',
]);

const STATIC_ART: Partial<Record<BuildingKind, string>> = {
  'frost-turret': 'frost-spray',
  'lucky-machine': 'lucky-machine',
  'ghost-net': 'ghost-net',
  'starter-grave': 'starter-grave',
};

/** Image-led top-down construction art. Old turret-only entries intentionally
 * return null because they cannot be installed in a new match. */
export function buildingAssetUrl(kind: BuildingKind, level = 1): string | null {
  if (LEVELLED_BUILDINGS.has(kind))
    return `/assets/buildings/${kind}-${Math.max(1, Math.floor(level))}.png`;
  const filename = STATIC_ART[kind];
  return filename ? `/assets/buildings/${filename}.png` : null;
}
