import { useState } from 'react'
import { evalCurve } from '../model/curve'
import { evaluateClip } from '../model/evaluate'
import type { Interp } from '../model/types'
import { clipFrameAt, getEditor, useEditor } from '../store/store'

const ROOT = ['root.x', 'root.y', 'root.z', 'root.roll', 'root.pitch', 'root.yaw']
const ROOT_RANGE: Record<string, [number, number]> = {
  'root.x': [-5, 5], 'root.y': [-5, 5], 'root.z': [0, 2],
  'root.roll': [-Math.PI, Math.PI], 'root.pitch': [-Math.PI, Math.PI], 'root.yaw': [-Math.PI, Math.PI],
}
const INTERPS: [Interp, string][] = [['linear', '선형'], ['bezier', '이즈'], ['hold', '홀드']]
const isAngle = (ch: string, joint: boolean) => joint || /roll|pitch|yaw/.test(ch)

export default function Inspector() {
  const ed = getEditor()
  const { project, defs, frame, autoKey, sel } = useEditor(s => s)
  const [deg, setDeg] = useState(true)
  const actor = project.actors.find(a => a.id === sel.actorId)
  if (!actor) return <div className="insp-empty">무대에서 링크를 클릭하거나 타임라인에서 채널을 고르세요.</div>

  const def = defs[actor.robot]
  const { clipId, f } = clipFrameAt(project, actor.id, frame)
  const clip = project.clips[clipId]
  const item = project.sequence.tracks.find(t => t.kind === 'motion' && t.actorId === actor.id)!.items[0]
  const pose = evaluateClip(clip, def, f)

  const channels = sel.channel === 'root' ? ROOT : sel.channel ? [sel.channel] : []
  const info = (ch: string) => {
    const j = def.joints.findIndex(j => j.name === ch)
    if (j >= 0) return { joint: true, v: pose.q[j], lo: def.joints[j].lower, hi: def.joints[j].upper }
    const [lo, hi] = ROOT_RANGE[ch] ?? [0, 0]
    return { joint: false, v: evalCurve(clip.channels[ch] ?? { keys: [] }, f, ch === 'root.z' ? def.standingHeight : 0), lo, hi }
  }
  const group = !sel.channel ? null
    : sel.channel.startsWith('root') ? '루트'
    : def.groups.find(g => g.joints.includes(sel.channel!))?.name ?? null

  const keyFrames = channels.flatMap(ch => clip.channels[ch]?.keys.map(k => k.f) ?? [])
  const jump = (dir: 1 | -1) => {
    const t = dir > 0 ? Math.min(...keyFrames.filter(k => k > f)) : Math.max(...keyFrames.filter(k => k < f))
    if (Number.isFinite(t)) ed.getState().setFrame(t - item.trimIn + item.start)
  }
  const atKeys = channels.filter(ch => clip.channels[ch]?.keys.some(k => k.f === f)).map(ch => ({ channel: ch, f }))
  const curInterp = atKeys.length ? clip.channels[atKeys[0].channel].keys.find(k => k.f === f)!.interp : ''

  const num = (v: number, d: boolean) => (d ? (v * 180) / Math.PI : v).toFixed(d ? 1 : 3)
  const set = (ch: string, v: number) => ed.getState().setValue(actor.id, ch, v)
  const act = ed.getState()

  return (
    <div className="insp">
      <div className="insp-row">
        <input type="color" aria-label="색" value={actor.color} onChange={e => act.setColor(actor.id, e.target.value)} />
        <b>{actor.name}</b>
      </div>
      <div className="insp-row">
        {(['x', 'y', 'yaw'] as const).map(k => (
          <label key={k}>{k}
            <input type="number" step={k === 'yaw' ? 1 : 0.01}
              value={k === 'yaw' ? +(actor.placement.yaw * 180 / Math.PI).toFixed(1) : actor.placement[k]}
              onChange={e => {
                const v = e.target.valueAsNumber
                if (Number.isFinite(v)) act.setPlacement(actor.id, { [k]: k === 'yaw' ? v * Math.PI / 180 : v })
              }} />
          </label>
        ))}
      </div>
      {channels.length > 0 && (
        <>
          <div className="insp-row">
            <button onClick={() => setDeg(d => !d)} aria-pressed={deg}>{deg ? '도' : 'rad'}</button>
            <button aria-label="이전 키" onClick={() => jump(-1)}>◀</button>
            <span aria-hidden>◆</span>
            <button aria-label="다음 키" onClick={() => jump(1)}>▶</button>
          </div>
          {!autoKey && <p className="insp-hint">자동 키를 켜거나 키 추가를 누르세요</p>}
          {channels.map(ch => {
            const { joint, v, lo, hi } = info(ch)
            const d = deg && isAngle(ch, joint)
            const near = joint && (v - lo < 0.1 * (hi - lo) || hi - v < 0.1 * (hi - lo))
            return (
              <div className="insp-ch" key={ch}>
                <div className="insp-name">{ch}</div>
                <div className="insp-row">
                  <input type="range" className={near ? 'near' : ''} min={lo} max={hi} step={0.001} value={v} disabled={!autoKey}
                    aria-label={ch}
                    onPointerDown={() => act.beginGesture()}
                    onPointerUp={() => act.endGesture()}
                    onPointerCancel={() => act.endGesture()}
                    onChange={e => set(ch, +e.target.value)} />
                  <input type="number" key={`${f}-${v}-${d}`} defaultValue={num(v, d)} step={d ? 1 : 0.001} disabled={!autoKey}
                    aria-label={`${ch} 값`}
                    onBlur={e => { const n = e.target.valueAsNumber; if (!Number.isFinite(n)) return; const r = Math.min(Math.max(d ? n * Math.PI / 180 : n, lo), hi); set(ch, r); e.target.value = num(r, d) }}
                    onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur() }} />
                  <span>{d ? '°' : isAngle(ch, joint) ? 'rad' : 'm'}</span>
                </div>
                <div className="insp-lim">{num(lo, d)} ~ {num(hi, d)}</div>
              </div>
            )
          })}
          <div className="insp-row">
            <button onClick={() => channels.forEach(ch => act.setKey(clipId, ch, f, info(ch).v))}>키 추가</button>
            <button disabled={!atKeys.length} onClick={() => act.deleteKeys(clipId, atKeys)}>키 삭제</button>
            <select aria-label="보간" disabled={!atKeys.length} value={curInterp}
              onChange={e => act.setInterp(clipId, atKeys, e.target.value as Interp)}>
              {!curInterp && <option value="" />}
              {INTERPS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </div>
          {group && <button className="insp-group" onClick={() => act.keyGroup(actor.id, group)}>{group} 전체 키</button>}
        </>
      )}
    </div>
  )
}
