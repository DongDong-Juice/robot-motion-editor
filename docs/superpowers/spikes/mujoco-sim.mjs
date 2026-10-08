// Spike: G1 reference-motion physics check in MuJoCo WASM. node sim.mjs [frames=600] [--assist]
import fs from 'node:fs';
import loadMujoco from '@mujoco/mujoco';
const M = 'D:/Project/00_ROS/G1_motion_editor_인수인계_20261002/02_g1/g1-motion-editor/mujoco';
const CSV = 'D:/Project/00_ROS/motion-editor/assets/data/Track1_원본_합본.csv';
const N = +(process.argv[2] || 600), ASSIST = process.argv.includes('--assist');
const FPS = 60, DT = 0.002;

// ---- load ----
let t0 = performance.now();
const mj = await loadMujoco();
const tWasm = performance.now() - t0;
t0 = performance.now();
// MjVFS.addBuffer is 17-75 s for 19 MB (per-byte Embind copy); Emscripten FS.writeFile is ~20 ms.
mj.FS.mkdirTree('/g1/meshes');
for (const f of fs.readdirSync(M + '/meshes')) mj.FS.writeFile('/g1/meshes/' + f, fs.readFileSync(M + '/meshes/' + f));
mj.FS.writeFile('/g1/g1_scene.xml', fs.readFileSync(M + '/g1_scene.xml'));
const tRead = performance.now() - t0;
t0 = performance.now();
const m = mj.MjModel.from_xml_path('/g1/g1_scene.xml');
const tCompile = performance.now() - t0;
const d = new mj.MjData(m);
m.opt.timestep = DT;

// ---- CSV ----
const rows = fs.readFileSync(CSV, 'utf8').split('\n').slice(1).filter(l => l.trim()).slice(0, N)
  .map(l => l.split(',').slice(0, 40).map(Number));
const nF = rows.length;

// ---- actuators: position -> motor (PD computed here, ctrl = torque) ----
const nu = m.nu, KP = new Float64Array(nu), KD = new Float64Array(nu), LIM = new Float64Array(nu);
const QADR = new Int32Array(nu), VADR = new Int32Array(nu);
for (let i = 0; i < nu; i++) {
  KP[i] = m.actuator_gainprm[i * 10]; KD[i] = -m.actuator_biasprm[i * 10 + 2];
  m.actuator_gainprm[i * 10] = 1; m.actuator_biasprm[i * 10 + 1] = 0; m.actuator_biasprm[i * 10 + 2] = 0;
  const j = m.actuator_trnid[2 * i];
  QADR[i] = m.jnt_qposadr[j]; VADR[i] = m.jnt_dofadr[j]; LIM[i] = m.jnt_actfrcrange[2 * j + 1];
  // actuator i == CSV joint column 11+i (names verified in load.mjs)
}
const PELVIS = mj.mj_name2id(m, mj.mjtObj.mjOBJ_BODY.value, 'pelvis');
const footB = ['left_ankle_roll_link', 'right_ankle_roll_link'].map(n => mj.mj_name2id(m, mj.mjtObj.mjOBJ_BODY.value, n));
const soles = []; for (let g = 0; g < m.ngeom; g++) if (footB.includes(m.geom_bodyid[g]) && m.geom_type[g] === 2) soles.push(g);

