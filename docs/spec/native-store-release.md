# Google Play / App Store 결제 출시 설정

## 상품

동일한 소모성 캐시 상품을 두 콘솔에 생성한다. 게임 내 유료 상품은 개별 스토어 상품이 아니라 캐시로 구매한다.

| SKU | 지급 대상 | 스토어 가격 |
| --- | --- | --- |
| `com.midnightdorm.cash.100` | 캐시 100개 | ₩1,500 |
| `com.midnightdorm.cash.550` | 캐시 550개 | ₩7,500 |
| `com.midnightdorm.cash.1200` | 캐시 1,200개 | ₩15,000 |
| `com.midnightdorm.cash.2500` | 캐시 2,500개 | ₩30,000 |
| `com.midnightdorm.cash.5200` | 캐시 5,200개 | ₩60,000 |
| `com.midnightdorm.cash.10400` | 캐시 10,400개 | ₩156,000 |

클라이언트는 가격이나 지급량을 신뢰하지 않는다. 구매 토큰은 Worker에 한 번만 제출하고, 검증 완료 트랜잭션만 서버 원장에서 캐시를 지급한다. 각 SKU는 계정당 최초 1회에 한해 20% 캐시를 추가 지급한다. 예를 들어 10,400 캐시 팩의 첫 구매 지급량은 12,480 캐시이며, 이후에는 10,400 캐시다. 귀신구슬 소환처럼 캐시를 사용하는 기능은 서버에서 잔액 확인과 차감을 보상 지급과 같은 트랜잭션으로 처리한다.

## 출시 전 필수 설정

1. Play Console에서 앱 서명, 내부 테스트 트랙, 위 SKU 여섯 개와 Google Play Developer API 서비스 계정을 만든다.
2. App Store Connect에서 In-App Purchase 여섯 개, Sandbox Tester, App Store Server API 키/Issuer ID/Key ID를 만든다.
3. Apple Developer의 `com.midnightdorm.game` App ID에서 **Sign in with Apple** capability를 켠다. 프로젝트에는 `App.entitlements`가 포함돼 있다.
4. Worker secret으로 각 검증 자격증명을 추가하고 서버 검증·지급 원장을 배포한 마지막 단계에서만 `STORE_VERIFICATION_ENABLED=true`를 켠다.

현재 Worker는 이 설정값이 꺼진 동안 영수증을 접수하거나 보상을 지급하지 않는다. 따라서 스토어 서버 설정 전에는 실결제가 시작되지 않는다.

## Apple 로그인

iOS 네이티브 앱에서만 Apple 버튼을 Google 버튼 옆에 노출한다. Native Apple ID credential은 Worker가 Apple JWKS, issuer, bundle-id audience로 검증한다. 최초 로그인 때 Apple이 제공하는 private-relay 이메일이 없으면 신규 계정을 만들지 않는다.
