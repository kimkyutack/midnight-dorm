# 네이티브 앱 빌드와 용량 관리

## 배포 산출물

- Play Console에는 `android/app/build/outputs/bundle/release/app-release.aab`를 업로드한다.
- AAB는 기기 ABI·화면 밀도에 맞는 리소스만 Play가 내려주므로, 범용 APK보다 실제 설치 용량이 작다.
- 개발 중 테스트 APK가 필요할 때만 Android Studio의 debug APK를 사용한다. 범용 APK 크기를 스토어 설치 크기로 판단하지 않는다.

## 현재 적용된 최적화

- `npm run build:native`는 Capacitor 동기화 전 `dist/client/assets/**/source`를 제거한다.
  - `source/`는 스프라이트 제작용 원본이며 게임 런타임은 가공된 프레임만 사용한다.
  - 원본은 `public/`과 저장소에 그대로 보존되므로 웹 빌드·에셋 재가공에는 영향이 없다.
- Android release는 R8 코드 축소와 Android 리소스 축소를 사용한다.
- 네이티브 번들의 런타임 PNG는 고품질 WebP(품질 96, 알파 채널 품질 100)로만 변환한다.
  - 변환과 경로 치환은 `dist/client`에서만 일어나므로 저장소 원본과 웹 배포 이미지는 PNG 그대로 유지된다.
  - WebP를 지원하는 Android WebView와 iOS WKWebView에서만 사용한다.
  - 최초 설정 시 `cwebp`가 필요하다. macOS에서는 `brew install webp`로 설치한다.
- `npm run native:splash`는 `public/assets/cinematic/native-splash-master.png`에서 Android·iOS 스플래시 리소스를 재생성한다.

## 빌드 순서

```bash
npm run build:native
cd android
./gradlew bundleRelease
```

## 다음 용량 절감 기준

- 런타임 PNG는 원본을 유지한 채, 네이티브 산출물에서만 고품질 WebP로 변환한다. 게임 아트와 투명 픽셀 경계를 보존하기 위해 알파 채널 품질은 100으로 고정한다.
- 위 최적화 뒤에도 설치 용량이 과하면, 실제 로딩 경로가 확인된 상점·이벤트 전용 시네마틱부터 AVIF 비교 검증을 거쳐 교체한다.
- 상점·이벤트 전용 시네마틱 이미지처럼 플레이 중 필수가 아닌 파일은 Cloudflare 캐시 기반 지연 로딩 후보로 분리한다. 핵심 게임 스프라이트는 오프라인 플레이를 위해 번들에 유지한다.

## Cloudflare R2 에셋 분리 기준

- 캐릭터 이동 프레임, 귀신, 타일, 건물, 기본 UI, 스플래시는 앱 번들에
  유지한다. 전투 중 네트워크 지연이나 R2 장애로 핵심 이미지가 비는 것을
  방지하기 위해서다.
- 이벤트 팝업, 상점 대형 프리뷰, 튜토리얼 포스터처럼 용량이 크고 전투 중
  필수가 아닌 이미지만 R2의 커스텀 도메인으로 분리한다.
- 원격 에셋 URL은 파일 내용을 포함한 버전 경로를 사용하고 장기 immutable
  캐시를 적용한다. 카탈로그에는 원격 URL과 번들 fallback 이미지를 함께 둔다.
- 홈 진입 후 유휴 시간에 현재 캠페인과 선택 탭의 이미지만 미리 받아서
  Cache Storage에 저장한다. 전체 카탈로그를 한 번에 내려받지 않는다.
- 따라서 모든 이미지를 R2로 옮기는 방식이 아니라, 설치 용량을 크게 만드는
  비필수 이미지부터 분리하는 혼합 구성을 기본 원칙으로 한다.
