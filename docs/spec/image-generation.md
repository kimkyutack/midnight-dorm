# 심야 병동 생성 이미지 자산 스펙

- 기준일: 2026-07-23
- 생성 방식: Codex 내장 `imagegen` 기본 모드
- 후처리: 시네마틱은 Sharp WebP, 스프라이트는 크로마키 제거 후 투명 PNG 분리
- 사용 위치: `public/assets/cinematic`, `public/assets/sprites`

## opening-chase.webp

목적: 최초 실행 6.7초 추격 티저 배경.

```text
Premium mobile horror survival-defense opening still, 16:9. A frightened dorm resident runs toward camera through an abandoned Korean university dorm corridor while three distinct photoreal spectral entities chase through cold mist. Wet reflective floor, flickering ceiling lights, cyan moonlight and restrained crimson emergency glow, cinematic depth of field, non-gory, original designs. Dark title space at upper-left and skip-button space at lower-right. No logo, text, watermark, UI or border.
```

## dorm-home.webp

목적: 로그인, 게임 홈, 모드 선택 공통 배경.

```text
Premium mobile horror game home background, 16:9. An isolated abandoned Korean university dormitory at midnight in winter, one warm-lit entrance, cold cyan windows with distant ghost silhouettes, fog, wet stone reflections, deep navy palette, grounded photoreal materials and original architecture. Dark space at upper-left for account/title and a clear lower-center entrance for the game-start button. No logo, text, watermark, UI or border.
```

## ghost-roster.webp

목적: 초기 6종 귀신의 콘셉트 참고 시트. 현재 전장 모델은 코드 네이티브 3D로 렌더링한다.

```text
Production-ready 3-column by 2-row horror character sheet on a uniform pure-black background. Six distinct full-body photoreal ghosts: long-haired wanderer, thin fast crawler, burned orderly brute, faceless occult caster, cyan drowned twin and pink cracked-porcelain twin. One centered character per equal cell, generous black margins, consistent scale, distinct silhouettes, non-gory, original designs. No grid, border, label, text, watermark or UI.
```

## 기존 시네마틱 런타임 규칙

- 귀신 시트 한 프레임은 512×432다.
- 프레임 순서는 `wanderer`, `swift`, `brute`, `caster`, `twin-a`, `twin-b`다.
- 신규 `teleporter`, `undead`, `giant`와 언데드가 소환하는 `minion`은 이 시트를 잘라 쓰지 않고 Three.js 지오메트리·재질·발광 장식으로 서로 다른 실루엣을 만든다.
- 배경 검정은 Three.js 투명 텍스처 전처리 또는 가산 합성 재질로 제거한다.
- 시네마틱 이미지는 CSS `cover`로 표시하며 모바일 가로 화면에서 중앙 주 피사체가 잘리지 않아야 한다.
- 다른 게임의 로고, UI, 캐릭터 또는 고유 건물 디자인을 프롬프트에 포함하지 않는다.

## 수직 탑다운 2.5D 스프라이트

- 생존자 12종과 본체 귀신 9종의 `concept.png`를 각각 제공한다. 언데드가 소환하는 `minion`은 별도 콘셉트 수에 포함하지 않는다.
- 생존자 이동 시트는 4열 × 3행이다. 열은 `idle`, `walk-1`, `walk-2`, `walk-3`, 행은 `front`, `back`, `side` 순서다.
- 귀신 이동 시트도 같은 4열 × 3행이고, 공격 시트는 3열 × 3행이다. 공격 열은 `attack-1`, `attack-2`, `attack-3`으로 준비·타격·회복을 표현한다.
- `side`는 우측 방향 원본이며 왼쪽 이동은 런타임에서 수평 반전한다.
- 분리된 모든 프레임은 알파 채널이 있는 투명 PNG다. 원본 크로마키 시트는 각 캐릭터의 `source/`에 보존한다.
- 전체 경로와 프레임 규칙은 `public/assets/sprites/manifest.json`, 제작 결과 확인은 `public/assets/sprites/roster-preview.png`를 기준으로 한다.
- 프레임 분리는 `scripts/split_sprite_sheet.py`, 전체 미리보기 생성은 `scripts/build_sprite_catalog.py`, 수량·투명도 검증은 `scripts/validate_sprite_assets.py`를 사용한다.
- 스프라이트를 실제 전장 렌더러에 연결하기 전까지 현재 Three.js 캐릭터·귀신 모델은 호환용으로 유지한다.
