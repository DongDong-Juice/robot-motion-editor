// Writes the synthetic test files in assets/examples/ (CSV in each import format, error cases, a project file).
// Run: node tools/make_examples.mjs
// The motions are kinematically consistent: feet are planned (planted while in stance, lifted on an arc while swinging)
// and the leg joints come from IK on the URDF chains, so nothing slides; arms/waist are set directly.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'

const root = new URL('../', import.meta.url)
const out = new URL('assets/examples/', root)
mkdirSync(out, { recursive: true })
const readJson = p => JSON.parse(readFileSync(new URL(p, root), 'utf8'))
const FPS = 60, PI = Math.PI, sin = Math.sin, cos = Math.cos
const ease = x => { const t = Math.min(1, Math.max(0, x)); return t * t * (3 - 2 * t) }

// ---- 4x4 row-major transforms (URDF: translate(xyz) * Rz(yaw) Ry(pitch) Rx(roll), joint = Rodrigues about axis)
const mul = (a, b) => { const r = new Array(16).fill(0); for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) for (let k = 0; k < 4; k++) r[i * 4 + j] += a[i * 4 + k] * b[k * 4 + j]; return r }
function originMat([x, y, z], [r, p, w]) {
  const [cr, sr, cp, sp, cy, sy] = [cos(r), sin(r), cos(p), sin(p), cos(w), sin(w)]
  return [cy * cp, cy * sp * sr - sy * cr, cy * sp * cr + sy * sr, x, sy * cp, sy * sp * sr + cy * cr, sy * sp * cr - cy * sr, y, -sp, cp * sr, cp * cr, z, 0, 0, 0, 1]
}
function axisMat([x, y, z], q) {
  const c = cos(q), s = sin(q), t = 1 - c
  return [t * x * x + c, t * x * y - s * z, t * x * z + s * y, 0, t * x * y + s * z, t * y * y + c, t * y * z - s * x, 0, t * x * z - s * y, t * y * z + s * x, t * z * z + c, 0, 0, 0, 0, 1]
}

function loadRobot(kind) {
  const model = readJson(`public/robots/${kind}/model.json`), meshes = readJson(`public/robots/${kind}/meshes.json`)
  const joints = model.joints.filter(j => j.type === 'revolute' || j.type === 'fixed')
  const revolute = joints.filter(j => j.type === 'revolute')
  const byChild = Object.fromEntries(joints.map(j => [j.child, j]))
  const chain = link => { const c = []; for (let l = link; byChild[l]; l = byChild[l].parent) c.unshift(byChild[l]); return c }
  const chains = {}
  const linkMat = (b, q, link) => (chains[link] ??= chain(link)).reduce((m, j) => {
    const o = mul(m, originMat(j.xyz, j.rpy))
    return j.type === 'revolute' && q[j.name] ? mul(o, axisMat(j.axis, q[j.name])) : o
  }, originMat([b.x, b.y, b.z], [b.roll, b.pitch, b.yaw]))
  const pos = {}
  const positions = name => pos[name] ??= new Float32Array(new Uint8Array(Buffer.from(meshes[name].pos, 'base64')).buffer)
  // lowest mesh point with the root at the origin (the floor height of a pose)
  const lowest = q => {
    let min = Infinity
    for (const [name, l] of Object.entries(model.links)) {
      if (!l.mesh || !meshes[l.mesh]) continue
      const m = mul(linkMat(ORIGIN, q, name), originMat(l.xyz, l.rpy)), s = l.scale ?? [1, 1, 1], p = positions(l.mesh)
      for (let i = 0; i < p.length; i += 3) min = Math.min(min, m[8] * p[i] * s[0] + m[9] * p[i + 1] * s[1] + m[10] * p[i + 2] * s[2] + m[11])
    }
    return min
  }
  return { kind, names: revolute.map(j => j.name), lim: Object.fromEntries(revolute.map(j => [j.name, [j.lower, j.upper]])), linkMat, lowest }
}
const ORIGIN = { x: 0, y: 0, z: 0, roll: 0, pitch: 0, yaw: 0 }
const P3 = m => [m[3], m[7], m[11]]

