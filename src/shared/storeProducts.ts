/** Canonical consumable cash SKUs. Store consoles own localized prices. */
export const CASH_STORE_PRODUCTS = [
  { id: 'com.midnightdorm.cash.100', cash: 100, fallbackPriceKrw: 1_500 },
  { id: 'com.midnightdorm.cash.550', cash: 550, fallbackPriceKrw: 7_500 },
  { id: 'com.midnightdorm.cash.1200', cash: 1_200, fallbackPriceKrw: 15_000 },
  { id: 'com.midnightdorm.cash.2500', cash: 2_500, fallbackPriceKrw: 30_000 },
  { id: 'com.midnightdorm.cash.5200', cash: 5_200, fallbackPriceKrw: 60_000 },
  { id: 'com.midnightdorm.cash.10800', cash: 10_800, fallbackPriceKrw: 120_000 },
] as const;

export type CashStoreProduct = typeof CASH_STORE_PRODUCTS[number];

/** Each SKU grants this bonus only on its first verified purchase per account. */
export const FIRST_CASH_PURCHASE_BONUS_RATE = 0.2;

export function firstCashPurchaseBonus(product: CashStoreProduct): number {
  return Math.floor(product.cash * FIRST_CASH_PURCHASE_BONUS_RATE);
}

export function cashGrantAmount(product: CashStoreProduct, firstPurchase: boolean): number {
  return product.cash + (firstPurchase ? firstCashPurchaseBonus(product) : 0);
}

export const STORE_PRODUCT_IDS = CASH_STORE_PRODUCTS.map((product) => product.id);

export type StoreProductId = typeof CASH_STORE_PRODUCTS[number]['id'];

export const CASH_PRODUCT_BY_ID = new Map<string, CashStoreProduct>(
  CASH_STORE_PRODUCTS.map((product) => [product.id, product]),
);
