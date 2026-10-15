import { useEffect, useRef, useState } from 'react'
import { useEditor } from '../store/store'
import { DEFAULT_PHYSICS, withDefaults, type PhysicsSettings } from './settings'

type Robot = 'g1' | 'go2'
const KP = '목표 각도로 당기는 힘(강성). 클수록 자세를 단단히 유지합니다'
const KD = '움직임을 누그러뜨리는 감쇠. 클수록 흔들림이 줄어듭니다'

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

  const num = (v: number, set: (n: number) => void, label: string, title?: string) => (
    <input type="number" min={0} step="any" aria-label={label} title={title} value={v}
      onChange={e => { const n = e.currentTarget.valueAsNumber; if (Number.isFinite(n)) set(n) }} />
  )
  const r = s[robot]
  const patchR = (f: (r: PhysicsSettings['g1']) => void) => setS(p => { const n = structuredClone(p); f(n[robot]); return n })
  const assist = (k: keyof PhysicsSettings['assist'], label: string, title: string) =>
    num(s.assist[k], n => setS(p => ({ ...p, assist: { ...p.assist, [k]: n } })), `보조 ${label}`, title)

  return (
    <dialog ref={ref} className="ps" aria-label="물리 설정" onKeyDown={e => e.stopPropagation()} onClose={onClose}>
      <form method="dialog" onSubmit={e => { if ((e.nativeEvent as SubmitEvent).submitter?.id === 'ph-go') setPhysics(s) }}>
        <header className="ps-head">
          <h2>물리 설정</h2>
          <span className="ps-dim">참고 지표 · RL 정책 결과와 다를 수 있음</span>
        </header>

        <div role="group" aria-label="로봇" className="ps-seg">
          {(['g1', 'go2'] as const).map(k => <button key={k} type="button" aria-pressed={robot === k} onClick={() => setRobot(k)}>{k === 'g1' ? 'G1' : 'GO2'}</button>)}
        </div>

        <section className="ps-sec">
          <h3>관절 게인</h3>
          <div className="ps-grid">
            <span /><span className="ps-col" title={KP}>kp</span><span className="ps-col" title={KD}>kd</span>
            {Object.entries(r.groups).map(([g, v]) => [
              <span key={g} className="ps-name">{g}</span>,
              <span key={`${g}p`}>{num(v.kp, n => patchR(x => { x.groups[g].kp = n }), `${g} kp`, KP)}</span>,
              <span key={`${g}d`}>{num(v.kd, n => patchR(x => { x.groups[g].kd = n }), `${g} kd`, KD)}</span>,
            ])}
          </div>
        </section>

        <section className="ps-sec">
          <h3>판정</h3>
          <div className="ps-grid ps-grid1">
            <span className="ps-name">토크 배율</span>
            <span className="ps-unit">{num(r.torqueScale, n => patchR(x => { x.torqueScale = n }), '토크 배율', '모터 토크 한계에 곱하는 값')}<i>×</i></span>
            <span className="ps-name">경고 기준</span>
            <span className="ps-unit">{num(r.warnPct, n => patchR(x => { x.warnPct = n }), '경고 기준', '보조력이 체중의 이 비율을 넘으면 경고합니다')}<i>%</i></span>
          </div>
        </section>

        <details className="ps-sec">
          <summary>고급 · 골반 보조력</summary>
          <div className="ps-grid">
            <span /><span className="ps-col">kp</span><span className="ps-col">kd</span>
            <span className="ps-name">힘</span><span>{assist('kpF', '힘 kp', '골반 위치 보조 강성')}</span><span>{assist('kdF', '힘 kd', '골반 위치 보조 감쇠')}</span>
            <span className="ps-name">토크</span><span>{assist('kpT', '토크 kp', '골반 자세 보조 강성')}</span><span>{assist('kdT', '토크 kd', '골반 자세 보조 감쇠')}</span>
          </div>
        </details>

        <footer className="ps-foot">
          <button type="button" onClick={() => setS(DEFAULT_PHYSICS)}>기본값으로</button>
          <span className="ps-gap" />
          <button value="cancel" type="submit" formNoValidate>취소</button>
          <button id="ph-go" className="ps-primary">적용</button>
        </footer>
      </form>
    </dialog>
  )
}
