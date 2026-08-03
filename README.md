# 심야 병동: 협동 디펜스

모바일 가로 화면에서 2~4명이 함께 플레이하는 서버 권위형 실시간 협동 디펜스 게임입니다. 프로젝트 전용 시네마틱 이미지와 실사형 귀신, Three.js 기반 3D 전장, Web Audio 합성음으로 구성했습니다.

## 실행

Node.js 22.14 이상과 npm이 필요합니다.

```bash
npm install
npm run dev
```

로컬 브라우저에서는 `http://localhost:5173/?dev=1`로 접속합니다. 실제 모바일 기기는 터미널에 표시되는 같은 Wi-Fi의 Network URL로 접속합니다. 일반 URL은 데스크톱을 차단하며 `?dev=1`만 개발용 데스크톱 실행을 허용합니다.

세로 모바일 UI의 기준 논리 폭은 390px입니다. Android 브라우저가 데스크톱 사이트 호환 모드에서 980px 가상 viewport를 사용해도 터치 세로 화면은 자동으로 같은 390px 레이아웃으로 보정합니다.

기본 `npm run dev`도 Cloudflare의 원격 `midnight-dorm-accounts` D1을 사용하므로 Studio에서 계정 변화를 바로 확인할 수 있습니다. `npm run test:e2e`만 `CLOUDFLARE_ENV=e2e` 환경을 선택해 `.wrangler/state`의 로컬 D1을 사용하며 운영 계정 테이블을 오염시키지 않습니다.

## 게임 흐름

1. 최초 실행 시 복도 추격 티저를 본 뒤 계정을 만들거나 로그인합니다. 네이티브 Google 신규 가입은 닉네임 중복 검사를 거쳐 계정을 만들고, 홈 대신 서버 권위형 8단계 첫 생존 훈련으로 바로 진입합니다. 훈련 완료 전에는 앱을 다시 실행해도 같은 훈련을 이어서 시작합니다.
2. 게임 홈의 등급과 배지는 현재 선택한 `혼자하기 / 친구랑하기 / 랭크전`에 맞춰 표시됩니다.
3. 혼자하기 또는 친구랑하기와 해금된 스테이지를 고릅니다. 친구랑하기에서 새 방을 만들면 8자리 초대 코드가 발급됩니다.
4. 친구랑하기 참가자는 다른 기기에서 같은 URL을 열고 초대 코드로 입장합니다. 홈의 친구 아이콘에서는 친구 코드 추가, 1:1 채팅, 방 초대를 사용할 수 있습니다.
5. 모든 모드는 귀신 경고 포스터를 먼저 표시합니다. 혼자하기·친구랑하기는 이어서 밝은 맵에서 30초 준비 시간을 시작하며 귀신은 정지합니다. 랭크전은 암전 탐색 시간이 시작되고, 생존자·봇은 각자 주변 2타일만 비추며 방을 찾는 동안 귀신이 복도를 순찰합니다.
6. 랭크전은 48시간 계약별 대기열로 입장합니다. 비슷한 RP의 실제 플레이어 4명이 모이면 자동 시작하며, 40초 후에만 빈 자리만 봇으로 보충합니다.
7. 조이스틱으로 빈 방의 침대 가까이 이동해 표시되는 `잠자기`를 누릅니다.
8. 방의 `+` 타일을 눌러 골드·전력·보급 탭에서 수호 포탑, 서리 스프레이, 발전기와 방어 설비를 설치합니다. 설치 비용은 설비별로 골드 또는 전력 한 종류를 사용하며, 침대·문·발전기의 고레벨 강화에는 골드 비용의 10% 전력이 추가됩니다.
9. 모든 생존자가 재대결에 동의하면 같은 팀으로 다시 시작합니다.

방장이 나가도 Durable Object의 게임은 유지됩니다. 새로고침 또는 연결 해제 뒤 30초 안에 같은 브라우저로 접속하면 저장된 재접속 토큰으로 기존 캐릭터를 복구합니다.

## 명령