function solve(A, b) { // small dense Ax = b (Gaussian elimination, partial pivot)
  const n = b.length, M = A.map((r, i) => [...r, b[i]])
  for (let c = 0; c < n; c++) {
    let p = c; for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r
    ;[M[c], M[p]] = [M[p], M[c]]
    for (let r = 0; r < n; r++) if (r !== c) { const f = M[r][c] / M[c][c]; for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k] }
  }
  return M.map((r, i) => r[n] / r[i])
}

// Damped least squares IK: move `js` so `link` reaches `target` (and, with `yaw` set, lies flat facing that yaw).
function ik(R, b, q, js, link, target, yaw) {
  q = { ...q }
  for (const j of js) q[j] ??= 0
  const err = qq => {
    const m = R.linkMat(b, qq, link), p = P3(m), e = [p[0] - target[0], p[1] - target[1], p[2] - target[2]]
    if (yaw === undefined) return e
    const c = cos(yaw), s = sin(yaw) // R_err = R * Rz(yaw)^T, small-angle rotation vector
    const r = [[m[0] * c - m[1] * s, m[0] * s + m[1] * c, m[2]], [m[4] * c - m[5] * s, m[4] * s + m[5] * c, m[6]], [m[8] * c - m[9] * s, m[8] * s + m[9] * c, m[10]]]
    return [...e, 0.5 * (r[2][1] - r[1][2]), 0.5 * (r[0][2] - r[2][0]), 0.5 * (r[1][0] - r[0][1])]
  }
  for (let it = 0; it < 60; it++) {
    const e = err(q)
    if (Math.hypot(...e) < 1e-8) break
    const J = js.map(j => { const d = { ...q, [j]: q[j] + 1e-6 }; return err(d).map((v, i) => (v - e[i]) / 1e-6) }) // columns
    const JtJ = js.map((_, a) => js.map((_, c) => J[a].reduce((s, v, i) => s + v * J[c][i], 0) + (a === c ? 1e-6 : 0)))
    const dq = solve(JtJ, js.map((_, a) => -J[a].reduce((s, v, i) => s + v * e[i], 0)))
    js.forEach((j, a) => { const [lo, hi] = R.lim[j]; q[j] = Math.min(hi, Math.max(lo, q[j] + dq[a])) })
  }
  return { q, res: Math.hypot(...err(q).slice(0, 3)) }
}

// Foot plan: each foot holds its position (stance) except during its steps, where it moves on a lifted arc.
function footAt(foot, t, lift) {
  let p = foot.start, yaw = foot.yaw0
  for (const s of foot.steps) {
    if (t >= s.t1) { p = s.to; yaw = s.yaw; continue }
    if (t > s.t0) {
      const u = ease((t - s.t0) / (s.t1 - s.t0)), h = lift * sin(PI * (t - s.t0) / (s.t1 - s.t0)), y = yaw + (s.yaw - yaw) * u
      if (s.home) { // move the body-centre point the foot hangs from and turn around it, so a turning step swings on an arc
        const [ax, ay] = rot(yaw, s.home), [bx, by] = rot(s.yaw, s.home), [hx, hy] = rot(y, s.home)
        const cx = p[0] - ax + (s.to[0] - bx - p[0] + ax) * u, cy = p[1] - ay + (s.to[1] - by - p[1] + ay) * u
        return { p: [cx + hx, cy + hy, p[2] + h], yaw: y, swing: true }
      }
      return { p: [p[0] + (s.to[0] - p[0]) * u, p[1] + (s.to[1] - p[1]) * u, p[2] + h], yaw: y, swing: true }
    }
    break
  }
  return { p, yaw, swing: false }
}
const rot = (yaw, [x, y]) => [cos(yaw) * x - sin(yaw) * y, sin(yaw) * x + cos(yaw) * y]

