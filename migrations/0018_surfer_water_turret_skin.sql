INSERT INTO cosmetic_catalog (
  id, slot, character_id, turret_kind, label, description, symbol, swatch,
  unlock_kind, point_price, unlock_rank, trait_multiplier, asset_directory,
  gameplay_json, display_order, is_active, is_limited, sale_starts_at,
  sale_ends_at, payment_product_id, created_at, updated_at
) VALUES (
  'turret-basic-surfer-water',
  'turret',
  NULL,
  'basic-turret',
  '서퍼 물총포',
  '작은 돌고래 물총부터 대왕 물총까지 15단계로 성장하며 물보라를 발사합니다.',
  '물',
  '#ffc84f',
  'points',
  1500,
  NULL,
  1,
  'skin-surfer-water-blaster',
  '{"projectileEffect":"water-splash","levels":15}',
  10,
  1,
  0,
  NULL,
  NULL,
  NULL,
  1785234000000,
  1785234000000
);

INSERT INTO app_updates (version, title, summary, published_at)
VALUES (
  '2026.07.28.6',
  '서퍼 몽 테마: 서퍼 물총포',
  '• 상점과 내 보관함에 포탑 스킨 탭을 추가했습니다.' || char(10) ||
  '• 서퍼 물총포는 Lv.1 돌고래 물총부터 Lv.15 대왕 물총까지 단계마다 다른 외형을 사용합니다.' || char(10) ||
  '• 서퍼 물총포의 탄환을 물줄기와 물보라 효과로 변경했습니다. 가격은 1,500P입니다.',
  1785234000000
);
