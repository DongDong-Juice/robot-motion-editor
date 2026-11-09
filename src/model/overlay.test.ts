import { describe, expect, test } from 'vitest'
import { readFileSync } from 'node:fs'
import { loadDef } from '../test/defs'
import { parseCsvPoses, posesToClip } from '../export/importCsv'
import { createEditorStore } from '../store/store'
import { emptyProject } from './defaults'
import { evaluate, type RobotDefs } from './evaluate'
import { editedClip, overlayStates, redWalks } from './itemClip'
import { partJoints, weightAt, srcFrameAt, type Overlay } from './overlay'
import { parseProject, serializeProject } from './projectFile'
import { evaluateClip, type Pose } from './pose'
import type { Clip } from './types'
import { blockClip, pieceBlock } from '../userBlocks'

const defs: RobotDefs = { g1: loadDef('g1'), go2: loadDef('go2') }
const go2 = defs.go2
const blk = (f: string, id: string, n?: number): Clip => {
  const { robot, fps, poses } = parseCsvPoses(readFileSync(`public/go2-blocks/${f}`, 'utf8'), defs, 60)
  const ps = n ? [...poses, ...Array.from({ length: Math.max(0, n - poses.length) }, () => structuredClone(poses.at(-1)!))] : poses
  return { ...posesToClip(ps, fps, robot, defs, id), id }
}
const MANSE = '일어서기_제스처/058_만세!.csv', WAVE = '일어서기_제스처/065_손_흔들기_(오른손).csv', SIT = '앉기_엎드리기/011_앉기.csv'
function go2Piece(base = blk(MANSE, 'base', 240)) {
  const st = createEditorStore(defs, emptyProject()), s = () => st.getState()
  s().appendClip(null, base)
  const actor = s().project.actors[0].id, item = () => s().project.sequence.tracks.flatMap(t => t.items)[0]
  s().addClip(blk(WAVE, 'wave')) // in 목록
  const wave = Object.values(s().project.clips).find(c => c.name === 'wave')!
  return { s, actor, item, wave }
}
const ov = (o: Partial<Overlay> & Pick<Overlay, 'src'>): Overlay => ({ id: 'o1', srcA: 0, srcB: 60, at: 60, len: 90, parts: ['FR'], mode: 'add', weight: 1, fade: 12, ...o })

