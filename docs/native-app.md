# Capacitor 네이티브 앱 운영 가이드

## 1. 구조

네이티브 앱은 `dist/client` 웹 번들을 APK/IPA 안에 포함하고, 게임 데이터와
실시간 매치는 기존 Cloudflare Worker/Durable Objects/D1을 그대로 사용한다.
운영 앱에 `server.url`을 지정해 원격 웹사이트 전체를 띄우지 않는다. 이 구조는
스토어 심사에 필요한 네이티브 셸을 유지하면서 서버 권위 게임 로직을 한곳에서
운영하고, 웹 배포가 네이티브 실행 코드를 임의로 교체하지 않도록 한다.

- 웹/PWA: 기존과 같이 동일 도메인의 `/api`와 쿠키 세션 사용
- Android/iOS: `VITE_API_BASE_URL`의 Cloudflare API + Bearer 세션 사용
- 실시간: 같은 Worker의 Durable Objects WebSocket 사용
- 민감 세션: Android Keystore/iOS Keychain 기반 Secure Storage에 저장
- 앱 업데이트: 네이티브는 스토어 업데이트, 웹/PWA만 Service Worker 업데이트 사용

## 2. 최초 설정

```bash
cp .env.native.example .env.native
```

`.env.native`에 다음 공개 설정값을 넣는다.

```dotenv
VITE_API_BASE_URL=https://실제-worker-주소.workers.dev
VITE_GOOGLE_WEB_CLIENT_ID=000000000000-xxxx.apps.googleusercontent.com
VITE_ADMOB_TEST_MODE=true
VITE_ADMOB_ANDROID_REWARDED_ID=
VITE_ADMOB_IOS_REWARDED_ID=
VITE_STORE_PRODUCT_IDS=com.midnightdorm.points.small,com.midnightdorm.points.large
```

환경 파일은 커밋하지 않는다. Google OAuth 비밀키, Play 서비스 계정 JSON,
Apple 개인키는 프론트엔드 환경 변수에 절대 넣지 않는다.

## 3. Google 로그인

클라이언트는 Capawesome Google Sign-In으로 ID 토큰만 받고
`POST /api/auth/google`에 전달한다. Worker는 Google 공개키로 서명과
`aud`, `iss`, 만료를 검증한 뒤 D1 `account_identities`에 연결한다.
기존 Google 식별자는 즉시 보안 세션을 발급한다. 처음 확인된 Google
식별자는 15분짜리 일회성 가입 토큰만 발급하며, 사용자가 2~12자 닉네임을
확정하고 서버 중복 검사를 통과한 뒤에만 계정과 세션을 생성한다. 신규 계정은
홈을 거치지 않고 첫 생존 훈련에 들어가며, 완료 플래그가 저장될 때까지 앱을
재시작해도 훈련으로 복귀한다.

로컬 웹과 PWA는 같은 웹 클라이언트 ID로 Google Identity Services 팝업
버튼을 사용한다. 로컬 `npm run dev`는 커밋되지 않는 `.env.e2e.local`의
`VITE_GOOGLE_WEB_CLIENT_ID`와 `GOOGLE_WEB_CLIENT_ID`를 각각 브라우저와
로컬 Worker에 주입한다. Google Cloud Console의 웹 OAuth 클라이언트에는
`http://localhost:5173`과 실제 웹 서비스 주소를 승인된 JavaScript 원본으로
등록해야 한다.

Cloudflare Worker에는 웹 클라이언트 ID를 설정한다.

```bash
npx wrangler secret put GOOGLE_WEB_CLIENT_ID
```

Google Cloud Console 설정:

1. Android OAuth 클라이언트에 실제 package name과 Play App Signing의
   SHA-1/SHA-256을 등록한다.
2. iOS OAuth 클라이언트에 Bundle ID를 등록한다.
3. 모든 플랫폼의 서버 토큰 audience에는 웹 애플리케이션 클라이언트 ID를 쓴다.
4. iOS 프로젝트의 `Info.plist` URL scheme에 iOS OAuth 클라이언트의 reversed
   client ID를 넣는다.

D1에는 `0034_google_signup_tutorial.sql`까지 적용되어야 한다.

```bash
npm run db:migrate:remote
```

## 4. AdMob 보상형 광고

개발 설정은 Google 공식 테스트 App ID/광고 단위를 사용한다. 출시 전 반드시:

1. `android/app/src/main/AndroidManifest.xml`의 AdMob App ID 교체
2. `ios/App/App/Info.plist`의 `GADApplicationIdentifier` 교체
3. `.env.native`의 플랫폼별 rewarded ad unit ID 입력
4. `VITE_ADMOB_TEST_MODE=false`로 출시 빌드
5. UMP 동의 화면과 iOS ATT 안내 문구/심사 설명 확정

