import fs from 'node:fs'
import { loadDef } from '../test/defs'
import { expect, test } from 'vitest'
import { csvToClip } from '../export/importCsv'
import { evaluateClip } from './pose'
import { leadOf, prependRestPose } from './restPose'
import { footContact, footMat, legsOf, rootMat } from './legIk'
import { quatToEuler } from './rootMath'

// Regression sweep over a real dance (assets/data, G1): cut it every 400 frames, 덧붙이기 with auto 관성 and several 전이 lengths,
// and check the frames the editor makes (기본자세 + 전이) and the seam into the motion. User: "앞으로 자를 때 이런 일 없도록" —
// feet must not slide, hang still in the air, sink, or jump; joints stay within their speed limits.
const defs = { g1: loadDef('g1'), go2: loadDef('go2') }, g1 = defs.g1
const clip = csvToClip(fs.readFileSync('assets/data/Track1_원본_합본.csv', 'utf8'), defs, undefined, 'track1')
const legs = legsOf(g1), ground = footContact(clip, g1)!.ground

function measure(c: number, blend?: number | 'auto') {
  const ld = leadOf({ id: 'x', refId: clip.id, start: 0, trimIn: c, trimOut: c + 300, restPose: 'prepend', restBlend: blend }, clip, g1)
  const a = c - ld.inertia, r = prependRestPose(clip, g1, a, ld.hold, ld.blend), G = ld.hold + ld.blend, n = G + 12
  const feet: number[][][] = [], qs: number[][] = []
  for (let k = 0; k < n; k++) {
    const p = evaluateClip(r, g1, a + k), [ro, pi, ya] = quatToEuler(p.rootQuat)
    const root = rootMat(p.rootPos[0], p.rootPos[1], p.rootPos[2], ro, pi, ya)
    feet.push(legs.map(l => { const m = footMat(l, root, p.q); return [m[3], m[7], m[11]] })); qs.push(p.q)
  }
  const acc = (k: number, i: number) => Math.hypot(...[0, 1, 2].map(c2 => feet[k][i][c2] - 2 * feet[k - 1][i][c2] + feet[k - 2][i][c2]))
  const m = { slide: 0, hang: 0, sink: 0, speed: 0, genAcc: 0, seamAcc: 0, ownAcc: 0 }, run = legs.map(() => 0)
  for (let k = 1; k <= G; k++) {
    feet[k].forEach((f, i) => {
      const g = feet[k - 1][i], d = Math.hypot(f[0] - g[0], f[1] - g[1], f[2] - g[2])
      if (f[2] < ground + 0.01 && g[2] < ground + 0.01) m.slide = Math.max(m.slide, Math.hypot(f[0] - g[0], f[1] - g[1])) // on the floor
      m.sink = Math.max(m.sink, ground - f[2])
      run[i] = d < 0.001 && f[2] > ground + 0.05 ? run[i] + 1 : 0 // standing still in the air (on tiptoe counts as standing)
      m.hang = Math.max(m.hang, run[i])
      if (k >= 2 && k < G - 1) m.genAcc = Math.max(m.genAcc, acc(k, i))
    })
    m.speed = Math.max(m.speed, ...qs[k].map((v, j) => Math.abs(v - qs[k - 1][j]) * 60 / g1.joints[j].velocity))
  }
  legs.forEach((_, i) => {
    for (const k of [G - 1, G, G + 1]) m.seamAcc = Math.max(m.seamAcc, acc(k, i))
    for (let k = G + 3; k < n; k++) m.ownAcc = Math.max(m.ownAcc, acc(k, i)) // the motion's own foot acceleration right after
  })
  return { ld, m }
}

const cuts = Array.from({ length: Math.floor((clip.length - 400) / 400) }, (_, i) => 200 + i * 400)
for (const blend of [undefined, 30, 120, 'auto'] as const) {
  test(`lead-ins across Track1 (전이 ${blend ?? 60}): no slide, hang, sink, jump or over-speed`, () => {
    let checked = 0
    for (const c of cuts) {
      const { ld, m } = measure(c, blend), at = `cut ${c} (관성 ${ld.inertia}, ${ld.why})`
      if (ld.why === 'air') { expect(ld.airborne, at).toBe(true); continue } // no feet-down frame near the cut: flagged in the UI instead
      expect(ld.airborne, at).toBe(false)
      if (blend === 'auto') expect(ld.stepFast, `${at} 전이 자동 leaves time for the steps`).toBe(false)
      if (ld.stepFast) { expect(blend, at).toBe(30); continue } // too short for its steps: flagged (⚠ 걸음이 빠름)
      checked++
      expect(m.slide, `${at} slide`).toBeLessThan(0.003)
      expect(m.hang, `${at} hang`).toBeLessThanOrEqual(3)
      expect(m.sink, `${at} sink`).toBeLessThan(0.008)
      expect(m.speed, `${at} joint speed`).toBeLessThanOrEqual(1)
      const short = Math.max(1, 60 / ld.blend) // a shorter 전이 steps quicker
      expect(m.genAcc, `${at} foot acceleration in the 전이`).toBeLessThan(0.012 * short)
      expect(m.seamAcc, `${at} foot acceleration at the seam`).toBeLessThan(Math.max(0.006 * short, 1.5 * m.ownAcc))
    }
    expect(checked).toBeGreaterThan(cuts.length * (blend === 30 ? 0.2 : 0.8))
  }, 120_000)
}
