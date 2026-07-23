# 2.5D 캐릭터 스프라이트

게임의 수직 탑다운 카메라에 맞춘 투명 PNG 자산이다.

## 구성

- `survivors/<character-id>/concept.png`: 정면 대기 콘셉트 이미지
- `survivors/<character-id>/movement-sheet.png`: 4열 × 3행 이동 시트
- `survivors/<character-id>/frames/`: 정면·후면·우측의 대기 1장 + 걷기 3장, 총 12장
- `ghosts/<variant>/concept.png`: 정면 대기 콘셉트 이미지
- `ghosts/<variant>/movement-sheet.png`: 4열 × 3행 이동 시트
- `ghosts/<variant>/movement/`: 정면·후면·우측의 대기 1장 + 이동 3장, 총 12장
- `ghosts/<variant>/attack-sheet.png`: 3열 × 3행 공격 시트
- `ghosts/<variant>/attack/`: 정면·후면·우측의 준비·타격·회복, 총 9장
- 각 `source/` 폴더: 배경 제거 전 크로마키 원본
- `roster-preview.png`: 21종 전체 확인용 미리보기

## 런타임 규칙

- `front`, `back`, `side`는 화면에서 보이는 이동 방향에 따라 선택한다.
- 왼쪽 방향은 `side` 프레임을 수평 반전해 사용한다.
- 이동하지 않을 때는 `*-idle.png`, 이동할 때는 `*-walk-1.png`부터 `*-walk-3.png`까지 반복한다.
- 귀신이 문을 공격할 때는 `*-attack-1.png`부터 `*-attack-3.png`까지 한 번 재생한다.
- 캐릭터의 월드 판정 크기와 이미지 여백은 분리한다. 큰 이펙트가 있어도 충돌 반경은 기존 타일 판정을 유지한다.

검증은 번들 Python 환경에서 `scripts/validate_sprite_assets.py`를 실행한다.
