import { capNorm, interpRow, pctBW, pdTorque, rotErrLocal } from './control'
import { groupOf, type PhysicsSettings } from './settings'
import type { Segment } from './segments'
import { warnSegments } from './segments'

type Q = [number, number, number, number]
type V3 = [number, number, number]
export type Robot = 'g1' | 'go2'
export interface ModelFiles { scene: Uint8Array; meshes: { name: string; data: Uint8Array }[] }
export interface Loaded { mj: any; m: any; d: any; robot: Robot }

// FS.writeFile, not MjVFS.addBuffer (per-byte Embind copy: tens of seconds for 19 MB)
export async function loadModel(mj: any, robot: Robot, files: ModelFiles): Promise<Loaded> {
  mj.FS.mkdirTree(`/${robot}/meshes`)
  for (const f of files.meshes) mj.FS.writeFile(`/${robot}/meshes/${f.name}`, f.data)
  mj.FS.writeFile(`/${robot}/scene.xml`, files.scene)
  const m = mj.MjModel.from_xml_path(`/${robot}/scene.xml`)
  m.opt.timestep = 0.002
  return { mj, m, d: new mj.MjData(m), robot }
}

export interface Metrics {
  n: number
  forceN: Float32Array; torqueNm: Float32Array; pct: Float32Array
  pelvisZ: Float32Array; trackErrMax: Float32Array; satJoints: Uint8Array
  meanPct: number; maxPct: number; segments: Segment[]
}

const DT = 0.002, FPS = 60, FMAX = 4000, TMAX = 600