```bash
npm run typecheck   # TypeScript strict 검사
npm run test        # 단위 및 12분 가속 시뮬레이션
npm run test:e2e    # 독립 모바일 브라우저 2개의 멀티플레이 E2E
npm run db:migrate:local   # 로컬 D1 스키마 적용
npm run db:migrate:remote  # 운영 D1 스키마 적용
npm run build       # Worker와 정적 클라이언트 프로덕션 빌드
npm run build:native # 웹 번들 빌드 후 Android/iOS 프로젝트 동기화
npm run preview     # 프로덕션 빌드 로컬 미리보기
npm run deploy      # Cloudflare Workers 실제 배포
```

최초 E2E 환경에서 Chromium이 없다면 한 번만 `npx playwright install chromium`을 실행합니다.

## 아키텍처

- `src/shared`: 클라이언트·서버 공용 타입, 메시지 검증, 밸런스, seeded PRNG, BFS 검증 맵, A\* 경로 탐색
- `src/shared/progression.ts`: 9개 일반 진행 등급, 345개 스테이지, 난이도 곡선과 혼자하기 등급 혜택
- `src/server/engine.ts`: 20Hz 서버 권위 게임 상태, 경제, 건설, 업그레이드, 전투, 승패, 재접속
- `src/server/GameRoom.ts`: 방 하나당 SQLite 기반 Durable Object 하나, WebSocket, 10Hz 스냅샷, 저장·자동 정리
- `src/server/auth.ts`: D1 계정/세션, PBKDF2 비밀번호, 로그인 잠금, 판정 결과·XP 저장
- `src/client/native`: Capacitor API 주소, Secure Storage 세션, Google 로그인, AdMob, 인앱결제 브리지
- `src/server/bots.ts`: 서버 생존자 봇의 방 점유와 방어 설비 판단
- `src/client`: 모바일 DOM UI, Three.js 3D 렌더링, 보간·로컬 이동 예측, 재접속, Web Audio
- `tests`: 판정 단위 테스트와 12분 가속 서버 시뮬레이션
- `e2e`: 두 독립 브라우저의 생성·참가·이동·건설·전투·재접속·결과 검증

클라이언트는 이동, 건설, 업그레이드 의도만 전송합니다. 비용, 자원, 소유권, 타일 점유, 피해, 수리, 생산, 승패는 Durable Object 안의 엔진만 판정합니다. 진행 상태는 메모리에서 처리하고 매초 SQLite-backed Durable Object storage에 스냅샷을 기록합니다.

## 계정, 등급과 스테이지

현재 전투 수치와 계산식은 [`docs/spec/balance.md`](docs/spec/balance.md), 차기 전략 난이도와 타임어택은 [`docs/spec/difficulty-modifiers.md`](docs/spec/difficulty-modifiers.md), 플레이 방식과 14일 시즌 랭크전은 [`docs/spec/ranked-mode.md`](docs/spec/ranked-mode.md), 귀신 술래잡기 미니게임은 [`docs/spec/hide-and-seek-mode.md`](docs/spec/hide-and-seek-mode.md), 화면 스타일과 모바일 UX는 [`docs/spec/visual-design.md`](docs/spec/visual-design.md), 다음 업데이트와 사용자 유지 개선안은 [`docs/spec/next-update-roadmap.md`](docs/spec/next-update-roadmap.md)를 기준으로 관리합니다.

