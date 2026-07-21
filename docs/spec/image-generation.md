# 심야 병동 생성 이미지 자산 스펙

- 기준일: 2026-07-15
- 생성 방식: Codex 내장 `imagegen` 기본 모드
- 후처리: Sharp WebP, hero 1600×896, ghost sheet 1536×864
- 사용 위치: `public/assets/cinematic`

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

## 런타임 규칙

- 귀신 시트 한 프레임은 512×432다.
- 프레임 순서는 `wanderer`, `swift`, `brute`, `caster`, `twin-a`, `twin-b`다.
- 신규 `teleporter`, `undead`, `giant`와 언데드가 소환하는 `minion`은 이 시트를 잘라 쓰지 않고 Three.js 지오메트리·재질·발광 장식으로 서로 다른 실루엣을 만든다.
- 배경 검정은 Three.js 투명 텍스처 전처리 또는 가산 합성 재질로 제거한다.
- 시네마틱 이미지는 CSS `cover`로 표시하며 모바일 가로 화면에서 중앙 주 피사체가 잘리지 않아야 한다.
- 다른 게임의 로고, UI, 캐릭터 또는 고유 건물 디자인을 프롬프트에 포함하지 않는다.
