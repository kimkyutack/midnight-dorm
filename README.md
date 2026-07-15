# 심야 기숙사: 협동 방어

모바일 가로 화면에서 2~4명이 함께 플레이하는 서버 권위형 실시간 협동 디펜스 게임입니다. 외부 이미지·폰트·음원 없이 Phaser Graphics, Canvas 방식의 생성 아이콘, Web Audio 합성음으로 구성했습니다.

## 실행

Node.js 22.14 이상과 npm이 필요합니다.

```bash
npm install
npm run dev
```

로컬 브라우저에서는 `http://localhost:5173/?dev=1`로 접속합니다. 실제 모바일 기기는 터미널에 표시되는 같은 Wi-Fi의 Network URL로 접속합니다. 일반 URL은 데스크톱을 차단하며 `?dev=1`만 개발용 데스크톱 실행을 허용합니다.

## 게임 흐름

1. 계정을 만들거나 로그인합니다. 개인/멀티 등급, XP와 스테이지 진행도는 D1에 저장됩니다.
2. 플레이 모드와 해금된 스테이지를 고르고 새 방을 만들면 8자리 초대 코드가 발급됩니다.
3. 다른 기기에서 같은 URL을 열고 초대 코드로 참가합니다.
4. 참가자가 준비하면 방장이 20초 준비 시간을 시작합니다.
5. 조이스틱으로 빈 방의 침대에 접근해 `점유 / 행동`을 누릅니다.
6. 방의 빛나는 타일을 눌러 발전기, 포탑, 수리봇, 코일, 함정, 보호막을 건설합니다.
7. 모든 생존자가 재대결에 동의하면 같은 팀으로 다시 시작합니다.

방장이 나가도 Durable Object의 게임은 유지됩니다. 새로고침 또는 연결 해제 뒤 30초 안에 같은 브라우저로 접속하면 저장된 재접속 토큰으로 기존 캐릭터를 복구합니다.

## 명령

```bash
npm run typecheck   # TypeScript strict 검사
npm run test        # 단위 및 12분 가속 시뮬레이션
npm run test:e2e    # 독립 모바일 브라우저 2개의 멀티플레이 E2E
npm run db:migrate:local   # 로컬 D1 스키마 적용
npm run db:migrate:remote  # 운영 D1 스키마 적용
npm run build       # Worker와 정적 클라이언트 프로덕션 빌드
npm run preview     # 프로덕션 빌드 로컬 미리보기
npm run deploy      # Cloudflare Workers 실제 배포
```

최초 E2E 환경에서 Chromium이 없다면 한 번만 `npx playwright install chromium`을 실행합니다.

## 아키텍처

- `src/shared`: 클라이언트·서버 공용 타입, 메시지 검증, 밸런스, seeded PRNG, BFS 검증 맵, A* 경로 탐색
- `src/shared/progression.ts`: 6개 등급, 185개 스테이지, 난이도 곡선과 개인 등급 혜택
- `src/server/engine.ts`: 20Hz 서버 권위 게임 상태, 경제, 건설, 업그레이드, 전투, 승패, 재접속
- `src/server/GameRoom.ts`: 방 하나당 SQLite 기반 Durable Object 하나, WebSocket, 10Hz 스냅샷, 저장·자동 정리
- `src/server/auth.ts`: D1 계정/세션, PBKDF2 비밀번호, 로그인 잠금, 판정 결과·XP 저장
- `src/server/bots.ts`: 서버 생존자 봇의 방 점유와 방어 설비 판단
- `src/client`: 모바일 DOM UI, Phaser 렌더링, 보간·로컬 이동 예측, 재접속, Web Audio
- `tests`: 판정 단위 테스트와 12분 가속 서버 시뮬레이션
- `e2e`: 두 독립 브라우저의 생성·참가·이동·건설·전투·재접속·결과 검증

클라이언트는 이동, 건설, 업그레이드 의도만 전송합니다. 비용, 자원, 소유권, 타일 점유, 피해, 수리, 생산, 승패는 Durable Object 안의 엔진만 판정합니다. 진행 상태는 메모리에서 처리하고 매초 SQLite-backed Durable Object storage에 스냅샷을 기록합니다.

## 계정, 등급과 스테이지

- 개인 등급과 멀티플레이 등급은 `하수 → 중수 → 고수 → 초고수 → 베테랑 → 레전드`로 별도 계산합니다. 게임 안에는 둘 중 높은 등급을 표시합니다.
- 스테이지는 `쉬움 1`, `노말 1~5`, `악몽 1~10`, `지옥 1~10`, `불지옥 1~15`, `에픽 1~20`, `신화 1~25`, `레전더리 1~99` 순서의 총 185개입니다.
- 승리하면 다음 스테이지가 해금되며 선택한 모드의 XP가 오릅니다. 패배해도 적은 도전 XP를 받습니다.
- 스테이지가 오를수록 귀신의 초기 HP·공격력·속도, 레벨업 성장률이 증가합니다. 이후 포탑 3초 봉인, 골드 5초 봉인, 문 수리 5초 봉인, 문 최대 HP 비례 피해가 차례로 추가됩니다.
- 개인 등급은 시작 자원과 이동속도, 문·포탑 최대 레벨을 높입니다. 베테랑부터 희귀 천둥포를 설치할 수 있습니다.
- 초고수 이상 플레이어가 입장하면 서버가 등급을 검증해 전체 플레이어에게 입장 문구와 전용 효과를 전송합니다.

## PWA와 저장

Service Worker는 앱 셸만 캐시하며 실시간 게임은 네트워크 연결이 필요합니다. manifest, SVG 파비콘, 192/512 PNG 홈 화면 아이콘은 `scripts/generate-icons.mjs`가 프로젝트 내부에서 생성합니다.

localStorage에는 임의 UUID, 음량·진동, 로컬 기록, 최근 코드, 재접속 토큰만 저장합니다. 계정, 비밀번호 해시, 세션, 등급, XP, 스테이지와 매치 결과는 D1에 저장합니다. 실제 기기 식별자는 수집하지 않습니다.

## Cloudflare 배포

SQLite Durable Object 마이그레이션, D1 binding과 정적 asset binding은 `wrangler.jsonc`에 포함돼 있습니다. `midnight-dorm-accounts` D1 데이터베이스와 실제 UUID도 현재 Cloudflare 계정 기준으로 연결돼 있습니다.

```bash
npx wrangler login
npm run db:migrate:remote
npm run deploy
```

Cloudflare 인증이 이미 유효하면 두 번째 명령만 실행하면 됩니다. 프론트엔드와 `/api/rooms/*` WebSocket은 동일 Worker 도메인에서 제공됩니다.

## 현재 제한사항

- 오프라인 캐시는 로딩 셸만 제공하며, 실시간 매치는 연결 없이는 진행되지 않습니다.
- 현재 계정은 아이디/비밀번호 방식입니다. 이메일 인증·비밀번호 찾기는 이메일 발송 서비스 연결 전까지 제공하지 않습니다.
- Phaser 전체 런타임을 포함하므로 초기 JS gzip 크기는 약 332KB입니다.
- 개발 머신의 Node 22.14에서 빌드·E2E까지 검증한 Cloudflare Vite 조합을 고정했습니다. Cloudflare 플러그인을 최신판으로 올릴 때는 Node도 함께 갱신해야 합니다.