- 혼자하기 등급과 친구랑하기 등급은 `하수 → 중수 → 고수 → 초고수 → 베테랑 → 레전드 → 초월 → 불멸 → 절대자`로 별도 계산합니다. 초월은 20,000 XP, 불멸은 50,000 XP, 절대자는 100,000 XP부터 적용합니다.
- 랭크전은 일반 진행 등급과 분리된 14일 시즌 경쟁입니다. 48시간 계약 7개 중 최고 5개 점수를 합산하며, 계약별 대기열은 RP 범위를 점차 넓혀 4명의 실제 참가자를 우선 매칭하고 40초 뒤에만 빈 자리를 봇으로 보충합니다. 시즌 종료 후 순위 보상을 지급한 뒤 현재 시즌 순위표를 초기화합니다.
- 스테이지는 `쉬움 1`, `노말 1~5`, `어려움 1~5`, `악몽 1~10`, `지옥 1~10`, `불지옥 1~15`, `에픽 1~20`, `신화 1~25`, `레전더리 1~30`, `재앙 1~35`, `대재앙 1~40`, `파멸 1~50`, `종말 1~99` 순서의 총 345개입니다. 난이도 선택 모달은 가장 높은 해금 스테이지부터 내림차순으로 표시합니다.
- 승리하면 다음 스테이지가 해금되며 선택한 모드의 XP가 오릅니다. 패배해도 적은 도전 XP를 받습니다.
- 홈의 이벤트 센터에는 한국 시간 기준으로 초기화되는 일일·주간 미션이 있습니다. 일일 접속·스테이지·랭크전과 주간 5일 접속·스테이지·랭크전 미션을 제공하며, 완료 보상은 하나씩 또는 일괄 수령할 수 있습니다.
- 모든 미션을 완료하면 주당 최대 2,890P를 획득할 수 있으며, 외형·타일·포탑 스킨과 반복 구매형 전술 보급 가격은 새 수급량에 맞춰 조정했습니다.
- 스테이지가 오를수록 귀신의 기본 수치와 스킬이 강화됩니다. 차기 고난도에는 제어 적응, 소모형 방어막, 방향성 보호막과 악몽 이상에서만 등장하는 타임어택을 조합합니다.
- 실제 매치에는 `오염 도배귀`가 등장할 수 있습니다. 문 타격으로 마나를 채운 뒤 3초 동안 보랏빛 도배를 준비하고, 방 안의 인접한 건설 타일 3칸을 일시 오염시켜 해당 설비의 생산·수리·공격을 정지시킵니다.
- 혼자하기 등급은 시작 자원과 이동속도, 수호 포탑 최대 레벨을 높입니다. 침대는 등급과 무관하게 10레벨, 문은 15레벨까지 올릴 수 있습니다.
- 전장은 2행×4열의 8개 방과 8개 귀신 리스폰 패드로 구성됩니다. HP가 낮아진 귀신은 현재 위치에서 가장 가까운 패드로 후퇴합니다.
- 초고수 이상 플레이어가 입장하면 서버가 등급을 검증해 전체 플레이어에게 입장 문구와 전용 효과를 전송합니다.
- 황금 심판 포탑 보유 여부는 랭크전 참가 조건이 아닙니다. 일반 모드에는 베테랑과 고난도 도전 과제를 통한 확정 해금 경로를 두고, 랭크전은 계약마다 모든 참가자에게 동일하게 금지·대여·현장 해금합니다.

## PWA와 저장

Service Worker는 앱 셸과 정적 이미지·스프라이트를 버전별로 캐시하며 실시간 게임은 네트워크 연결이 필요합니다. 정적 자산은 cache-first로 읽어 캐시 적중 때 같은 파일을 다시 요청하지 않습니다. 탭 파비콘과 192/512 PNG 홈 화면 아이콘은 `public/icons/icon-scene-source.png`에서 만든 검증된 래스터 자산을 사용하며, `scripts/generate-icons.mjs`는 빌드 전에 해당 자산이 존재하는지만 확인합니다. 배포 내역은 D1의 `app_updates`에 저장하고, 앱은 캐시하지 않는 `/api/app-updates/latest` 응답과 번들 버전을 비교합니다. 새 버전이 있으면 확인 후 Service Worker와 Cache Storage를 비우고 매번 다른 일회용 URL로 최신 앱 셸을 미리 받은 뒤 재진입합니다. Service Worker 스크립트는 버전 쿼리와 `updateViaCache: none`으로 등록해 iOS 홈 화면 PWA의 오래된 HTTP 캐시도 우회합니다. 홈 프로필 아래의 `↻` 강력 새로고침도 같은 절차를 수행하며, 최근 공지는 확성기 `업데이트 내역` 버튼에서 확인합니다.

localStorage에는 임의 UUID, 음량·진동, 로컬 기록, 최근 코드, 재접속 토큰만 저장합니다. 계정, 비밀번호 해시, 세션, 등급, XP, 스테이지와 매치 결과는 D1에 저장합니다. 실제 기기 식별자는 수집하지 않습니다.

