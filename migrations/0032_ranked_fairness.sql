ALTER TABLE ranked_results ADD COLUMN rating_delta INTEGER NOT NULL DEFAULT 0;
ALTER TABLE ranked_results ADD COLUMN contribution_score REAL NOT NULL DEFAULT 0;
ALTER TABLE ranked_results ADD COLUMN contribution_rank INTEGER NOT NULL DEFAULT 0;
ALTER TABLE ranked_results ADD COLUMN participation_ratio REAL NOT NULL DEFAULT 0;
ALTER TABLE ranked_results ADD COLUMN died INTEGER NOT NULL DEFAULT 0;
ALTER TABLE ranked_results ADD COLUMN abandoned INTEGER NOT NULL DEFAULT 0;
ALTER TABLE ranked_results ADD COLUMN ghost_level INTEGER NOT NULL DEFAULT 1;

INSERT INTO app_updates (version, title, summary, published_at)
VALUES (
  '2026.07.31.2',
  '랭크전 공정 능력치와 기여도 RP 적용',
  '• 랭크전에서는 캐릭터 고유 능력만 적용하고 스킨 추가 능력은 제외합니다.' || char(10) ||
  '• 공격·방어·제어·투자·생존 시간을 함께 계산하는 개인 기여도를 도입했습니다.' || char(10) ||
  '• 사망과 중도 이탈은 기여도에 따라 RP가 감소하며, 후반 고기여 사망은 소량의 RP를 받을 수 있습니다.' || char(10) ||
  '• 랭크 선택, 대기열, 외형 상점에서 적용 규칙을 미리 확인할 수 있습니다.',
  1785481200000
);
