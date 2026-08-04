PRAGMA foreign_keys = ON;

INSERT INTO promotion_campaigns (id, is_visible, sort_order, updated_at)
VALUES ('hide-seek-release', 1, 0, 1785833725000)
ON CONFLICT(id) DO NOTHING;

INSERT OR REPLACE INTO app_updates (version, title, summary, published_at)
VALUES (
  '2026.08.04.1',
  '심야 술래잡기 정식 출시',
  '• 귀신 전용 격리 대기실을 추가해 숨기 시간에도 방 안에서 이동할 수 있고, 추격 시작과 함께 잠긴 문이 열립니다.' || char(10) ||
  '• 은신·수색 버튼을 구조물 위에 표시하고, 은신 중에는 구조물 앞 한 칸만 볼 수 있도록 긴장감을 높였습니다.' || char(10) ||
  '• 사망 관전, 역할별 승리 포인트, 출시 이벤트 팝업과 술래잡기 진입 안내를 추가했습니다.',
  1785833725000
);
