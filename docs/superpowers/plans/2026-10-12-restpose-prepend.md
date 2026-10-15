# 기본자세 덧붙이기 구현 계획

스펙: `docs/superpowers/specs/2026-10-12-restpose-prepend-design.md` · 브랜치: `feat/restpose-prepend` (`fix/export-name-e2e-workers` 위)

- [x] 1. `types.ts` `Item.restPose?: true | 'prepend'`, `projectFile.ts` 검증이 `'prepend'` 허용 (+테스트)
- [x] 2. `restPose.ts`: `REST_PREPEND = 90`, `prependRestPose(clip, def, a)`, `restClipFor(..., mode)` 캐시 키에 모드 (+테스트: 길이 +90, 원본 프레임 보존, 유지·블렌드 값)
- [x] 3. `pose.ts`: `placePose(p, origin)` = `rebasePose`의 역 (+테스트)
- [x] 4. `csv.ts`: `restLead(item)`, `samplePoses` 덧붙임(90행 추가, 부호 연속·로컬 기준), `exportItemCsv` 경고 프레임 오프셋 (+테스트)
- [x] 5. `physGraph.seqFrameOf` 오프셋, 경고 구간 클릭은 `item.start` 이상
- [x] 6. 스토어 `setRestPose(itemId, mode: true | 'prepend' | null)` (+테스트)
- [x] 7. `StagePanes` 버튼 2개/해제, 문구; `Stage` 파생 클립·범위; 트리·막대 표시
- [x] 8. e2e `tree.spec` 갱신(덧붙이기: CSV 행 수 +90), 단위·tsc·e2e 통과, CLAUDE.md 갱신, 커밋

## 2차: 자르면 기본 덧붙이기 + 타임라인 반영 (스펙 "변경" 절)

- [x] 9. 스토어 `splitItem`: 모션 조각의 뒤 조각 `restPose: 'prepend'`, 같은 트랙 뒤 조각 +90; 자르기 위치는 `clipOrigin` 기준(리드인 안이면 거부)
- [x] 10. `sequence.ts` `restLead`·`itemLen`(리드인 포함)·`clipOrigin`, `resolve`·`stitchTransforms` 반영
- [x] 11. `restPose.playable(p, defs)`(조각별 파생 클립, 캐시) → `evaluate`가 사용; `withRestPose`·`placePose` 삭제, `samplePoses`는 막대 범위 그대로
- [x] 12. `setRestPose`가 리드인 길이 차만큼 뒤 조각 이동; `editLock` 'rest' + 힌트
- [x] 13. `start − trimIn` 직접 계산 → `clipOrigin`(transport·Inspector·Track/GraphCanvas·editTarget), 물리 그래프 오프셋, 막대 리드인 표시, 문구
- [x] 14. 단위·e2e 갱신, 예제 프로젝트 재배치, CLAUDE.md·스펙 갱신, 브라우저 확인
- [x] 15. 기본자세 = 차렷: `RobotDef.rest`(G1 팔꿈치 π/2, GO2 서기), FK 높이, 테스트(한계 안·손이 팔꿈치 아래)
- [x] 16. 리드인 끝 속도 = 모션 시작 속도(Hermite / 등가속), 이어붙이기 기준 = 리드인 첫 자세, 테스트(끝 속도 일치)
- [x] 17. 되돌림: 메인 타임라인은 원본(리드인 길이·밀림·playable·편집 잠금 제거), 차렷·속도 맞춤·자르면 덧붙이기는 유지
- [x] 18. 자르기 기본 덧붙이기 제거(설정은 클립 프리뷰 버튼으로만), 테스트·예제·문서 갱신
- [x] 19. 클립 프리뷰가 메인 재생헤드를 따라감(조각 start = range 시작, 범위 밖은 끝 프레임 고정)
