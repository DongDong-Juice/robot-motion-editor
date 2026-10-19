# 무대 설정 (프리뷰 무대·객석 표시)

## 목적

3D 프리뷰에 공연 무대를 그려 로봇 동선이 무대 안에 드는지, 객석을 어느 쪽으로 보는지 바로 확인한다.
참고: `D:/Project/00_ROS/GO2/Go2DanceStudio_CSV_1001.html`의 무대 설정 부분만 가져옴.

## 확정 사항 (사용자)

- 객석(front) = **+X 쪽**. 로봇 기본 정면(URDF +X)·CSV 로컬 루트 첫 프레임 방향과 같다.
- 무대 크기는 **프로젝트에 저장**, 무대 켜기/끄기는 **3D 창마다**(화면 상태, 저장 안 함, 기본 켜짐).
- 무대 버튼 = 프리뷰 오른쪽 위 `pv-tools`, `로봇 따라가기` 바로 옆 `무대` 토글.
- 크기 조절 = 오른쪽 패널(인스펙터), 메인 3D의 무대가 켜져 있을 때만.

## 범위 밖

- 참고 HTML의 "전체 무대 + 실제 사용 구역" 2중 구조, 칸 번호, 무대 이탈 경고·자동 보정.
- CSV·물리·평가에는 영향 없음(표시 전용).

## 데이터

- `Project.stage?: { width: number; depth: number }` (m). 없으면 기본 `{ width: 10, depth: 6 }`.
  - `width` = 객석에서 본 좌우 = 월드 Y 방향 길이, `depth` = 객석에서 무대 안쪽 = 월드 X 방향 길이.
  - 무대 중심 = 월드 원점.
- 범위 1~30 m, 소수 1자리로 반올림.
- 스토어 액션 `setStage(patch: Partial<{width; depth}>)`: `edit`로 프로젝트에 씀(실행취소 1회), 범위 밖·NaN은 잘라내거나 무시.
- `projectFile`: v2 저장에 그대로 포함, 필드 없는 예전 파일은 기본값으로 동작(마이그레이션 불필요).
- 스토어 UI 필드 `stageShown: boolean`(기본 `true`, 저장 안 함) = **메인 3D 창**의 무대 켜짐. 다른 창(클립 프리뷰·⇄비교·구간 프리뷰)은 `Stage` 컴포넌트 로컬 상태.

## 3D 표시 (`src/viewer/stageFloor.ts`)

`makeStage(width, depth): THREE.Group` — 무대 한 벌.

- 바닥: `width × depth` 평면, `--panel` 색, z = 0 바로 아래(격자와 z-fighting 방지).
- 격자: 무대 안에만 0.5 m 간격(`--line`), 1 m마다 진하게(기존 `makeGrid`와 같은 색 규칙).
- 테두리: 무대 사각형 선, `--dim`.
- 객석 표시: +X 가장자리 바깥에 `--accent` 띠(폭 약 0.12 m), 그 바깥 바닥에 `객석` 글자를 눕힌 평면(캔버스 텍스처, IBM Plex Sans KR, `--accent`), 글자 아래쪽이 객석을 향하도록(객석에서 바로 읽힘). 대문자 라벨 금지 규칙에 따라 `FRONT`는 쓰지 않음.

`Stage.tsx`:
- 무대가 켜지면 기존 ±5 m 격자(`makeGrid`)를 숨기고 무대 그룹을 보임, 끄면 반대.
- `project.stage`(또는 기본값)의 크기가 바뀌면 그룹을 새로 만들고 이전 그룹은 dispose. 언마운트 시 dispose.
- 켜짐 상태는 렌더 루프가 ref로 읽음(`로봇 따라가기`와 같은 방식). 메인 창은 스토어 `stageShown`, 그 밖의 창은 로컬 `useState(true)`.
- 버튼: `<button className="pv-btn" aria-pressed={stage}>무대</button>`, `로봇 따라가기` 바로 뒤, `title="무대와 객석 방향을 보여 줍니다"`.
- 개발 훅: `__stages[key]`에 `stage: () => 무대 그룹 | null`(e2e에서 크기·표시 확인).

## 인스펙터 (`src/inspector/Inspector.tsx`)

- 맨 아래 `무대` 섹션(`insp-sec`): `가로`·`깊이` 숫자 입력(단위 m, step 0.1, min 1, max 30) + 안내 한 줄 `객석은 +X 쪽입니다`.
- `stageShown`이 `true`일 때만 보임.
- 로봇을 고르지 않아 안내문만 나오는 경우(`insp-empty`)와 클립 편집 모드에서도 이 섹션은 보임 → 섹션을 작은 컴포넌트(`StageSection`)로 두고 인스펙터의 모든 반환 경로 끝에 붙임.

## 테스트

- 단위(vitest): `setStage` 범위 제한·반올림·실행취소 1회, 프로젝트 저장 → 열기 왕복에 `stage` 유지, `stage` 없는 파일은 기본 10×6.
- e2e(Playwright) 1개 `e2e/stage.spec.ts`: 메인 3D `무대` 버튼이 기본 눌림, 인스펙터 `무대` 섹션 보임 → 크기 입력 바꾸면 `__stage.stage()` 크기 반영 → 버튼 끄면 섹션 사라지고 무대 그룹 숨김.
