PRAGMA foreign_keys = ON;

INSERT INTO cosmetic_catalog (
  id, slot, character_id, turret_kind, label, description, symbol, swatch,
  unlock_kind, point_price, unlock_rank, trait_multiplier, asset_directory,
  gameplay_json, display_order, is_active, is_limited, sale_starts_at,
  sale_ends_at, payment_product_id, created_at, updated_at
) VALUES
  (
    'skin-look-crocodile-police-enforcer',
    'skin',
    'character-crocodile',
    NULL,
    '강력계 크로크',
    '압도적인 체격과 무전 장비로 현장을 장악하는 프리미엄 경찰 스킨',
    '경',
    '#315d8f',
    'points',
    5000,
    NULL,
    2,
    'skin-police-enforcer-croco',
    '{"traitOverride":{"label":"강력계 화력 지휘","description":"모든 포탑의 피해가 100% 증가하고 공격속도가 10% 증가합니다.","turretDamageMultiplier":2,"turretRateMultiplier":0.9090909090909091},"movementEffect":"ground-crack-dust"}',
    1,
    1,
    1,
    NULL,
    NULL,
    NULL,
    1785495600000,
    1785495600000
  ),
  (
    'skin-look-monkey-secret-agent',
    'skin',
    'character-monkey',
    NULL,
    '시크릿 에이전트 몽키',
    '검은 수트와 쌍수 사격 자세로 임무를 수행하는 프리미엄 비밀요원 스킨',
    '첩',
    '#98754f',
    'points',
    5000,
    NULL,
    2,
    'skin-secret-agent-monkey',
    '{"traitOverride":{"label":"기밀 행운 조작","description":"랜덤상자 뽑기를 3회 더 사용하고 신화·전설 아이템 확률이 5%p 증가합니다.","extraDraws":3,"highRarityChanceBonus":0.05},"movementEffect":"wind-afterimage"}',
    2,
    1,
    1,
    NULL,
    NULL,
    NULL,
    1785495600000,
    1785495600000
  )
ON CONFLICT(id) DO UPDATE SET
  character_id = excluded.character_id,
  label = excluded.label,
  description = excluded.description,
  symbol = excluded.symbol,
  swatch = excluded.swatch,
  unlock_kind = excluded.unlock_kind,
  point_price = excluded.point_price,
  trait_multiplier = excluded.trait_multiplier,
  asset_directory = excluded.asset_directory,
  gameplay_json = excluded.gameplay_json,
  display_order = excluded.display_order,
  is_active = excluded.is_active,
  is_limited = excluded.is_limited,
  updated_at = excluded.updated_at;

INSERT OR REPLACE INTO app_updates (version, title, summary, published_at)
VALUES (
  '2026.07.31.4',
  '특수작전 프리미엄 스킨',
  '• 강력계 크로크와 시크릿 에이전트 몽키 프리미엄 스킨을 추가했습니다.' || char(10) ||
  '• 경찰 악어의 강한 발구르기와 비밀요원 원숭이의 잔상 이동 연출을 적용했습니다.' || char(10) ||
  '• 두 스킨의 전용 특성과 특수작전 출시 팝업을 추가했습니다.',
  1785495600000
);
