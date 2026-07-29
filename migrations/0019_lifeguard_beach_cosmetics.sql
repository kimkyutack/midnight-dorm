INSERT INTO cosmetic_catalog (
  id, slot, character_id, turret_kind, label, description, symbol, swatch,
  unlock_kind, point_price, unlock_rank, trait_multiplier, asset_directory,
  gameplay_json, display_order, is_active, is_limited, sale_starts_at,
  sale_ends_at, payment_product_id, created_at, updated_at
) VALUES
  (
    'tile-beach-lifeguard',
    'tile',
    NULL,
    NULL,
    '모래사장 타일',
    '침대를 점유하면 모래 소용돌이가 퍼지며 포근한 해변 타일로 바뀝니다.',
    '모',
    '#e8c783',
    'points',
    1000,
    NULL,
    1,
    'skin-beach-sand/sand-tile.webp',
    '{"transition":"sand-vortex-center-out"}',
    30,
    1,
    1,
    NULL,
    NULL,
    NULL,
    1785294000000,
    1785294000000
  ),
  (
    'turret-basic-lifeguard-parasol',
    'turret',
    NULL,
    'basic-turret',
    '파라솔 포탑',
    '접힌 파라솔부터 해변 구조대 지휘소까지 15단계 외형을 적용합니다.',
    '솔',
    '#ef5548',
    'points',
    1500,
    NULL,
    1,
    'skin-lifeguard-parasol',
    '{"levels":15,"firingPoint":"parasol-apex","projectileEffect":"default"}',
    20,
    1,
    1,
    NULL,
    NULL,
    NULL,
    1785294000000,
    1785294000000
  );

INSERT INTO app_updates (version, title, summary, published_at)
VALUES (
  '2026.07.29.1',
  '해변 구조대 라온 테마',
  '• 침대 점유 시 모래 소용돌이가 퍼지는 모래사장 타일을 추가했습니다.' || char(10) ||
  '• Lv.1의 접힌 파라솔부터 Lv.15 구조대 지휘소까지 실루엣이 성장하는 파라솔 포탑을 추가했습니다.' || char(10) ||
  '• 공격받는 팀원의 HUD 프로필이 즉시 붉게 표시되도록 판정을 보강했습니다.',
  1785294000000
);
