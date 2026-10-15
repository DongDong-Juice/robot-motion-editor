# 관성 구간 리드인 구현 계획

스펙: `docs/superpowers/specs/2026-10-14-inertia-lead-in-design.md` · 브랜치: `feat/inertia-lead-in` (`feat/cut-restpose` 위)
적용 위치: 원본 저장소 + 합본(`Desktop\robot`). 기본자세 기능이라 Go2 작업트리는 해당 없음.

## 1. 모델

- [x] 1. `types.ts` `Item`에 `restHold?`, `restBlend?: number | 'auto'`, `inertia?` 추가. `projectFile.ts` 검증(정수·범위, `'auto'`) + 테스트(옛 파일 그대로 읽힘, 잘못된 값 거부)
- [x] 2. 새 파일 `src/model/inertia.ts`
  - `motionEnergy(clip, def): Float64Array` (가중 관절 속도 + 루트 속도·yaw 속도, 9프레임 평균) — 클립 객체별 `WeakMap` 캐시
  - `quietLevel(E)` = 하위 20%
  - `autoInertia(clip, def, c): { len, why: 'still' | 'quiet' | 'trough' | 'min' | 'review' | 'start' }` (스펙 판정 1~4)
  - 테스트: 합성 클립(정지 구간 → 빠른 흔들기)에서 이유 6가지가 각각 나옴, `len ≤ min(90, c)`
- [x] 3. `restPose.ts`
  - `leadOf(item, clip, def): { hold, blend, inertia, lead, why, blendWhy? }` — 필드 없으면 기본값·자동 판정, `inertia ≤ trimIn` 보장. `'auto'` 전이는 `autoBlend`로
  - `autoBlend(clip, def, a, hold)`: 관절별 Hermite 최고 속도 ≤ 0.5·`velocity`인 최소 B(15~180, 6 간격)
  - `prependRestPose(clip, def, a, hold, blend)`: 상수 `REST_HOLD`/`REST_BLEND` 대신 인자. `REST_PREPEND` 상수 제거
  - `restClipFor` 캐시 키에 `a:hold:blend`
  - 테스트 갱신: 길이 + hold+blend, 관성 구간 = 원본 프레임 그대로, 전이→관성 경계 속도 차 < 2e-3, x·y·yaw 고정, `autoBlend` 결과가 속도 한계 50% 이하

## 2. 내보내기·물리·프리뷰 연결

- [x] 4. `csv.ts`: `restLead(item)` → `restLead(p, defs, item)`(= `lead`). `samplePoses`는 파생 클립 프레임 `a + k`(k < lead)를 `evaluateClip(clip, trimIn)` 기준으로 `raw[0]`에 놓아 앞에 붙임. 경고 프레임 오프셋도 `lead`. 테스트: 행 수 = 조각 + lead, 관성 행이 원본과 같음(로컬 기준)
- [x] 5. `restLead` 호출처 갱신: `physGraph.seqFrameOf`, `physicsWarn`, `StagePanes`(range = `[trimIn − inertia, trimOut + hold + blend]`), `Stage.applyClip` 오프셋(`REST_PREPEND` → `lead`), `SequenceCanvas` 보라 구간·물리 그래프. 물리 캐시는 CSV 텍스트 키라 자동으로 오래됨 처리

## 3. 스토어·화면

- [x] 6. 스토어 `setRestLead(itemId, patch: { restHold?, restBlend?, inertia? } | 필드 null = 자동/기본)`: 잠긴 트랙 거부, 범위로 자름, 실행취소 한 번. 테스트
- [x] 7. `StagePanes` `ItemPreview`: 덧붙이기일 때 리드인 설정 줄(정지·전이[자동]·관성[자동] 초 입력 + 판정 이유 칩, 검토 필요는 강조색). 버튼 툴팁·결과 문구의 "1.5초" → 실제 길이. aria-label: `차렷 정지 (초)`, `전이 (초)`, `관성 (초)`, `전이 자동`, `관성 자동`
- [x] 8. `SequenceCanvas` 레인: 리드인 = 조각 앞 `lead`; 정지·전이 `--rest` 채움, 관성 `--rest` 테두리만; 검토 필요면 레인 라벨 `⚠`. 한 줄 접힘 띠도 `lead` 길이
- [x] 9. `styles.css`: 설정 줄·칩 스타일(기존 `.pv-btn` 톤, 수치 `tabular-nums`)

## 4. 확인·문서

- [x] 10. e2e `e2e/inertia.spec.ts`: CSV 가져오기 → 자르기 → 덧붙이기 → 관성 자동 이유 표시, 관성 값 바꾸면 내보내기 행 수 변함, 프리뷰·레인 위치 맞음(기존 `restPreview.spec` 방식). 기존 `restPreview`/`tree`/`exportOne` spec이 90 고정을 가정하면 갱신
- [x] 11. 실제 파일 확인: `Track2_FINAL_0909.csv` 180·2400 지점을 잘라 내보내고 관성 행 = 원본, 경고 없음, 40초 지점 "검토 필요" 표시
- [x] 12. 단위·`tsc -b`·e2e 통과(원본·합본), CLAUDE.md 핵심 불변식의 기본자세 설명 갱신(90 고정 → 정지+전이+관성), 예제 프로젝트(`tools/make_examples.mjs`) 영향 확인
- [x] 13. 합본(`Desktop\robot`)에 같은 변경 적용 후 같은 확인. 커밋은 사용자가 요청할 때

## 결과 (2026-10-14)

- 원본: 단위 317, e2e 19 통과(영상 2 건너뜀). 합본: 단위 353, e2e 25 통과.
- 실제 파일 `Track2_FINAL_0909.csv`: 180 자름 → 관성 19프레임(조용한 지점), 2400 자름 → 8프레임(검토 필요, 레인 ⚠·칩 표시). 두 경우 모두 CSV 행 = 조각 + 리드인, 관성 행 관절값 = 원본 행(차 < 1e-6).
- 합본은 조각 수정 층이 있으면 그 결과(`itemClip`)로 판정·리드인을 만든다.
- 13번(합본 적용) 완료. 커밋은 하지 않음.

## 위험

- `REST_PREPEND`를 쓰는 곳이 여럿(프리뷰·레인·CSV·물리) — 하나라도 빠지면 프리뷰와 CSV가 어긋남. 5번에서 `grep REST_PREPEND` 0건 확인.
- 자동 판정은 클립 전체를 한 번 훑음(1만 프레임 × 29관절 수 ms). 캐시 없이 매 프레임 부르면 느려지므로 클립별 캐시 필수.
- 관성 구간이 크로스페이드에 걸친 앞쪽 원본을 쓰는 경우: 판정·관성은 원본 클립 기준이라 시퀀스 재생과 다를 수 있음(기존 알려진 한계와 같은 종류).
