PRAGMA foreign_keys = ON;

UPDATE cosmetic_catalog
SET description = CASE id
  WHEN 'tile-wave-surfer' THEN '방 바닥을 시원한 물결 타일로 바꿉니다.'
  WHEN 'tile-beach-lifeguard' THEN '방 바닥을 포근한 해변 타일로 바꿉니다.'
  WHEN 'tile-cyberpunk-neon' THEN '방 바닥을 보랏빛 회로 타일로 바꿉니다.'
  WHEN 'turret-basic-surfer-water' THEN '물총 외형과 물보라 발사 효과를 적용합니다.'
  WHEN 'turret-basic-lifeguard-parasol' THEN '접힌 파라솔부터 구조대 지휘소까지 성장합니다.'
  WHEN 'turret-basic-cyberpunk-laser' THEN '권총부터 거대 레이저포까지 성장합니다.'
  ELSE description
END,
updated_at = 1785387600000
WHERE id IN (
  'tile-wave-surfer',
  'tile-beach-lifeguard',
  'tile-cyberpunk-neon',
  'turret-basic-surfer-water',
  'turret-basic-lifeguard-parasol',
  'turret-basic-cyberpunk-laser'
);

INSERT INTO app_updates (version, title, summary, published_at)
VALUES (
  '2026.07.29.8',
  '외형 상점 문구 정리',
  '• 포탑 스킨 목록 설명에서 레벨 수 표기를 제거했습니다.' || char(10) ||
  '• 타일 스킨 설명을 카드 안에서 잘리지 않도록 짧게 정리했습니다.',
  1785387600000
);