## Android/iOS 앱

Capacitor 네이티브 앱은 웹 번들을 앱 안에 포함하고 기존 Cloudflare Worker,
Durable Objects, D1을 원격 서버로 사용합니다. 네이티브 세션은
Keychain/Keystore에 저장하며 Google 로그인, AdMob 보상형 광고, Play/App Store
인앱결제 확장 지점을 분리했습니다. 플랫폼별 OAuth·광고·스토어 설정과 출시
체크리스트는 [`docs/native-app.md`](docs/native-app.md)를 기준으로 관리합니다.

## Cloudflare 배포

SQLite Durable Object 마이그레이션, D1 binding과 정적 asset binding은 `wrangler.jsonc`에 포함돼 있습니다. `midnight-dorm-accounts` D1 데이터베이스와 실제 UUID도 현재 Cloudflare 계정 기준으로 연결돼 있습니다.

```bash
npx wrangler login
npm run db:migrate:remote
npm run deploy
```

Cloudflare 인증이 이미 유효하면 두 번째 명령만 실행하면 됩니다. 프론트엔드와 `/api/rooms/*` WebSocket은 동일 Worker 도메인에서 제공됩니다.

새 배포를 등록할 때는 `src/shared/appUpdates.ts`의 `APP_RELEASE_VERSION`을 올리고, 같은 버전·제목·요약을 넣은 D1 마이그레이션을 추가한 뒤 `npm run db:migrate:remote`를 배포 전에 실행합니다.

출시 이벤트의 `다시 보지 않기` 설정은 브라우저가 아니라 D1 계정 데이터에 저장되므로, 다른 계정으로 로그인해도 각 계정의 이벤트 표시 상태가 독립적으로 유지됩니다.

이벤트 팝업은 D1 `promotion_campaigns`의 `is_visible`(0/1)과 `sort_order`로 노출·순서를 운영합니다. 외형 테마는 `cosmetic_theme_settings.is_store_visible`로 상점 노출을 한 번에 전환하며, `cosmetic_theme_items`에서 여름·사이버펑크·특수수사본부 테마의 구성 상품을 확인할 수 있습니다. 테마를 숨겨도 기존 보유자의 보관함·인게임 장착은 유지됩니다.

Cloudflare 대시보드에서 Git 리포지토리 빌드를 사용할 때는 각 명령을 `&&`로 연결하거나 별도 필드에 정확히 나눠 입력해야 합니다. `npm install npm run build npm run db:migrate:remote`처럼 공백만으로 이어 쓰면 `npm install`의 패키지 인자로 해석되어 `npm run build`와 D1 마이그레이션이 실행되지 않습니다.

권장 빌드 구성:

```bash
빌드 명령: npm install && npm run build && npm run db:migrate:remote
배포 명령: npm run deploy
버전 명령: npx wrangler versions upload
루트 디렉터리: /
```

배포 후 가입이 실패하면 먼저 빌드 캐시를 지우고 다시 배포한 뒤, `npm run db:migrate:remote`가 성공했는지와 Worker 로그의 `Account registration failed` 메시지를 확인합니다.

## 현재 제한사항

- 오프라인 캐시는 로딩 셸만 제공하며, 실시간 매치는 연결 없이는 진행되지 않습니다.
- 웹은 아이디/비밀번호 로그인을 유지하고, 네이티브 앱은 Google 로그인을 함께 지원합니다. 이메일 인증·비밀번호 찾기는 이메일 발송 서비스 연결 전까지 제공하지 않습니다.
- 인앱결제 서버 검증은 기본 비활성 상태입니다. Google Play/App Store 검증과 환불 알림 처리가 완료되기 전에는 실제 상품을 지급하지 않습니다.
- Three.js 3D 런타임이 포함되므로 클라이언트 번들은 추후 화면 단위 코드 분할 최적화가 필요합니다.
- 개발 머신의 Node 22.14에서 빌드·E2E까지 검증한 Cloudflare Vite 조합을 고정했습니다. Cloudflare 플러그인을 최신판으로 올릴 때는 Node도 함께 갱신해야 합니다.
