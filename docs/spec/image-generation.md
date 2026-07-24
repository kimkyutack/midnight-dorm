# 심야 병동 생성 이미지 자산 스펙

- 기준일: 2026-07-23
- 생성 방식: Codex 내장 `imagegen` 기본 모드
- 후처리: 시네마틱은 Sharp WebP, 스프라이트는 크로마키 제거 후 투명 PNG 분리
- 사용 위치: `public/assets/cinematic`, `public/assets/sprites`, `public/assets/environment`

## 탑다운 건물·환경 타일

- 현재 전장 설비는 `public/assets/buildings/cute-*.png`, 환경은 `public/assets/environment/*-tile-v2.png`를 사용한다. 모든 건물 PNG는 512×512 투명 캔버스의 정중앙에 놓고, 실제 전장에서는 한 타일을 거의 채우되 인접 타일을 침범하지 않는다.
- 수호 포탑은 `cute-basic-turret-1.png`부터 `cute-basic-turret-15.png`까지 15개의 서로 다른 실루엣을 사용한다. 기본 시트에서는 단일 포열이 이미지 하단(남쪽)을 향하고, 런타임 피벗이 문 또는 사거리 안 귀신 방향으로 회전한다.
- 달빛 발전기는 레벨별 PNG를 사용한다. 업그레이드 단계는 밝기·크기만 바꾸지 않고 코어, 외장, 장식의 실루엣이 구별되어야 한다.
- 방 바닥, 복도, 벽은 각 테마에서 서로 다른 타일 자산을 써서 저조도에서도 이동 가능 복도와 막힌 벽, 건설 가능한 방 바닥이 명확히 구분되어야 한다.
- 크로마키 시트를 새로 만들 때는 가장자리와 내부의 키 색을 모두 제거한 뒤 각 셀을 분리한다. 분리 결과의 불투명 영역은 고정 캔버스 중심에 정렬하고, 배경색·그리드·키 색 프린지가 남지 않았는지 확인한다.

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

## home-hospital-corridor.png

목적: 세로 게임 홈 전용 배경. 현재 착용 캐릭터가 하단 중앙에서 복도 안쪽으로 천천히 걷는다.

```text
Tall abandoned hospital corridor at midnight, centered one-point perspective, empty tiled floor and patient-room doors, faint distant exit glow, dark navy and restrained teal lighting, portrait 9:16. Keep the lower center clear for one character and the upper area quiet for HUD. No people, creatures, text, logo, watermark or UI.
```

## ghost-roster.webp

목적: 초기 6종 귀신의 콘셉트 참고 시트. 현재 전장 모델은 코드 네이티브 3D로 렌더링한다.

```text
Production-ready 3-column by 2-row horror character sheet on a uniform pure-black background. Six distinct full-body photoreal ghosts: long-haired wanderer, thin fast crawler, burned orderly brute, faceless occult caster, cyan drowned twin and pink cracked-porcelain twin. One centered character per equal cell, generous black margins, consistent scale, distinct silhouettes, non-gory, original designs. No grid, border, label, text, watermark or UI.
```

## ward-floor-tile.png

목적: 모든 스테이지에서 테마 색상을 곱해 사용하는 수직 탑다운 바닥 타일 원본. 중첩 지오메트리 대신 이미지 한 장으로 얕은 단차와 마모를 표현한다.

```text
One original abandoned hospital floor slab, strict orthographic top-down square. Neutral charcoal and desaturated blue-gray worn sealed concrete, subtle scratches and grime, one restrained perimeter bevel. No nested squares, raised center, icon, plus, object, text, gore or watermark.
```

## ward-wall-surface.png

목적: 인접한 벽 셀이 하나의 매끄러운 방벽처럼 보이게 하는 연속형 상단 표면 원본.

```text
Uniform seamless abandoned-hospital wall-cap material, strict orthographic top-down square. Neutral dark slate and desaturated steel gray, broad smooth aged surface with faint wear. Absolutely no border, frame, inset, central panel, bolts, tile outline, text, symbols, gore or watermark.
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
- 인게임, 게임 홈, 캐릭터 상점은 이 스프라이트 프레임을 사용한다. Three.js 캐릭터·귀신 모델은 캐릭터 표시 경로에서 사용하지 않는다.
- 캐릭터 카드는 `public/assets/paperdoll/bases`의 기본 콘셉트를 표시한다.
- 스킨 카드는 `public/assets/sprites/survivors`의 완성형 콘셉트와 이동·수면 아틀라스를 표시한다. 런타임에서 모자·옷·신발·장신구를 분리 합성하지 않는다.
