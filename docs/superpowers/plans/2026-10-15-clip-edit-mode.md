# 클립 편집 모드 · 떠 있는 관절 패널 · 구간 수정 구현 계획

스펙: `docs/superpowers/specs/2026-10-15-clip-edit-mode-design.md`
적용: 원본 저장소 브랜치 `feat/clip-edit-mode`(PR #1 `feat/edit-compare` 위) + `Desktop\robot` 합본(같은 변경, GO2 블럭 부분은 합본에만). 커밋은 요청 시.

## A. 클립 수정 층 (모델)

- [x] A1. `types.ts` `Clip.offset?: Record<string, Curve>`; `projectFile` 저장(v2 압축)·읽기(채널 이름 검증) (+테스트: 왕복, 잘못된 채널 거부)
- [x] A2. `itemClip.ts` `baseClip(p, defs, clipId)` = 원본 + 클립 수정 층(`bakeOffset`, 메모). `editedClip`·`itemClip`이 `baseClip` 위에 조각 수정 층 (+테스트: 수정 없음 = 원본, 한계로 자름, `use: 'original'`은 조각 수정만 뺌)
- [x] A3. 클립 길이 줄이기가 `Clip.offset` 길이 밖 키 삭제, `키 줄이기`는 원본만 (+테스트)

## B. 가상 편집 대상 (스토어)

- [x] B1. 상태 `clipEdit`, `clipEditReturn`(재생헤드·layer), `openClipEdit(clipId)`/`closeClipEdit()`; 클립이 사라지면 자동 종료(편집·실행취소·불러오기) (+테스트)
- [x] B2. `CLIP_ACTOR`·가상 조각; `actorOf(s, id)`; `editingItem`·`editTarget`·`keyTarget`(`asset:` 대상)·`trackLocked`·`editLock`·`gizmoLock`(루트 잠금 `'clipRoot'`) (+테스트)
- [x] B3. `layer: 'asset'`; `keyOwner`·`ownerOf`·`draft`(touched)가 `asset:<id>` 처리; `setValue`·`keyGroup`·키 액션이 수정 층 차이값으로 씀 (+테스트: 원본 곡선 불변, 결과 = 원본 + 차이)
- [x] B4. `transport.ts`: `playRange` 가상 조각, Esc = 클립 편집 나가기, 자르기 막기 (+테스트)

## C. 화면 — 클립 편집 모드

- [x] C1. 목록: 카드 더블클릭 = 클립 편집, 이름 글자 더블클릭·우클릭 `이름 바꾸기` = 이름 바꾸기, 우클릭 `클립 편집`, 수정 층 있으면 `●` + 툴팁
- [x] C2. 타임라인 머리줄: `목록 ▸ <클립> (클립 편집)`, `시퀀스로`, `원본 보기`(누르는 동안), `겹쳐 보기`, `CSV 저장`; 트랙/그래프 보기는 `buildRows`의 가상 액터 줄로
- [x] C3. 메인 Stage: 클립 편집이면 가상 액터 리그 하나(원점, 로봇 기본색), 관절 고르기·관절 기즈모, 루트 기즈모 잠금, `원본 보기`/`겹쳐 보기`; 프리뷰 창은 `clipEditReturn` 재생헤드로 멈춤
- [x] C4. 인스펙터: 클립 편집이면 클립 칸 + 편집 대상(`이 클립 수정`/`원본 클립 수정`) + `수정 키 n개`·`수정 지우기` + 값
- [x] C5. `CSV 저장`: `baseClip` → 로컬 루트 CSV(`<G1|GO2>_<클립>.csv`), `validatePoses` 경고 확인 (+단위 테스트: 행 = baseClip 포즈)

## D. 떠 있는 관절 패널

- [x] D1. `viewer/JointPanel.tsx`: 메인 3D 오른쪽 위, 고른 관절의 부위 전체 줄(슬라이더·숫자·한계 표시), 고른 줄 강조, 다른 줄 클릭 = 관절 바꿈, ◀▶ 키 이동·키 추가·키 삭제, 접기(localStorage)·닫기, ↑↓←→(Shift ×10)
- [x] D2. 인스펙터 `값`과 같은 동작(`setValue`·제스처·잠금·자동 키 규칙), 도/rad 공유

## E. 구간 수정

- [x] E1. 상태 `range: { a, b, fade } | null`; 클립 축 눈금자 Shift+드래그로 선택, 눈금자·키 영역 띠 그리기, 열린 클립 바뀌면 해제
- [x] E2. 패널 구간 줄(a·b 입력, 가감, 해제, 안내)
- [x] E3. 구간 쓰기: `d` × smoothstep 가중치를 `[a−fade, b+fade]` 프레임마다 선형 키로, 경계 밖 원래 값 키, 관절 한계, 제스처 시작 값 기준(누적 없음), 재생헤드가 구간 밖이면 막음 (+테스트: 구간 안 같은 차이, fade 밖 불변, 실행취소 1번)

## F. 성능·확인

- [x] F1. 제스처 중 시퀀스 레인 리드인·끝 기본자세 길이를 제스처 시작 값으로 그림
- [x] F2. e2e `clipEdit.spec.ts`(더블클릭 → 패널로 수정 → CSV 저장 = 메인 포즈, 원본 곡선 불변, 시퀀스 조각 반영), `jointPanel.spec.ts`(3D 관절 클릭 → 부위 줄, 다른 줄로 바꿔 편집), `rangeEdit.spec.ts`(Shift+드래그 구간 → 값 변경 → 구간·fade 검사)
- [x] F3. 단위·tsc·e2e 전체, `leadIn.sweep`·`restTail.sweep` 통과, CLAUDE.md 갱신, 화면 캡처 확인
- [x] F4. 합본에 같은 변경 적용(GO2 블럭 코드 유지), 합본 전체 테스트

## 위험

- 액터를 찾는 곳이 많다(약 38곳). 클립 편집 모드에서 쓰는 경로(Stage·TrackCanvas·GraphCanvas·Inspector·패널·스토어 키 액션)만 `actorOf`로 바꾸고, 시퀀스 전용 경로는 그대로 둔다. 빠뜨린 곳은 클립 편집 e2e가 잡도록 한다.
- `asset:` 대상 ID가 `edit`의 구조 공유(`touched`)와 잠금 검사(`clipLocked`)를 통과하는지 단위 테스트로 확인.
- `baseClip` 도입으로 `itemClip`이 바뀌면 리드인 회귀 sweep이 다시 돌므로 결과가 같아야 한다(수정 없는 클립 = 원본 객체 그대로).