describe('부위 얹기 계산', () => {
  test('weight fades in and out inside the range; the source loops or holds its last frame', () => {
    const o = ov({ src: 'x', at: 10, len: 40, fade: 8, srcA: 5, srcB: 15 })
    expect(weightAt(o, 9)).toBe(0); expect(weightAt(o, 50)).toBe(0)
    expect(weightAt(o, 10)).toBeGreaterThan(0); expect(weightAt(o, 10)).toBeLessThan(0.2)
    expect(weightAt(o, 30)).toBe(1); expect(weightAt(o, 49)).toBeLessThan(0.2)
    expect(srcFrameAt(o, 10)).toBe(5); expect(srcFrameAt(o, 24)).toBe(14); expect(srcFrameAt(o, 30)).toBe(14) // held
    expect(srcFrameAt({ ...o, loop: true }, 20)).toBe(5); expect(srcFrameAt({ ...o, loop: true }, 25)).toBe(10) // loops
  })
  test('GO2 만세 + 오른앞 흔들기 (더하기): only the FR joints move, only inside the range; the body stays; 초록; one undo', () => {
    const { s, actor, item, wave } = go2Piece()
    const it0 = item(), before = Array.from({ length: 240 }, (_, f) => evaluate(s().project, defs, actor, it0.start + f))
    expect(s().setOverlay(it0.id, ov({ src: wave.id, srcA: 50, srcB: 110, loop: true }))).toBe(true)
    const st = overlayStates(s().project, defs, item())
    expect(st).toHaveLength(1)
    expect(st[0].report.tone).not.toBe('bad')
    const fr = partJoints(go2, ['FR']), after = Array.from({ length: 240 }, (_, f) => evaluate(s().project, defs, actor, it0.start + f))
    let moved = 0
    after.forEach((p, f) => {
      p.rootPos.forEach((v, c) => expect(v).toBeCloseTo(before[f].rootPos[c], 9)) // the body stays
      p.q.forEach((v, i) => { const d = Math.abs(v - before[f].q[i]); if (!fr.includes(i) || f < 60 || f >= 150) expect(d).toBeLessThan(1e-6); else moved = Math.max(moved, d) })
    })
    expect(moved).toBeGreaterThan(0.05)
    s().undo(); expect(item().overlays).toBeUndefined()
  })
  test('더하기 from the first frame of the source (its rearing up) goes past the thigh range: refused with the reason', () => {
    const { s, item, wave } = go2Piece()
    const o = ov({ src: wave.id, srcA: 0, srcB: wave.length })
    const pv = s().previewOverlay(item().id, o)!
    expect(pv.report.tone).toBe('bad')
    expect(pv.report.reasons[0].text).toMatch(/^관절 한계 — 오른앞 허벅지/)
    expect(s().setOverlay(item().id, o)).toBe(false)
    expect(pv.fix.weight).toBeGreaterThan(0)
    expect(s().setOverlay(item().id, { ...o, weight: pv.fix.weight! })).toBe(true) // the 해결 button
  })
  test('빨강 (physical limits) is refused, with the 해결 values; 섞임 0 on a far 덮어쓰기 is too fast', () => {
    const { s, item, wave } = go2Piece()
    const bad = ov({ src: wave.id, srcA: 40, srcB: 100, mode: 'replace', parts: ['FR', 'FL'], fade: 0, at: 30, len: 60 })
    const pv = s().previewOverlay(item().id, bad)!
    if (pv.report.tone === 'bad') {
      expect(s().setOverlay(item().id, bad)).toBe(false)
      expect(item().overlays).toBeUndefined()
      expect(pv.report.reasons.some(r => r.tone === 'bad')).toBe(true)
      if (pv.fix.fade) expect(s().setOverlay(item().id, { ...bad, fade: pv.fix.fade })).toBe(true)
      else if (pv.fix.weight) expect(s().setOverlay(item().id, { ...bad, weight: pv.fix.weight })).toBe(true)
    } else expect(s().setOverlay(item().id, bad)).toBe(true) // (this pair happens to pass)
  })
  test('B 범위 is shown, not refused: a supporting front leg of 앉기 lifted', () => {
    const { s, item, wave } = go2Piece(blk(SIT, 'sit', 200))
    const o = ov({ src: wave.id, srcA: 40, srcB: 100, at: 80, len: 100, parts: ['FR'], mode: 'replace', fade: 30 })
    const pv = s().previewOverlay(item().id, o)!
    expect(pv.report.reasons.some(r => r.b)).toBe(true)
    expect(pv.report.reasons.filter(r => r.b).every(r => r.tone === 'warn')).toBe(true)
    if (pv.report.tone !== 'bad') expect(s().setOverlay(item().id, o)).toBe(true)
  })
  test('not on a 걷기 piece; the source must be a clip of the same robot; inside the piece', () => {
    const { s, actor, item, wave } = go2Piece()
    const w = s().addWalk(actor, { to: [3, 0], face: 'keep' }, 240)
    if (w) expect(s().setOverlay(w, ov({ src: wave.id }))).toBe(false)
    expect(s().setOverlay(item().id, ov({ src: 'nope' }))).toBe(false)
    expect(s().setOverlay(item().id, ov({ src: wave.id, at: 200, len: 100 }))).toBe(false)
    expect(s().setOverlay(item().id, ov({ src: wave.id, parts: ['왼팔'] }))).toBe(false)
  })
  test('the piece 수정 층 goes on top of the overlay: a slider value shows as set', () => {
    const { s, actor, item, wave } = go2Piece()
    s().setOverlay(item().id, ov({ src: wave.id, srcA: 50, srcB: 110, loop: true }))
    s().select(actor, 'FR_thigh_joint'); s().setFrame(item().start + 100)
    const now = evaluate(s().project, defs, actor, item().start + 100).q[partJoints(go2, ['FR'])[1]]
    s().setValue(actor, 'FR_thigh_joint', now + 0.1)
    expect(evaluate(s().project, defs, actor, item().start + 100).q[partJoints(go2, ['FR'])[1]]).toBeCloseTo(now + 0.1, 6)
  })
  test('원본 사용 drops the overlays too; the source clip cannot be deleted while used; saved and opened again', () => {
    const { s, actor, item, wave } = go2Piece()
    const at = () => evaluate(s().project, defs, actor, item().start + 100).q
    const plain = at()
    s().setOverlay(item().id, ov({ src: wave.id, srcA: 50, srcB: 110, loop: true }))
    const laid = at()
    expect(laid).not.toEqual(plain)
    expect(s().setItemUse(item().id, 'original')).toBe(true)
    at().forEach((v, i) => expect(v).toBeCloseTo(plain[i], 9))
    s().undo()
    expect(s().deleteClip(wave.id)).toBe(false)
    const back = parseProject(serializeProject(s().project), defs)
    expect(back.sequence.tracks.flatMap(t => t.items)[0].overlays).toEqual(item().overlays)
    const bad = JSON.parse(serializeProject(s().project)); bad.sequence.tracks.find((t: any) => t.kind === 'motion').items[0].overlays[0].src = 'gone'
    expect(() => parseProject(JSON.stringify(bad), defs)).toThrow(/overlays/)
  })
  test('made 한계 초과 by another change (its source edited in 클립 편집): not played — the piece plays without it — and not exported', () => {
    const { s, actor, item, wave } = go2Piece()
    const plain = evaluate(s().project, defs, actor, item().start + 140).q
    expect(s().setOverlay(item().id, ov({ src: wave.id, srcA: 50, srcB: 110, at: 60, len: 90, mode: 'add' }))).toBe(true)
    // the source's FR thigh given a sudden 0.6 rad jump at its frame 80 in its 클립 수정 층 (a 홀드 key): too fast for the motor now
    const p = s().project, src = p.clips[wave.id], key = (f: number, v: number) => ({ f, v, interp: 'hold' as const, inTan: { df: -10, dv: 0 }, outTan: { df: 10, dv: 0 } })
    const edited = { ...src, offset: { FR_thigh_joint: { keys: [key(0, 0), key(80, 0.6)] } } }
    const st = createEditorStore(defs, { ...p, clips: { ...p.clips, [wave.id]: edited } })
    const proj = st.getState().project, it = proj.sequence.tracks.flatMap(t => t.items)[0]
    const states = overlayStates(proj, defs, it)
    expect(states[0].report).toMatchObject({ tone: 'bad', held: true })
    evaluate(proj, defs, actor, it.start + 140).q.forEach((v, i) => expect(v).toBeCloseTo(plain[i], 9)) // plays without it
    expect(redWalks(proj, defs, [it.id]).map(r => r.kind)).toEqual(['부위 얹기'])
  })
})

