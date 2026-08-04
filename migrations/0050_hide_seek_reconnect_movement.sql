INSERT OR REPLACE INTO app_updates (version, title, summary, published_at)
VALUES (
  '2026.08.04.2',
  '술래잡기 연결 및 이동 안정화',
  '• 앱을 백그라운드로 보낸 뒤 돌아와도 기존 참가자로 술래잡기 방에 다시 연결됩니다.' || char(10) ||
  '• 벽을 따라 대각선으로 이동할 때 서버와 화면 예측이 같은 축 이동을 사용해 끊김을 줄였습니다.',
  1785835217000
);