// ---- robots, standing poses and floor heights
const G1 = loadRobot('g1'), GO2 = loadRobot('go2')
const G1_LEGS = ['left', 'right'].map(s => ({ side: s, link: `${s}_ankle_roll_link`, js: ['hip_pitch', 'hip_roll', 'hip_yaw', 'knee', 'ankle_pitch', 'ankle_roll'].map(n => `${s}_${n}_joint`) }))
const G1_H0 = -G1.lowest({}) // straight legs, flat feet: root height with the soles on the floor
const G1_Z = G1_H0 - 0.05 // walk with the knees a little bent
const G1_HOME = Object.fromEntries(G1_LEGS.map(l => [l.side, P3(G1.linkMat({ ...ORIGIN, z: G1_H0 }, {}, l.link))])) // [x, y, ankle height]
const G1_ARMS = { left_shoulder_roll_joint: 0.12, right_shoulder_roll_joint: -0.12, left_elbow_joint: 1.35, right_elbow_joint: 1.35 }

const GO2_LEGS = ['FL', 'FR', 'RL', 'RR'].map(l => ({ side: l, link: `${l}_foot`, js: ['hip', 'thigh', 'calf'].map(n => `${l}_${n}_joint`) }))
const GO2_REST = Object.fromEntries(GO2_LEGS.flatMap(l => [[`${l.side}_thigh_joint`, l.side[0] === 'F' ? 0.8 : 1.0], [`${l.side}_calf_joint`, -1.5]]))
const GO2_Z = -GO2.lowest(GO2_REST)
const GO2_HOME = Object.fromEntries(GO2_LEGS.map(l => [l.side, P3(GO2.linkMat({ ...ORIGIN, z: GO2_Z }, GO2_REST, l.link))]))

// Build a motion: per frame body pose + extra joints, feet from the plan, legs from IK (seeded by the previous frame).
function build(R, legs, { T, body, extra = () => ({}), feet, lift, flat }, seed) {
  const n = Math.round(T * FPS), frames = []
  let q = { ...seed }, worst = 0, slide = 0
  const prevStance = {}
  for (let i = 0; i < n; i++) {
    const t = i / FPS, b = { ...ORIGIN, ...body(t) }
    q = { ...q, ...extra(t) }
    for (const l of legs) {
      const f = footAt(feet[l.side], t, lift)
      const r = ik(R, b, q, l.js, l.link, f.p, flat ? f.yaw : undefined)
      q = r.q; worst = Math.max(worst, r.res)
      const at = P3(R.linkMat(b, q, l.link)) // planted feet must not move between frames
      if (!f.swing && prevStance[l.side]) slide = Math.max(slide, Math.hypot(at[0] - prevStance[l.side][0], at[1] - prevStance[l.side][1], at[2] - prevStance[l.side][2]))
      prevStance[l.side] = f.swing ? null : at
    }
    frames.push({ ...b, q: { ...q } })
  }
  return { robot: R.kind, frames, worst, slide }
}

