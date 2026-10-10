import { useEffect, useRef, useState } from 'react'
import { useEditor } from '../store/store'
import { DEFAULT_PHYSICS, withDefaults, type PhysicsSettings } from './settings'

type Robot = 'g1' | 'go2'
const ASSIST: [keyof PhysicsSettings['assist'], string][] = [['kpF', '힘 kp'], ['kdF', '힘 kd'], ['kpT', '토크 kp'], ['kdT', '토크 kd']]

export default function PhysicsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null)
  const physics = useEditor(s => s.project.physics), setPhysics = useEditor(s => s.setPhysics)
  const [s, setS] = useState<PhysicsSettings>(DEFAULT_PHYSICS)
  const [robot, setRobot] = useState<Robot>('g1')

  useEffect(() => {
    const d = ref.current
    if (!d) return
    if (open && !d.open) { setS(withDefaults(physics)); d.showModal() }
    if (!open && d.open) d.close()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const num = (v: number, set: (n: number) => void, label: string) => (
    <input type="number" min={0} step="any" aria-label={label} value={v} onChange={e => { const n = e.currentTarget.valueAsNumber; if (Number.isFinite(n)) set(n) }} />
  )
  const r = s[robot]
  const patchR = (f: (r: PhysicsSettings['g1']) => void) => setS(p => { const n = structuredClone(p); f(n[robot]); return n })

  return (
    <dialog ref={ref} className="pp-dlg" onKeyDown={e => e.stopPropagation()} onClose={onClose}>
      <form method="dialog" onSubmit={e => { if ((e.nativeEvent as SubmitEvent).submitter?.id === 'ph-go') setPhysics(s) }}>
        <p>물리 설정 — 참고 지표 (RL 정책 결과와 다를 수 있음)</p>
        <div role="group" aria-label="로봇">
          {(['g1', 'go2'] as const).map(k => <button key={k} type="button" aria-pressed={robot === k} onClick={() => setRobot(k)}>{k === 'g1' ? 'G1' : 'GO2'}</button>)}
        </div>
        {Object.entries(r.groups).map(([g, v]) => (
          <label key={g}>{g} kp {num(v.kp, n => patchR(x => { x.groups[g].kp = n }), `${g} kp`)} kd {num(v.kd, n => patchR(x => { x.groups[g].kd = n }), `${g} kd`)}</label>
        ))}
        <label>토크 배율 {num(r.torqueScale, n => patchR(x => { x.torqueScale = n }), '토크 배율')}</label>
        <label>경고 기준 (%) {num(r.warnPct, n => patchR(x => { x.warnPct = n }), '경고 기준')}</label>
        <details>
          <summary>고급</summary>
          {ASSIST.map(([k, label]) => <label key={k}>보조 {label} {num(s.assist[k], n => setS(p => ({ ...p, assist: { ...p.assist, [k]: n } })), `보조 ${label}`)}</label>)}
        </details>
        <div className="pp-btns">
          <button type="button" onClick={() => setS(DEFAULT_PHYSICS)}>기본값으로</button>
          <button id="ph-go">적용</button>
          <button value="cancel" type="submit" formNoValidate>취소</button>
        </div>
      </form>
    </dialog>
  )
}
