import type { Robot } from './sim'

export interface Gains { kp: number; kd: number }
export interface RobotPhysics { groups: Record<string, Gains>; torqueScale: number; warnPct: number }
export interface PhysicsSettings { g1: RobotPhysics; go2: RobotPhysics; assist: { kpF: number; kdF: number; kpT: number; kdT: number } }

export const DEFAULT_PHYSICS: PhysicsSettings = {
  g1: {
    groups: { 고관절: { kp: 100, kd: 2 }, 무릎: { kp: 150, kd: 4 }, 발목: { kp: 40, kd: 2 }, 허리: { kp: 200, kd: 5 }, 팔: { kp: 40, kd: 1 } },
    torqueScale: 1, warnPct: 50,
  },
  go2: { groups: { 전체: { kp: 20, kd: 0.5 } }, torqueScale: 1, warnPct: 50 },
  assist: { kpF: 2000, kdF: 300, kpT: 300, kdT: 40 },
}

export function groupOf(robot: Robot, joint: string): string {
  if (robot === 'go2') return '전체'
  if (/hip/.test(joint)) return '고관절'
  if (/knee/.test(joint)) return '무릎'
  if (/ankle/.test(joint)) return '발목'
  if (/waist/.test(joint)) return '허리'
  return '팔'
}

const fin = (v: unknown, ok: (n: number) => boolean, def: number) => (typeof v === 'number' && Number.isFinite(v) && ok(v) ? v : def)
const nn = (n: number) => n >= 0

function robotOf(p: Partial<RobotPhysics> | undefined, d: RobotPhysics): RobotPhysics {
  const groups: Record<string, Gains> = {}
  for (const [k, g] of Object.entries(d.groups)) {
    const s = p?.groups?.[k]
    groups[k] = { kp: fin(s?.kp, nn, g.kp), kd: fin(s?.kd, nn, g.kd) }
  }
  return { groups, torqueScale: fin(p?.torqueScale, n => n > 0, d.torqueScale), warnPct: fin(p?.warnPct, n => n >= 1 && n <= 1000, d.warnPct) }
}

export function withDefaults(p?: Partial<PhysicsSettings>): PhysicsSettings {
  const d = DEFAULT_PHYSICS, a = p?.assist
  return {
    g1: robotOf(p?.g1, d.g1), go2: robotOf(p?.go2, d.go2),
    assist: { kpF: fin(a?.kpF, nn, d.assist.kpF), kdF: fin(a?.kdF, nn, d.assist.kdF), kpT: fin(a?.kpT, nn, d.assist.kpT), kdT: fin(a?.kdT, nn, d.assist.kdT) },
  }
}

function fnv(s: string, seed: number): string {
  let h = seed >>> 0
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193) >>> 0
  return h.toString(16).padStart(8, '0')
}

export function cacheKey(robot: Robot, csvText: string, s: PhysicsSettings): string {
  const x = robot + csvText + JSON.stringify(s[robot]) + JSON.stringify(s.assist)
  return fnv(x, 0x811c9dc5) + fnv(x, 0x9747b28c)
}
