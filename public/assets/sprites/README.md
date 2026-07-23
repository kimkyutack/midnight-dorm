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

## 커스텀 외형 확장 규칙

- 캐릭터 조합마다 완성 이미지를 새로 만들지 않는다. 기본 캐릭터 위에 `outfit`, `hat`, `accessory`, `shoes` 투명 아틀라스를 같은 4열 × 3행 규격으로 겹친다.
- 모자·장신구는 정지 프레임을 각 걷기 칸에 재사용할 수 있다. 옷·신발은 걷기 변화가 필요할 때만 3장 걷기 프레임을 추가한다.
- 서로 체형이 다른 캐릭터는 모든 조합을 만들기보다 `small / standard / broad` 같은 체형 프로필별 레이어만 보완한다.
- 현재 제작된 21종은 기본 본체 아틀라스다. 구매 외형의 고품질 레이어 PNG는 다음 자산 배치에서 추가하며, 런타임 `AtlasSpriteActor`는 이미 여러 레이어를 같은 프레임으로 합성할 수 있다.

## 정렬 기준

- 이동·공격 프레임은 모두 같은 캔버스 중앙과 바닥선에 맞춘다. 대기·왼발·오른발 프레임에서 몸통 위치가 바뀌면 안 된다.
- 콘셉트 PNG는 362×362 투명 캔버스 안에서 중앙 하단 기준으로 맞춘다. 상점 카드에서는 이 원본을 `contain`으로 표시한다.
- 생성 원본의 포즈 위치가 어긋난 경우 `scripts/normalize_sprite_alignment.py`를 실행한 뒤 `scripts/build_sprite_catalog.py`와 `scripts/validate_sprite_assets.py`로 결과를 확인한다.

검증은 번들 Python 환경에서 `scripts/validate_sprite_assets.py`를 실행한다.
