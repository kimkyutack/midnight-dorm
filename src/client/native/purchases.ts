import { NativePurchases, PURCHASE_TYPE, type Product, type Transaction } from '@capgo/native-purchases';
import { isNativeApp, nativePlatform } from './runtime';
import { STORE_PRODUCT_IDS } from '../../shared/storeProducts';

const configuredProductIds = ((import.meta.env.VITE_STORE_PRODUCT_IDS as string | undefined) ?? '')
  .split(',')
  .map((id) => id.trim())
  .filter(Boolean);
const productIds = configuredProductIds.length ? configuredProductIds : [...STORE_PRODUCT_IDS];

export interface PurchaseVerification {
  status: 'verified' | 'pending' | 'rejected';
  transactionId: string;
}

async function purchasesEnabled(): Promise<boolean> {
  const response = await fetch('/api/store/config', { cache: 'no-store' });
  if (!response.ok) return false;
  const data = await response.json() as { purchasesEnabled?: boolean };
  return data.purchasesEnabled === true;
}

export async function loadStoreProducts(): Promise<Product[]> {
  if (!isNativeApp || productIds.length === 0) return [];
  const { products } = await NativePurchases.getProducts({
    productIdentifiers: productIds,
    productType: PURCHASE_TYPE.INAPP,
  });
  return products;
}

async function verifyTransaction(transaction: Transaction): Promise<PurchaseVerification> {
  const response = await fetch('/api/store/purchases/verify', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      platform: nativePlatform,
      productId: transaction.productIdentifier,
      transactionId: transaction.transactionId,
      purchaseToken: transaction.purchaseToken,
      receipt: transaction.receipt,
      jwsRepresentation: transaction.jwsRepresentation,
      purchaseDate: transaction.purchaseDate,
    }),
  });
  const data = await response.json() as PurchaseVerification & { error?: string };
  if (!response.ok) throw new Error(data.error ?? '스토어 구매 검증에 실패했습니다.');
  return data;
}

export async function purchaseStoreProduct(productId: string, accountId: string): Promise<PurchaseVerification> {
  if (!isNativeApp) throw new Error('인앱결제는 스토어 앱에서만 사용할 수 있습니다.');
  if (!productIds.includes(productId)) throw new Error('등록되지 않은 스토어 상품입니다.');
  if (!(await purchasesEnabled())) {
    throw new Error('스토어 서버 검증 설정이 완료된 뒤 구매할 수 있습니다.');
  }
  const transaction = await NativePurchases.purchaseProduct({
    productIdentifier: productId,
    productType: PURCHASE_TYPE.INAPP,
    appAccountToken: accountId,
    autoAcknowledgePurchases: false,
  });
  return verifyTransaction(transaction);
}

export async function restoreStorePurchases(): Promise<void> {
  if (!isNativeApp) return;
  await NativePurchases.restorePurchases();
}
