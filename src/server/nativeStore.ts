import type { AccountProfile } from '../shared/types';
import { CASH_PRODUCT_BY_ID, CASH_STORE_PRODUCTS } from '../shared/storeProducts';

export interface NativeStoreEnv {
  STORE_VERIFICATION_ENABLED?: string;
}

interface PurchaseEvidence {
  platform?: string;
  productId?: string;
  transactionId?: string;
  purchaseToken?: string;
  receipt?: string;
  jwsRepresentation?: string;
  purchaseDate?: string;
}

function base64Url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/g, '');
}

async function evidenceHash(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return base64Url(new Uint8Array(digest));
}

export async function routeNativeStore(
  request: Request,
  db: D1Database,
  profile: AccountProfile | null,
  env: NativeStoreEnv,
): Promise<Response | null> {
  const url = new URL(request.url);
  if (!url.pathname.startsWith('/api/store/')) return null;

  const enabled = env.STORE_VERIFICATION_ENABLED === 'true';
  if (url.pathname === '/api/store/config' && request.method === 'GET') {
    return Response.json({
      purchasesEnabled: enabled,
      products: CASH_STORE_PRODUCTS.map(({ id, cash }) => ({ id, cash })),
    });
  }
  if (url.pathname !== '/api/store/purchases/verify' || request.method !== 'POST') {
    return Response.json({ error: '지원하지 않는 스토어 요청입니다.' }, { status: 404 });
  }
  if (!profile) return Response.json({ error: '로그인이 필요합니다.' }, { status: 401 });
  if (!enabled) {
    return Response.json(
      { error: 'Google Play/App Store 서버 검증 설정이 아직 완료되지 않았습니다.' },
      { status: 503 },
    );
  }

  let body: PurchaseEvidence;
  try { body = await request.json(); } catch {
    return Response.json({ error: '구매 영수증을 확인해주세요.' }, { status: 400 });
  }
  const platform = body.platform === 'android' ? 'android' : body.platform === 'ios' ? 'ios' : '';
  const productId = body.productId?.trim() ?? '';
  const cashProduct = CASH_PRODUCT_BY_ID.get(productId);
  const transactionId = body.transactionId?.trim() ?? '';
  const evidence = body.purchaseToken || body.jwsRepresentation || body.receipt || '';
  if (!platform || !cashProduct || !transactionId || !evidence) {
    return Response.json({ error: '구매 검증 정보가 올바르지 않습니다.' }, { status: 400 });
  }

  const now = Date.now();
  const id = crypto.randomUUID();
  try {
    await db.prepare(`INSERT INTO store_purchase_receipts
      (id, account_id, platform, product_id, transaction_id, evidence_hash, status, created_at, granted_cash)
      VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?)`)
      .bind(id, profile.id, platform, productId, transactionId, await evidenceHash(evidence), now, cashProduct.cash)
      .run();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/UNIQUE constraint failed/i.test(message)) {
      const existing = await db.prepare(`SELECT status FROM store_purchase_receipts
        WHERE platform = ? AND transaction_id = ? AND account_id = ?`)
        .bind(platform, transactionId, profile.id)
        .first<{ status: 'pending' | 'verified' | 'rejected' }>();
      if (existing) return Response.json({ status: existing.status, transactionId });
      return Response.json({ error: '이미 다른 계정에서 처리된 구매입니다.' }, { status: 409 });
    }
    throw error;
  }

  // 이 엔드포인트는 영수증을 중복 없이 접수만 한다. 실제 상품 지급은
  // Google Play Developer API/App Store Server API 검증 작업이 status를
  // verified로 바꾼 뒤 별도 트랜잭션에서 수행해야 한다.
  return Response.json({ status: 'pending', transactionId }, { status: 202 });
}