const qpos = d.qpos, qvel = d.qvel, ctrl = d.ctrl, xfrc = d.xfrc_applied, geom_xpos = d.geom_xpos, xmat = d.xmat;
function setPose(r) {
  qpos[0] = r[4]; qpos[1] = r[5]; qpos[2] = r[6];
  qpos[3] = r[10]; qpos[4] = r[7]; qpos[5] = r[8]; qpos[6] = r[9]; // CSV xyzw -> MuJoCo wxyz
  for (let i = 0; i < nu; i++) qpos[QADR[i]] = r[11 + i];
}
const qref = new Float64Array(nu), dqref = new Float64Array(nu);
let satCount = 0;
function pd() {
  for (let i = 0; i < nu; i++) {
    let t = KP[i] * (qref[i] - qpos[QADR[i]]) + KD[i] * (dqref[i] - qvel[VADR[i]]);
    if (t > LIM[i]) { t = LIM[i]; satCount++; } else if (t < -LIM[i]) { t = -LIM[i]; satCount++; }
    ctrl[i] = t;
  }
}
// pelvis assist (replay.py constants). freejoint: lin vel world, ang vel local.
const KP_F = 2000, KD_F = 300, KP_T = 300, KD_T = 40, FMAX = 4000, TMAX = 600;
function assist(pref, qr /*wxyz*/) {
  let F = [0, 1, 2].map(k => KP_F * (pref[k] - qpos[k]) - KD_F * qvel[k]);
  // rotation vector of conj(q)*qr in local frame == mju_subQuat(qr, q)
  const aw = qpos[3], ax = -qpos[4], ay = -qpos[5], az = -qpos[6], bw = qr[0], bx = qr[1], by = qr[2], bz = qr[3];
  let w = aw * bw - ax * bx - ay * by - az * bz, x = aw * bx + ax * bw + ay * bz - az * by,
      y = aw * by - ax * bz + ay * bw + az * bx, z = aw * bz + ax * by - ay * bx + az * bw;
  if (w < 0) { w = -w; x = -x; y = -y; z = -z; }
  const s = Math.hypot(x, y, z), k = s > 1e-12 ? 2 * Math.atan2(s, w) / s : 2;
  const Tl = [KP_T * x * k - KD_T * qvel[3], KP_T * y * k - KD_T * qvel[4], KP_T * z * k - KD_T * qvel[5]];
  const o = PELVIS * 9;
  let T = [0, 1, 2].map(r => xmat[o + r * 3] * Tl[0] + xmat[o + r * 3 + 1] * Tl[1] + xmat[o + r * 3 + 2] * Tl[2]);
  const nf = Math.hypot(...F), nt = Math.hypot(...T);
  if (nf > FMAX) F = F.map(v => v * FMAX / nf);
  if (nt > TMAX) T = T.map(v => v * TMAX / nt);
  for (let c = 0; c < 3; c++) { xfrc[PELVIS * 6 + c] = F[c]; xfrc[PELVIS * 6 + 3 + c] = T[c]; }
  return [Math.min(nf, FMAX), Math.min(nt, TMAX)];
}

function run() {
  mj.mj_resetData(m, d);
  setPose(rows[0]); mj.mj_forward(m, d);
  let zmin = Infinity; for (const g of soles) zmin = Math.min(zmin, geom_xpos[g * 3 + 2] - m.geom_size[g * 3]);
  qpos[2] -= zmin; const zOff = -zmin; // lift so sole spheres touch the floor
  mj.mj_forward(m, d);
  for (let i = 0; i < nu; i++) { qref[i] = rows[0][11 + i]; dqref[i] = 0; }
  for (let s = 0; s < 0.2 / DT; s++) { pd(); mj.mj_step(m, d); }   // settle 0.2 s (as replay.py)
  const zSettle = qpos[2];
  satCount = 0;
  const per = [], errSq = new Float64Array(nu);
  let fall = null, drift = null, fsum = 0, fmaxAll = 0, tmaxAll = 0;
  const nSteps = Math.floor((nF - 1) / FPS / DT);
  const tStart = performance.now();
  let nextFrame = 0, fmaxF = 0;
  for (let s = 0; s <= nSteps; s++) {
    const tf = s * DT * FPS, i = Math.min(Math.floor(tf), nF - 2), u = tf - i;
    const a = rows[i], b = rows[i + 1];
    for (let j = 0; j < nu; j++) { qref[j] = a[11 + j] + (b[11 + j] - a[11 + j]) * u; dqref[j] = (b[11 + j] - a[11 + j]) * FPS; }
    if (ASSIST) {
      const pref = [0, 1, 2].map(k => a[4 + k] + (b[4 + k] - a[4 + k]) * u); pref[2] += zOff;
      const ft = assist(pref, [a[10], a[7], a[8], a[9]]); fmaxF = Math.max(fmaxF, ft[0]); tmaxAll = Math.max(tmaxAll, ft[1]);
    }
    if (tf >= nextFrame - 1e-9 && nextFrame < nF) {   // per-60fps-frame metrics vs ref frame
      const r = rows[nextFrame], w = qpos[3], x = qpos[4], y = qpos[5], z = qpos[6];
      const tilt = Math.acos(Math.max(-1, Math.min(1, 1 - 2 * (x * x + y * y)))) * 180 / Math.PI;
      const yaw = Math.atan2(2 * (w * z + x * y), 1 - 2 * (y * y + z * z));
      const rx = r[7], ry = r[8], rz = r[9], rw = r[10], yawR = Math.atan2(2 * (rw * rz + rx * ry), 1 - 2 * (ry * ry + rz * rz));
      let dy = (yaw - yawR) * 180 / Math.PI; dy = ((dy + 540) % 360) - 180;
      const xy = Math.hypot(qpos[0] - r[4], qpos[1] - r[5]);
      let e2 = 0; for (let j = 0; j < nu; j++) { const e = qpos[QADR[j]] - r[11 + j]; e2 += e * e; errSq[j] += e * e; }
      per.push({ f: nextFrame, z: qpos[2], tilt, xy, yawErr: dy, jrmsDeg: Math.sqrt(e2 / nu) * 180 / Math.PI, assistN: fmaxF });
      if (fall === null && (qpos[2] < 0.45 || tilt > 60)) fall = { f: nextFrame, z: qpos[2], tilt };
      if (drift === null && xy > 0.3) drift = { f: nextFrame, xy };
      fsum += fmaxF; fmaxAll = Math.max(fmaxAll, fmaxF); fmaxF = 0;
      nextFrame++;
    }
    pd(); mj.mj_step(m, d);
  }
  const wall = performance.now() - tStart, simSec = nSteps * DT;
  return { wall, simSec, zSettle, fall, drift, per, errSq, satRatio: satCount / (nu * nSteps), fmean: fsum / per.length, fmaxAll, tmaxAll, qpos: new Float64Array(qpos) };
}