// Walking gait: body speeds up to `v` and back to 0 over [t0, t1]; feet step in `order` every `period`, landing ahead
// of their home spot by half the distance the body covers while they stand, then a closing step puts them home.
function gait({ v, t0, t1, period, swing, order, homes, yaw = () => 0, yawRate = () => 0 }) {
  const dt = 1 / FPS, xs = [0]
  const speed = t => v * ease((t - t0) / 0.5) * ease((t1 - t) / 0.5)
  for (let t = 0; t < 20; t += dt) xs.push(xs.at(-1) + speed(t) * dt)
  const xAt = t => xs[Math.min(xs.length - 1, Math.max(0, Math.round(t / dt)))]
  const feet = Object.fromEntries(Object.entries(homes).map(([k, h]) => [k, { start: [h[0], h[1], h[2]], yaw0: 0, steps: [] }]))
  const stand = period - swing
  let t = t0, end = t0
  for (let k = 0; t < t1; k++, t += period / order.length) {
    for (const side of order[k % order.length]) {
      const ts = t + swing, y = yaw(ts) + yawRate(ts) * stand / 2, [hx, hy] = rot(y, homes[side]) // land ahead (x and yaw) by half the stance
      feet[side].steps.push({ t0: t, t1: ts, to: [xAt(ts) + hx + speed(ts) * stand / 2, hy, homes[side][2]], yaw: y, home: homes[side] })
      end = ts
    }
  }
  const xEnd = xAt(30), yEnd = yaw(30) // closing steps: every foot back under the stopped body
  for (const group of order) {
    let moved = false
    for (const side of group) {
      const [hx, hy] = rot(yEnd, homes[side]), last = feet[side].steps.at(-1)?.to ?? feet[side].start
      if (Math.hypot(last[0] - xEnd - hx, last[1] - hy) < 0.005) continue
      feet[side].steps.push({ t0: end, t1: end + swing, to: [xEnd + hx, hy, homes[side][2]], yaw: yEnd, home: homes[side] }); moved = true
    }
    if (moved) end += swing
  }
  return { feet, xAt, T: end + 0.5 }
}
const fixedFeet = homes => Object.fromEntries(Object.entries(homes).map(([k, h]) => [k, { start: h, yaw0: 0, steps: [] }]))
const g1Seed = { left_hip_pitch_joint: -0.2, right_hip_pitch_joint: -0.2, left_knee_joint: 0.4, right_knee_joint: 0.4, left_ankle_pitch_joint: -0.2, right_ankle_pitch_joint: -0.2 }

// ---- motions
const walkPlan = gait({ v: 0.4, t0: 0.5, t1: 3.0, period: 1.0, swing: 0.5, order: [['left'], ['right']], homes: G1_HOME })
const walkPhase = t => PI * (t - 0.5) / 0.5 // + while the left leg swings
const walk = build(G1, G1_LEGS, {
  T: walkPlan.T, lift: 0.07, flat: true, feet: walkPlan.feet,
  body: t => { const a = ease((t - 0.5) / 0.4) * ease((walkPlan.T - 0.6 - t) / 0.4); return { x: walkPlan.xAt(t), y: -0.025 * a * sin(walkPhase(t)), z: G1_Z } },
  extra: t => { const a = ease((t - 0.5) / 0.4) * ease((walkPlan.T - 0.6 - t) / 0.4), s = 0.35 * a * sin(walkPhase(t))
    return { ...G1_ARMS, left_shoulder_pitch_joint: s, right_shoulder_pitch_joint: -s, waist_yaw_joint: -0.08 * a * sin(walkPhase(t)) } },
}, g1Seed)

const turnYaw = t => (PI / 2) * ease((t - 0.5) / 3.2), turnRate = t => (turnYaw(t + 0.01) - turnYaw(t - 0.01)) / 0.02
const turnPlan = gait({ v: 0, t0: 0.5, t1: 3.5, period: 0.8, swing: 0.4, order: [['left'], ['right']], homes: G1_HOME, yaw: turnYaw, yawRate: turnRate })
const turn = build(G1, G1_LEGS, {
  T: turnPlan.T, lift: 0.05, flat: true, feet: turnPlan.feet,
  body: t => ({ z: G1_Z, yaw: turnYaw(t) }), extra: () => G1_ARMS,
}, g1Seed)