export function simulate(L: Loaded, rows: Float64Array[], s: PhysicsSettings, onProgress?: (done: number, total: number) => void): Metrics {
  const { mj, m, d, robot } = L, n = rows.length
  if (n < 2) throw new Error('물리 검증에는 2프레임 이상 필요합니다')
  const rp = s[robot], A = s.assist, nu = m.nu
  let PELVIS = -1 // root = body owning the freejoint
  for (let j = 0; j < m.njnt; j++) if (m.jnt_type[j] === 0) PELVIS = m.jnt_bodyid[j]
  const bname = (b: number) => mj.mj_id2name(m, mj.mjtObj.mjOBJ_BODY.value, b) ?? ''
  const soles: number[] = []
  for (let g = 0; g < m.ngeom; g++) if (m.geom_type[g] === 2 && /(ankle_roll_link|foot|calf)$/.test(bname(m.geom_bodyid[g]))) soles.push(g)

  const KP = new Float64Array(nu), KD = new Float64Array(nu), LIM = new Float64Array(nu), QADR = new Int32Array(nu), VADR = new Int32Array(nu)
  for (let i = 0; i < nu; i++) {
    const j = m.actuator_trnid[2 * i], g = rp.groups[groupOf(robot, mj.mj_id2name(m, mj.mjtObj.mjOBJ_JOINT.value, j))]
    KP[i] = g.kp; KD[i] = g.kd
    m.actuator_gainprm[i * 10] = 1; m.actuator_biasprm[i * 10 + 1] = 0; m.actuator_biasprm[i * 10 + 2] = 0
    QADR[i] = m.jnt_qposadr[j]; VADR[i] = m.jnt_dofadr[j]; LIM[i] = (m.jnt_actfrcrange[2 * j + 1] || m.actuator_ctrlrange[2 * i + 1]) * rp.torqueScale // GO2 motors: only ctrlrange
    if (!(LIM[i] > 0)) throw new Error('액추에이터 토크 한계가 없습니다')
  }
  const { qpos, qvel, ctrl, xfrc, geom_xpos, xmat } = { qpos: d.qpos, qvel: d.qvel, ctrl: d.ctrl, xfrc: d.xfrc_applied, geom_xpos: d.geom_xpos, xmat: d.xmat }

  mj.mj_resetData(m, d)
  const r0 = rows[0]
  qpos[0] = r0[4]; qpos[1] = r0[5]; qpos[2] = r0[6]
  qpos[3] = r0[10]; qpos[4] = r0[7]; qpos[5] = r0[8]; qpos[6] = r0[9] // CSV xyzw -> MuJoCo wxyz
  for (let i = 0; i < nu; i++) qpos[QADR[i]] = r0[11 + i]
  mj.mj_forward(m, d)
  let zmin = Infinity
  for (const g of soles) zmin = Math.min(zmin, geom_xpos[g * 3 + 2] - m.geom_size[g * 3])
  qpos[2] -= zmin; const zOff = -zmin
  mj.mj_forward(m, d)

  const qref = new Float64Array(nu), dqref = new Float64Array(nu)
  let sat = 0
  const pd = () => {
    sat = 0
    for (let i = 0; i < nu; i++) {
      const { tau, sat: x } = pdTorque(KP[i], KD[i], qref[i], qpos[QADR[i]], dqref[i], qvel[VADR[i]], LIM[i])
      ctrl[i] = tau; if (x) sat++
    }
  }
  // F = kpF(p_ref-p) + kdF(v_ref-v), T = kpT*rotErr + kdT(w_ref-w), capped; returns [|F|, |T|]
  const assist = (pref: number[], vref: number[], qr: Q, wref: number[]): [number, number] => {
    const F = capNorm([0, 1, 2].map(k => A.kpF * (pref[k] - qpos[k]) + A.kdF * (vref[k] - qvel[k])) as V3, FMAX)
    const e = rotErrLocal([qpos[3], qpos[4], qpos[5], qpos[6]], qr)
    const Tl = [0, 1, 2].map(k => A.kpT * e[k] + A.kdT * (wref[k] - qvel[3 + k]))
    const o = PELVIS * 9
    const T = capNorm([0, 1, 2].map(r => xmat[o + r * 3] * Tl[0] + xmat[o + r * 3 + 1] * Tl[1] + xmat[o + r * 3 + 2] * Tl[2]) as V3, TMAX)
    for (let c = 0; c < 3; c++) { xfrc[PELVIS * 6 + c] = F[c]; xfrc[PELVIS * 6 + 3 + c] = T[c] }
    return [Math.hypot(...F), Math.hypot(...T)]
  }
  const wxyz = (r: Float64Array): Q => [r[10], r[7], r[8], r[9]]

  for (let i = 0; i < nu; i++) qref[i] = r0[11 + i]
  const p0 = [r0[4], r0[5], r0[6] + zOff], zero = [0, 0, 0]
  for (let k = 0; k < 0.2 / DT; k++) { pd(); assist(p0, zero, wxyz(r0), zero); mj.mj_step(m, d) }

  const forceN = new Float32Array(n), torqueNm = new Float32Array(n), pelvisZ = new Float32Array(n), trackErrMax = new Float32Array(n), satJoints = new Uint8Array(n)
  const nSteps = Math.floor((n - 1) / FPS / DT)
  let next = 0, fmax = 0, tmax = 0, smax = 0
  for (let k = 0; k <= nSteps; k++) {
    const tf = k * DT * FPS, { i, u } = interpRow(rows, tf), a = rows[i], b = rows[i + 1]
    for (let j = 0; j < nu; j++) { qref[j] = a[11 + j] + (b[11 + j] - a[11 + j]) * u; dqref[j] = (b[11 + j] - a[11 + j]) * FPS }
    const pref = [0, 1, 2].map(c => a[4 + c] + (b[4 + c] - a[4 + c]) * u), vref = [0, 1, 2].map(c => (b[4 + c] - a[4 + c]) * FPS)
    pref[2] += zOff
    const wref = rotErrLocal(wxyz(a), wxyz(b)).map(v => v * FPS)
    const [f, t] = assist(pref, vref, wxyz(a), wref); fmax = Math.max(fmax, f); tmax = Math.max(tmax, t)
    pd(); smax = Math.max(smax, sat)
    if (tf >= next - 1e-9 && next < n) {
      const r = rows[next]; let e = 0
      for (let j = 0; j < nu; j++) e = Math.max(e, Math.abs(qpos[QADR[j]] - r[11 + j]))
      forceN[next] = fmax; torqueNm[next] = tmax; pelvisZ[next] = qpos[2]; trackErrMax[next] = e; satJoints[next] = smax
      fmax = tmax = smax = 0
      if (next % 60 === 0) onProgress?.(next, n)
      next++
    }
    mj.mj_step(m, d)
  }
  for (let f = next; f < n; f++) { forceN[f] = forceN[f - 1]; torqueNm[f] = torqueNm[f - 1]; pelvisZ[f] = pelvisZ[f - 1]; trackErrMax[f] = trackErrMax[f - 1]; satJoints[f] = satJoints[f - 1] }
  let mass = 0; for (let b = 0; b < m.nbody; b++) mass += m.body_mass[b]
  const pct = forceN.map(f => pctBW(f, mass))
  let sum = 0, mx = 0; for (const p of pct) { sum += p; mx = Math.max(mx, p) }
  return { n, forceN, torqueNm, pct, pelvisZ, trackErrMax, satJoints, meanPct: sum / n, maxPct: mx, segments: warnSegments(pct, torqueNm, rp.warnPct) }
}