`prepareStageClearReward()`와 `showStageClearReward()`는 스테이지 클리어
2배 보상을 실행한다. 일반 승리는 결과 화면에서 `전리품 수령`을 눌러야
기본 포인트가 지급되고, `2배 수령`은 광고가 끝난 뒤 지급된다. 광고 제거
이용자는 광고 없이 2배 수령만 표시한다. 같은 `matchId + accountId`는 D1
조건부 갱신과 트리거로 한 번만 지급된다.

현재 개발 단계에서는 광고 SDK 완료 결과를 임시 승인 신호로 사용한다.
출시 전에는 이 신호를 반드시 제거하고 AdMob Server-side verification 콜백의
서명, `user_id`, `custom_data.matchId`, 중복 transaction ID를 Worker가 검증한
경우에만 2배 지급을 허용해야 한다.

## 5. 인앱결제

스토어 상품명과 가격은 Google Play/App Store가 반환한 `Product` 값을 UI에
표시한다. 코드에 실제 통화 가격을 고정하지 않는다.

현재 `STORE_VERIFICATION_ENABLED=false`이며 실제 스토어 구매 버튼은 열리지
않는다. 홈의 광고 제거 상품은 결제 UI와 entitlement 만 검증하기 위한 임시
무료 구매다.
출시 전에 다음 검증 작업을 완성해야 한다.

- Android: Play Developer API로 package/product/purchase token 검증
- iOS: App Store Server API로 signed transaction/JWS 검증
- D1 `store_purchase_receipts`의 `(platform, transaction_id)`로 중복 지급 차단
- 검증 성공, entitlement 지급, acknowledge/finish를 하나의 재시도 가능한 서버
  워크플로로 처리
- 환불/취소 Real-time Developer Notifications와 App Store Server
  Notifications 처리

검증 구현 후에만 Worker 변수 `STORE_VERIFICATION_ENABLED=true`를 배포한다.
현재 `/api/store/purchases/verify`는 영수증을 `pending`으로 접수할 뿐 포인트나
스킨을 지급하지 않는다.

광고 제거 entitlement는 `account_entitlements`의 `ad-removal` 행으로 관리한다.
한 달 상품은 구매 시점부터 30일 만료일을 저장하며 재구매 시 남은 기간 뒤로
30일을 연장한다. 영구 상품은 `expires_at = NULL`이다. 실제 결제를 연결하면
무료 구매 API를 제거하고 검증 완료된 영수증 처리기만 이 행을 갱신해야 한다.

D1에는 `0036_match_rewards_ad_free.sql`까지 적용되어야 한다.

## 6. 빌드

최초 한 번:

```bash
npm run build
npm run native:add:android
npm run native:add:ios
```

웹 코드 또는 플러그인 변경 후:

```bash
npm run build:native
npm run native:open:android
npm run native:open:ios
```

Android Studio/Xcode에서 서명, 앱 아이콘, 개인정보 manifest, 스토어 상품과
AdMob App ID를 최종 확인한다. `.env.native` 값을 바꾼 뒤에는 반드시 웹 번들을
다시 빌드하고 `cap sync`를 실행한다. 앱 package/bundle ID와 이름은
`capacitor.config.json`에서 관리한다.

## 7. Cloudflare 출처와 비밀값

`NATIVE_ALLOWED_ORIGINS` 기본값은 아래 Capacitor 로컬 origin만 허용한다.

```text
capacitor://localhost,https://localhost,http://localhost
```

브라우저의 임의 교차 출처 요청은 거부된다. 네이티브 API 응답에만 CORS가
붙고, Bearer 세션은 일반 웹 응답에 노출하지 않는다. WebSocket은 브라우저 API
제약으로 연결 query에 단기 세션을 전달하므로 Worker 액세스 로그에 query
문자열을 별도로 기록하지 않는다.

운영 비밀값은 Wrangler secret 또는 Cloudflare 대시보드 secret으로만 관리한다.

```bash
npx wrangler secret put GOOGLE_WEB_CLIENT_ID
# 추후 검증 구현 시:
npx wrangler secret put GOOGLE_PLAY_SERVICE_ACCOUNT
npx wrangler secret put APPLE_IAP_KEY_ID
npx wrangler secret put APPLE_IAP_ISSUER_ID
npx wrangler secret put APPLE_IAP_PRIVATE_KEY
```

## 8. 출시 전 체크리스트

- 개인정보 처리방침, 이용약관, 계정 삭제 URL
- Google Play Data safety / Apple App Privacy 응답
- 광고 ID, 추적, UMP/ATT 동의 흐름
- 소셜 로그인 계정과 기존 아이디 계정의 연결/충돌 정책
- 복원 구매, 환불, 중복 결제, 네트워크 중단 시나리오
- TestFlight/Internal testing의 실제 영수증 서버 검증
- 스토어 스크린샷, 연령 등급, 고객지원 URL
