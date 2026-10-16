import fs from 'node:fs'
import { loadDef } from '../test/defs'
import { expect, test } from 'vitest'
import { csvToClip } from '../export/importCsv'
import { evaluateClip } from './pose'
import { appendRestPose, tailOf } from './restPose'
import { footContact, footMat, legsOf, rootMat } from './legIk'
import { quatToEuler } from './rootMath'

// 끝 기본자세 across a real dance (assets/data, G1): end a piece every 400 frames and check the tail the editor makes (전이 then
// 정지 0.5 s): feet do not slide, sink or hang in the air, joints within their speed limits, the body does not drift, the last
// 0.5 s is the standing pose.
const defs = { g1: loadDef('g1'), go2: loadDef('go2') }, g1 = defs.g1
const clip = csvToClip(fs.readFileSync('assets/data/Track1_원본_합본.csv', 'utf8'), defs, undefined, 'track1')
const legs = legsOf(g1), fc = footContact(clip, g1)!, ground = fc.ground

function measure(b: number) {
  const tl = tailOf({ id: 'x', refId: clip.id, start: 0, trimIn: b - 300, trimOut: b, restTail: true }, clip, g1)
  const r = appendRestPose(clip, g1, b - 300, b, tl.hold, tl.blend)
  const feet: number[][][] = [], qs: number[][] = [], xy: number[][] = []
  for (let k = -1; k < tl.tail; k++) {
    const p = evaluateClip(r, g1, b + k), [ro, pi, ya] = quatToEuler(p.rootQuat)
    const root = rootMat(p.rootPos[0], p.rootPos[1], p.rootPos[2], ro, pi, ya)
    feet.push(legs.map(l => { const m = footMat(l, root, p.q); return [m[3], m[7], m[11]] })); qs.push(p.q); xy.push([p.rootPos[0], p.rootPos[1], ya])
  }
  const m = { slide: 0, hang: 0, sink: 0, speed: 0, drift: 0, rest: 0, stop: 0 }, run = legs.map(() => 0)
  for (let k = 1; k < feet.length; k++) {
    feet[k].forEach((f, i) => {
      const g = feet[k - 1][i], d = Math.hypot(f[0] - g[0], f[1] - g[1], f[2] - g[2])
      if (f[2] < ground + 0.01 && g[2] < ground + 0.01) m.slide = Math.max(m.slide, Math.hypot(f[0] - g[0], f[1] - g[1]))
      m.sink = Math.max(m.sink, ground - f[2])
      run[i] = d < 0.001 && f[2] > ground + 0.05 ? run[i] + 1 : 0
      m.hang = Math.max(m.hang, run[i])
    })
    m.speed = Math.max(m.speed, ...qs[k].map((v, j) => Math.abs(v - qs[k - 1][j]) * 60 / g1.joints[j].velocity))
    m.drift = Math.max(m.drift, Math.hypot(xy[k][0] - xy[0][0], xy[k][1] - xy[0][1]), Math.abs(xy[k][2] - xy[0][2]))
  }
  // the step into the 정지 (user: 전이 → 기본자세 looked off: a nearly straight knee came in at full speed and stopped dead)
  const h = feet.length - tl.hold
  m.stop = Math.max(...qs[h - 1].map((v, j) => Math.abs(v - qs[h - 2][j]))) * 180 / Math.PI
  for (let k = feet.length - tl.hold; k < feet.length; k++) m.rest = Math.max(m.rest, ...qs[k].map((v, j) => Math.abs(v - g1.rest.q[j])))
  return { tl, m, air: !fc.support[b - 1] }
}

test('끝 기본자세 across Track1: no slide, hang, sink, drift or over-speed; settles into standing', () => {
  const ends = Array.from({ length: Math.floor((clip.length - 400) / 400) }, (_, i) => 400 + i * 400)
  let checked = 0
  for (const b of ends) {
    const { tl, m, air } = measure(b), at = `end ${b} (전이 ${tl.blend})`
    expect(m.rest, `${at} last 0.5 s = 기본자세`).toBeLessThan(1e-6)
    expect(m.drift, `${at} drift`).toBeLessThan(1e-6)
    expect(m.stop, `${at} last 전이 step (°/frame)`).toBeLessThan(1) // was 3–4 before the hand-over
    if (!air) checked++
    expect(m.slide, `${at} slide`).toBeLessThan(0.003)
    // a piece that ends with a foot in the air sets it down during the 전이, one foot after another: it may wait up there a moment
    expect(m.hang, `${at} hang`).toBeLessThanOrEqual(air ? 15 : 3)
    expect(m.sink, `${at} sink`).toBeLessThan(0.008)
    if (!tl.blendOver) expect(m.speed, `${at} joint speed`).toBeLessThanOrEqual(1)
  }
  expect(checked).toBeGreaterThan(ends.length * 0.25) // both feet down at the end
}, 120_000)
