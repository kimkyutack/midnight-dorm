CREATE TABLE IF NOT EXISTS account_cash_wallets (
  account_id TEXT PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  cash_balance INTEGER NOT NULL DEFAULT 0 CHECK (cash_balance >= 0),
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS account_cash_first_purchase_rewards (
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  product_id TEXT NOT NULL,
  claim_token TEXT NOT NULL,
  claimed_at INTEGER NOT NULL,
  PRIMARY KEY (account_id, product_id)
);

ALTER TABLE store_purchase_receipts ADD COLUMN granted_cash INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_account_cash_wallets_updated
  ON account_cash_wallets(updated_at DESC);

INSERT OR REPLACE INTO app_updates (version, title, summary, published_at)
VALUES (
  '2026.08.05.2',
  '캐시 지갑과 충전 상점',
  '• 홈 포인트 왼쪽에 캐시 지갑과 충전 버튼을 추가하고 작은 화면에서도 프로필이 잘리지 않도록 잔액을 축약 표시합니다.' || char(10) ||
  '• 100·550·1,200·2,500·5,200·10,400 캐시 충전 상품과 Google Play·App Store 공통 SKU를 추가했습니다. 10,400 캐시 팩의 가격은 ₩156,000입니다.' || char(10) ||
  '• 각 캐시 팩은 계정당 최초 1회에 한해 20% 추가 캐시를 지급합니다. 예를 들어 10,400 캐시 팩은 첫 구매 시 12,480 캐시를 지급합니다.' || char(10) ||
  '• 유료 콘텐츠는 개별 결제 대신 충전한 캐시를 사용하며, 캐시 부족 시 충전 상점으로 바로 이동합니다.' || char(10) ||
  '• 캐시 확인·차감·보상 지급을 서버 원장에서 함께 처리해 중복 요청이나 동시 결제로 잔액이 음수가 되지 않도록 보호했습니다.',
  1785931403000
);