const r1 = run(), r2 = run();
const same = Buffer.compare(Buffer.from(r1.qpos.buffer), Buffer.from(r2.qpos.buffer)) === 0;
const W = 33.34 * 9.81, P = r1.per;
const jn = i => mj.mj_id2name(m, mj.mjtObj.mjOBJ_ACTUATOR.value, i).replace('_joint', '');
const jr = [...r1.errSq].map((v, i) => [jn(i), Math.sqrt(v / P.length) * 180 / Math.PI]).sort((a, b) => b[1] - a[1]);
const f2 = x => +x.toFixed(2);
const firstOver = (k, th) => (P.find(p => p[k] > th) || {}).f ?? null;
console.log(JSON.stringify({
  mode: ASSIST ? 'assist' : 'free', frames: nF, load_ms: { wasm: f2(tWasm), readMeshes: f2(tRead), compileXML: f2(tCompile) },
  nq: m.nq, nv: m.nv, nu, dt: m.opt.timestep, zSettle: f2(r1.zSettle),
  perf: { simSec: r1.simSec, wall1_ms: f2(r1.wall), wall2_ms: f2(r2.wall), ms_per_simsec: f2(r1.wall / r1.simSec), RTF: f2(r1.simSec * 1000 / r1.wall) },
  fall: r1.fall, drift: r1.drift, deterministic: same,
  min_z: f2(Math.min(...P.map(p => p.z))), max_tilt: f2(Math.max(...P.map(p => p.tilt))), max_xy: f2(Math.max(...P.map(p => p.xy))),
  max_abs_yawErr: f2(Math.max(...P.map(p => Math.abs(p.yawErr)))), final_xy: f2(P.at(-1).xy),
  jointRMSdeg_top5: jr.slice(0, 5).map(([n, v]) => `${n}:${v.toFixed(1)}`), meanJointRMSdeg: f2(jr.reduce((s, x) => s + x[1], 0) / nu),
  torqueSatRatio: +r1.satRatio.toFixed(4),
  firstFrame_jrms_gt10deg: firstOver('jrmsDeg', 10),
  assist: ASSIST ? { meanN: f2(r1.fmean), meanPctBW: f2(r1.fmean / W * 100), maxN: f2(r1.fmaxAll), maxPctBW: f2(r1.fmaxAll / W * 100), maxTorqueNm: f2(r1.tmaxAll), frames_gt50pctBW: P.filter(p => p.assistN > W / 2).length } : undefined,
}, null, 1));
fs.writeFileSync(`metrics_${ASSIST ? 'assist' : 'free'}_${nF}.json`, JSON.stringify(P));
