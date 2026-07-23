import { cosmeticById } from '../../shared/customization';
import type { AvatarAppearance, CosmeticSlot } from '../../shared/types';

export type WearableCosmeticSlot = Exclude<CosmeticSlot, 'character' | 'turret'>;

export const WEARABLE_COSMETIC_SLOTS: readonly WearableCosmeticSlot[] = [
  'outfit',
  'shoes',
  'hat',
  'accessory',
] as const;

export function cosmeticProductUrl(id: string): string | undefined {
  const item = cosmeticById(id);
  if (!item || item.slot === 'character' || item.slot === 'turret' || id === 'accessory-none') return undefined;
  return `/assets/cosmetics/items/${id}.png`;
}

export function cosmeticPreviewLayerUrl(id: string): string | undefined {
  const product = cosmeticProductUrl(id);
  return product ? `/assets/cosmetics/preview/${id}.png` : undefined;
}

export function wearableIds(appearance: AvatarAppearance): Array<[WearableCosmeticSlot, string]> {
  return WEARABLE_COSMETIC_SLOTS.map((slot) => [slot, appearance[slot]]);
}

