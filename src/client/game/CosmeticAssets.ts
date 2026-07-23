import { cosmeticById } from '../../shared/customization';
import { skinConceptUrl } from './SkinAssets';

export function cosmeticProductUrl(id: string): string | undefined {
  const item = cosmeticById(id);
  if (!item || item.slot !== 'skin') return undefined;
  return skinConceptUrl(id);
}

export function cosmeticPreviewLayerUrl(id: string): string | undefined {
  return cosmeticProductUrl(id);
}