const wave = (elbowPeak = 1.6) => build(G1, G1_LEGS, {
  T: 3, lift: 0, flat: true, feet: fixedFeet(G1_HOME),
  body: t => ({ z: G1_Z, y: 0.01 * ease(t / 0.5) * ease((3 - t) / 0.5) }),
  extra: t => { const a = ease(t / 0.5) * ease((3 - t) / 0.5)
    return { ...G1_ARMS, right_shoulder_roll_joint: -0.12 - 1.3 * a, right_shoulder_pitch_joint: -0.3 * a, right_elbow_joint: 1.35 + (elbowPeak - 1.35) * a,
      right_shoulder_yaw_joint: 0.4 * a * sin(2 * PI * 1.5 * t), waist_roll_joint: 0.04 * a } },
}, g1Seed)

const squat = build(G1, G1_LEGS, {
  T: 3, lift: 0, flat: true, feet: fixedFeet(G1_HOME),
  body: t => { const d = (1 - cos(2 * PI * t / 3)) / 2; return { z: G1_Z - 0.2 * d, x: -0.04 * d } },
  extra: t => { const d = (1 - cos(2 * PI * t / 3)) / 2; return { ...G1_ARMS, waist_pitch_joint: 0.3 * d, left_shoulder_pitch_joint: -0.9 * d, right_shoulder_pitch_joint: -0.9 * d } },
}, g1Seed)

const trotPlan = gait({ v: 0.4, t0: 0.5, t1: 3.0, period: 0.5, swing: 0.25, order: [['FL', 'RR'], ['FR', 'RL']], homes: GO2_HOME })
const trot = build(GO2, GO2_LEGS, {
  T: trotPlan.T, lift: 0.06, flat: false, feet: trotPlan.feet,
  body: t => ({ x: trotPlan.xAt(t), z: GO2_Z }),
}, GO2_REST)

const sit = build(GO2, GO2_LEGS, {
  T: 3, lift: 0, flat: false, feet: fixedFeet(GO2_HOME),
  body: t => { const d = ease(t / 1.2) * ease((3 - t) / 1.2); return { z: GO2_Z - 0.07 * d, pitch: -0.3 * d, x: -0.04 * d } },
}, GO2_REST)

const motions = { walk, turn, wave: wave(), squat, trot, sit }
for (const [k, m] of Object.entries(motions)) console.log(`${k}: ${m.frames.length} frames, IK residual ${(m.worst * 1000).toFixed(2)} mm, planted-foot slide ${(m.slide * 1000).toFixed(2)} mm`)

// ---- CSV (RL motion format)
const J = { g1: G1.names, go2: GO2.names }, DOF = { g1: 29, go2: 12 }, TYPE = { g1: 0, go2: 1 }
const HEAD = ['frequency(fps)', 'RobotType', 'DOF Number', 'time(ms)', 'position X(m)', 'position Y(m)', 'position Z(m)',
  'quaternion X', 'quaternion Y', 'quaternion Z', 'quaternion W']
const quat = (r, p, y) => { // ZYX euler -> [x, y, z, w]
  const [cr, sr, cp, sp, cy, sy] = [cos(r / 2), sin(r / 2), cos(p / 2), sin(p / 2), cos(y / 2), sin(y / 2)]
  return [sr * cp * cy - cr * sp * sy, cr * sp * cy + sr * cp * sy, cr * cp * sy - sr * sp * cy, cr * cp * cy + sr * sp * sy]
}
const f6 = v => { const s = v.toFixed(6); return s === '-0.000000' ? '0.000000' : s }
const rowValues = (robot, f) => [f.x, f.y, f.z, ...quat(f.roll, f.pitch, f.yaw), ...J[robot].map(j => f.q[j] ?? 0)]
const at = (m, fps) => fps === 60 ? m.frames : m.frames.filter((_, i) => i % 2 === 0)
function headed(m, fps, edit = () => {}) {
  const rows = at(m, fps).map(f => ({ ...f, q: { ...f.q } }))
  rows.forEach(edit)
  return [[...HEAD, ...J[m.robot]].join(',') + ',', ...rows.map((f, i) =>
    [fps, TYPE[m.robot], DOF[m.robot], Math.round(i * 1000 / fps), ...rowValues(m.robot, f).map(f6)].join(',') + ',')].join('\n')
}
const headless = (m, fps) => at(m, fps).map(f => rowValues(m.robot, f).map(f6).join(',')).join('\n') + '\n'

