CREATE TABLE IF NOT EXISTS account_prestige_wallets (
  account_id TEXT PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  ghost_orbs INTEGER NOT NULL DEFAULT 0 CHECK (ghost_orbs >= 0),
  pity_draw_count INTEGER NOT NULL DEFAULT 0 CHECK (pity_draw_count >= 0),
  total_draw_count INTEGER NOT NULL DEFAULT 0 CHECK (total_draw_count >= 0),
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS account_prestige_packages (
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  package_id TEXT NOT NULL,
  acquired_at INTEGER NOT NULL,
  PRIMARY KEY (account_id, package_id)
);

CREATE TABLE IF NOT EXISTS account_prestige_loadouts (
  account_id TEXT PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  profile_image_id TEXT,
  profile_frame_id TEXT,
  emote_ids TEXT NOT NULL DEFAULT '[]',
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_account_prestige_packages_account
  ON account_prestige_packages(account_id, acquired_at DESC);

INSERT OR REPLACE INTO app_updates (version, title, summary, published_at)
VALUES (
  '2026.08.05.1',
  '월령 환영 여우 프레스티지 기반',
  '• 월령 환영 여우·여우불 타일·월령 천호포와 프로필 이미지·테두리·이모티콘 세트를 추가했습니다.' || char(10) ||
  '• 일반 여우가 다섯 귀신과 맞서 월령 환영 여우로 각성하는 25.6초 전용 시네마틱과 화면 터치 건너뛰기를 추가했습니다.' || char(10) ||
  '• 소환함이 매번 자동 재생되도록 캔버스 타임라인으로 바꾸고, 실제 상품 이미지가 있는 세로형 결과 카드와 즉시 재소환을 추가했습니다.' || char(10) ||
  '• 구슬 뽑기와 교환 화면을 분리하고, 스토어 연결 전 무료 보상 지급을 적용했습니다.' || char(10) ||
  '• 월령 환영 여우 장착 복원, 전용 이동·앉기·하품 모션, 홈·대기열·인게임 프로필 카드 테두리를 적용했습니다.' || char(10) ||
  '• 프리미엄 스킨은 귀신구슬 보상에서 제외하고, 중복 상품은 상점 판매가와 같은 포인트로 전환되도록 규칙을 통일했습니다.' || char(10) ||
  '• 친구랑하기 전역 둔화와 시각 피드백, 한 판 1회 이중 영혼 방어막, 최근 6칸 여우불 흔적을 성능 상한과 함께 적용했습니다.',
  1785909600000
);