describe('사용자 블록', () => {
  test('a piece frozen as it plays (overlay included); not a 걷기 piece; put in again = the 목록 copy reused', () => {
    const { s, actor, item, wave } = go2Piece()
    s().setOverlay(item().id, ov({ src: wave.id, srcA: 50, srcB: 110, loop: true }))
    const c = pieceBlock(s().project, defs, item().id, '만세 흔들기')
    if (typeof c === 'string') throw new Error(c)
    expect(c).toMatchObject({ name: '만세 흔들기', robot: 'go2', length: item().trimOut - item().trimIn })
    for (const f of [0, 70, 100, 200]) evaluateClip(c, go2, f).q.forEach((v, i) => expect(v).toBeCloseTo(evaluate(s().project, defs, actor, item().start + f).q[i], 3))
    const w = s().addWalk(actor, { to: [3, 0], face: 'keep' }, 240)
    if (w) expect(pieceBlock(s().project, defs, w, 'x')).toMatch(/걷기/)
    const u = { id: 'u', name: c.name, robot: c.robot, clip: c, savedAt: 0 }
    const first = blockClip(s().project, u)
    expect(first.have).toBe(false)
    s().addClip(first.clip)
    expect(blockClip(s().project, u)).toMatchObject({ have: true, clip: { id: first.clip.id } })
  })
})

describe('부위 얹기 — G1 팔', () => {
  test('G1: an arm of one clip laid on another (덮어쓰기): only that arm moves', () => {
    const joints = defs.g1.joints, mk = (id: string, k: number): Clip => {
      const poses: Pose[] = Array.from({ length: 200 }, (_, i) => ({ rootPos: [0, 0, 0.79], rootQuat: [0, 0, 0, 1], q: joints.map((_, j) => 0.2 * Math.sin(i / 20 + j * k)) }))
      return { ...posesToClip(poses, 60, 'g1', defs, id), id }
    }
    const st = createEditorStore(defs, emptyProject()), s = () => st.getState()
    s().appendClip(null, mk('base', 1)); s().addClip(mk('arms', 3))
    const actor = s().project.actors[0].id, it = s().project.sequence.tracks.flatMap(t => t.items)[0], src = Object.values(s().project.clips).find(c => c.name === 'arms')!
    const before = evaluate(s().project, defs, actor, 100).q
    expect(s().setOverlay(it.id, { id: 'g', src: src.id, srcA: 0, srcB: 200, at: 40, len: 120, parts: ['왼팔'], mode: 'replace', weight: 1, fade: 20 })).toBe(true)
    const after = evaluate(s().project, defs, actor, 100).q, arm = partJoints(defs.g1, ['왼팔'])
    after.forEach((v, i) => arm.includes(i) ? expect(v).toBeCloseTo(evaluateClip(src, defs.g1, 60).q[i], 6) /* source frame 100 − at */ : expect(v).toBeCloseTo(before[i], 9))
  })
})