const files = {
  'g1_walk.csv': headed(walk, 60),
  'g1_wave.csv': headed(motions.wave, 60),
  'g1_turn_30fps.csv': headed(turn, 30),
  'g1_squat_headless.csv': headless(squat, 30),
  'go2_trot.csv': headed(trot, 60),
  'go2_sit_headless.csv': headless(sit, 60),
  // elbow past its URDF limit (2.0944) mid-wave, and a 0.2 m root jump at frame 120
  'g1_warnings.csv': headed(wave(2.4), 60, (f, i) => { if (i >= 120) f.x += 0.2 }),
  // RobotType 1 (GO2) with DOF 29 (G1): the importer must refuse it
  'error_robot_type.csv': headed(walk, 60).replace(/^60,0,29,/gm, '60,1,29,'),
}
for (const [name, text] of Object.entries(files)) writeFileSync(new URL(name, out), text)

// ---- project: a linear key on every frame (like an imported CSV), so the clips play exactly the generated poses
const CH = ['x', 'y', 'z', 'roll', 'pitch', 'yaw']
const r6 = x => Math.round(x * 1e6) / 1e6 + 0
function clip(id, name, m) {
  const names = [...CH.map(c => `root.${c}`), ...J[m.robot]]
  const val = (f, n) => n.startsWith('root.') ? f[n.slice(5)] : f.q[n] ?? 0
  return { id, name, robot: m.robot, length: m.frames.length,
    channels: Object.fromEntries(names.map(n => [n, { k: m.frames.flatMap((f, i) => [i, r6(val(f, n)), 0, -1, 0, 1, 0]) }])) }
}
const wl = walk.frames.length, cut = Math.round(wl / 2), wv = motions.wave.frames.length
const project = {
  version: 2, fps: 60,
  actors: [
    { id: 'actor-g1', name: 'G1 #1', robot: 'g1', color: '#58B4D1', placement: { x: 0, y: 0, yaw: 0 } },
    { id: 'actor-go2', name: 'GO2 #1', robot: 'go2', color: '#C9D65A', placement: { x: 0, y: 1.5, yaw: 0 } },
  ],
  clips: Object.fromEntries([clip('clip-walk', 'walk', walk), clip('clip-wave', 'wave', motions.wave), clip('clip-trot', 'trot', trot)].map(c => [c.id, c])),
  media: [],
  sequence: {
    tracks: [
      { id: 'track-g1', kind: 'motion', actorId: 'actor-g1', hidden: false, locked: false, items: [
        // walk cut in the middle: two pieces of one clip (CSV names G1_walk_1 / _2); the first has 기본자세 덧붙이기 (its CSV gets a 90-row lead-in)
        { id: 'item-walk-1', refId: 'clip-walk', start: 0, trimIn: 0, trimOut: cut, restPose: 'prepend' },
        { id: 'item-walk-2', refId: 'clip-walk', start: cut, trimIn: cut, trimOut: wl },
        // wave overlaps the second walk piece by 20 frames (crossfade)
        { id: 'item-wave', refId: 'clip-wave', start: wl - 20, trimIn: 0, trimOut: wv },
      ] },
      { id: 'track-go2', kind: 'motion', actorId: 'actor-go2', hidden: false, locked: false, items: [
        { id: 'item-trot', refId: 'clip-trot', start: 0, trimIn: 0, trimOut: trot.frames.length },
      ] },
    ],
    markers: [{ f: cut, name: '자른 곳' }], inF: null, outF: null,
  },
}
writeFileSync(new URL('examples.mproj', out), JSON.stringify(project))
console.log(Object.keys(files).concat('examples.mproj').join('\n'))
console.log(`project: walk ${wl} frames (cut at ${cut}), wave from ${wl - 20}`)
