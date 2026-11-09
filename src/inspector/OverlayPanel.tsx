// 부위 얹기 (수정변동사항.md §26): the inspector's 얹은 동작 칸 of a sequence piece — the overlays it has (부위 ← 원본 · 방식 · 세기 ·
// 구간, state color), + 부위 얹기 / ✕ 빼기, and the form of the one being made or changed: 원본 블록 (목록 clips of this robot, GO2
// 라이브러리 고정 블록), 부위, 방식, 원본 구간, 얹을 곳 (조각 기준 초) · 반복, 세기 · 섞임, then its state (the same calculation that
// 적용 makes, §25) with the 해결 buttons. 빨강 = 적용 disabled (§22). B 범위 reasons are shown, never blocking (사용자).
import { useEffect, useMemo, useState } from 'react'
import { getEditor, trackLocked, useEditor } from '../store/store'
import { overlayStates } from '../model/itemClip'
import { partLabel, type Overlay, type OverlayReport } from '../model/overlay'
import { GO2_BLOCKS } from '../go2blocks/blocks'
import { buildBlockClip } from '../go2blocks/build'
import { cachedTemplate, loadTemplate } from '../go2blocks/Go2BlockPanel'
import type { Clip, Item } from '../model/types'
import { Num } from './WalkPanel'

const TONE: Record<OverlayReport['tone'], string> = { ok: '정상', warn: '주의', bad: '한계 초과' }
const MODE: Record<Overlay['mode'], string> = { replace: '덮어쓰기', add: '더하기' }
const FIXED = GO2_BLOCKS.filter(b => b.kind === 'fixed')
const s1 = (f: number) => +(f / 60).toFixed(2) // frames → seconds (as shown)
const fr = (s: number) => Math.round(s * 60)

/** What is wrong with the form when the store would not take it (previewOverlay null). */
function formWhy(o: Overlay, srcLen: number, it: Item, locked: boolean): string {
  if (locked) return '잠긴 트랙입니다'
  if (!o.parts.length) return '부위를 하나 이상 고르세요'
  if (o.srcB <= o.srcA) return '원본 구간의 끝이 시작보다 뒤여야 합니다'
  if (o.srcA < 0 || o.srcB > srcLen) return `원본 구간이 원본 블록 밖입니다 (원본 길이 ${s1(srcLen)}초)`
  if (o.len < 2) return '얹을 길이가 너무 짧습니다'
  if (o.at < it.trimIn || o.at + o.len > it.trimOut) return `얹을 곳이 조각 밖으로 나갑니다 (조각 길이 ${s1(it.trimOut - it.trimIn)}초)`
  if (!(o.weight > 0 && o.weight <= 1)) return '세기는 1~100%입니다'
  return '적용할 수 없는 설정입니다'
}

export default function OverlayPanel({ item }: { item: Item }) {
  const project = useEditor(s => s.project), defs = useEditor(s => s.defs), frame = useEditor(s => s.frame)
  const act = getEditor().getState()
  const clip = project.clips[item.refId], def = clip && defs[clip.robot]
  const track = project.sequence.tracks.find(t => t.items.some(i => i.id === item.id))
  const locked = !track || !!track.locked || (!!track.actorId && trackLocked(project, track.actorId))
  const states = useMemo(() => overlayStates(project, defs, item), [project, defs, item])
  const [sel, setSel] = useState<string | null>(null) // the picked overlay row
  const [form, setForm] = useState<Overlay | null>(null) // the one being made / changed
  const [srcKey, setSrcKey] = useState('') // 'c:<clip id>' (목록) | 'b:<block id>' (라이브러리)
  const [lib, setLib] = useState<{ key: string; clip: Clip } | null>(null) // the built library block (one object: preview = 적용)
  const [msg, setMsg] = useState('')
  useEffect(() => { setSel(null); setForm(null); setMsg('') }, [item.id])
  const clips = Object.values(project.clips).filter(c => c.robot === clip?.robot).sort((a, b) => a.name.localeCompare(b.name, 'ko'))
  const libClip = srcKey.startsWith('b:') && lib?.key === srcKey ? lib.clip : undefined
  const srcLen = srcKey.startsWith('c:') ? project.clips[srcKey.slice(2)]?.length ?? 0 : libClip?.length ?? 0
  const ready = !!form && (srcKey.startsWith('c:') ? !!project.clips[srcKey.slice(2)] : !!libClip)
  const draft: Overlay | null = form && ready ? { ...form, src: libClip ? libClip.id : srcKey.slice(2) } : null
  const key = draft && JSON.stringify(draft)
  const plan = useMemo(() => draft && !locked ? act.previewOverlay(item.id, draft, libClip) : null, [project, key, libClip, locked]) // eslint-disable-line react-hooks/exhaustive-deps
  if (!clip || !def) return null

  const room = (at: number) => Math.max(0, item.trimOut - at)
  // a source picked: its whole length from 0, laid from where the form starts (as long as it fits)
  const useSource = (k: string, len: number, base: Overlay) => {
    setSrcKey(k)
    setForm({ ...base, srcA: 0, srcB: len, len: Math.max(2, Math.min(len, room(base.at))) })
  }
  const pickSource = (k: string, base: Overlay) => {
    setMsg('')
    if (k.startsWith('c:')) { useSource(k, project.clips[k.slice(2)]?.length ?? 0, base); return }
    const b = FIXED.find(x => x.id === k.slice(2))
    if (!b) return
    const build = (t: { poses: Parameters<typeof buildBlockClip>[1]; fps: number }) => {
      const c = buildBlockClip(b, t.poses, t.fps, 0, defs)
      setLib({ key: k, clip: c }); useSource(k, c.length, base)
    }
    const t = cachedTemplate(b.id)
    if (t) { build(t); return }
    setSrcKey(k); setForm({ ...base })
    loadTemplate(b.id).then(build, e => setMsg(`블록을 불러오지 못했습니다: ${e instanceof Error ? e.message : e}`))
  }
  const startNew = () => {
    const at = Math.min(Math.max(frame - item.start + item.trimIn, item.trimIn), item.trimOut - 2)
    const base: Overlay = { id: crypto.randomUUID(), src: '', srcA: 0, srcB: 0, at, len: 2, parts: [clip.robot === 'go2' ? 'FR' : '오른팔'],
      mode: 'add', weight: 1, fade: 12 }
    setSel(null)
    const first = clips.find(c => c.id !== clip.id) ?? clips[0]
    if (first) pickSource(`c:${first.id}`, base)
    else if (clip.robot === 'go2' && FIXED[0]) pickSource(`b:${FIXED[0].id}`, base)
    else { setSrcKey(''); setForm(base) }
  }
  const edit = (o: Overlay) => { setSel(o.id); setMsg(''); setSrcKey(`c:${o.src}`); setForm({ ...o }) }
  const set = (patch: Partial<Overlay>) => setForm(f => f && { ...f, ...patch })
  const apply = () => {
    if (!draft) return
    if (act.setOverlay(item.id, draft, libClip)) { setSel(draft.id); setForm(null); setMsg('적용했습니다') }
    else setMsg(plan?.report.tone === 'bad' || plan?.walks.length ? '한계 초과라 적용하지 않았습니다' : formWhy(draft, srcLen, item, locked))
  }
  const remove = () => {
    if (!sel) return
    if (act.removeOverlay(item.id, sel)) { setSel(null); setForm(null); setMsg('뺐습니다') }
    else setMsg(locked ? '잠긴 트랙입니다' : '뺄 수 없습니다 — 뒤 걷기가 한계 초과가 됩니다')
  }
  const srcName = (id: string) => project.clips[id]?.name ?? '(없음)'
  const parts = (o: Overlay) => o.parts.map(p => partLabel(def, p)).join(' · ')
  const bad = !!plan && (plan.report.tone === 'bad' || plan.walks.length > 0)

  return (
    <section className="insp-sec ov">
      <h3 className="insp-sec-t">얹은 동작</h3>
      {states.length > 0 && <div className="ov-list" role="listbox" aria-label="얹은 동작">
        {states.map(({ ov, report }) => (
          <div key={ov.id} role="option" aria-selected={sel === ov.id} className={sel === ov.id ? 'ov-row on' : 'ov-row'} tabIndex={0}
            onClick={() => edit(ov)} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); edit(ov) } }}
            title={report.held ? '한계 초과 — 재생하지 않고 원래 동작으로 둡니다 · 고치기 전에는 내보내지 않습니다' : report.reasons.map(r => r.text).join('\n')}>
            <span className={`wk-tone ${report.tone}`} aria-label={TONE[report.tone]}>●</span>
            <b>{parts(ov)}</b>
            <span className="ov-src">← {srcName(ov.src)}</span>
            <span className="wk-dim ov-how">{MODE[ov.mode]} {Math.round(ov.weight * 100)}% · {s1(ov.at - item.trimIn)}–{s1(ov.at - item.trimIn + ov.len)}초</span>
          </div>
        ))}
      </div>}
      <div className="jp-tools">
        <button disabled={locked} onClick={startNew} title="다른 블록의 움직임을 이 조각의 일부 부위에 얹습니다 (몸통은 그대로)">+ 부위 얹기</button>
        <button disabled={locked || !sel} onClick={remove} title="고른 얹은 동작을 뺍니다 (실행취소 가능)">✕ 빼기</button>
      </div>
      {sel && !form && (st => st?.report.held ? <div className="wk-state" role="status">
        <div><span className="wk-tone bad">● 한계 초과</span></div>
        {st.report.reasons.filter(r => r.tone === 'bad').map((r, i) => <div key={i} className="wk-why bad">{r.text}</div>)}
        <div className="wk-why bad">다른 편집으로 한계를 넘어 재생하지 않습니다 (원래 동작으로 둠) · 고치기 전에는 내보내지 않습니다</div>
        <div className="wk-dim">줄을 눌러 고치세요</div>
      </div> : null)(states.find(x => x.ov.id === sel))}
      {form && <div className="wk ov-form">
        <label className="insp-field"><span className="insp-lab">원본 블록</span>
          <select aria-label="원본 블록" value={srcKey} disabled={locked} onChange={e => pickSource(e.target.value, form)}>
            {!srcKey && <option value="">고르세요</option>}
            <optgroup label="목록">{clips.map(c => <option key={c.id} value={`c:${c.id}`}>{c.name}{c.id === clip.id ? ' (이 조각)' : ''}</option>)}</optgroup>
            {clip.robot === 'go2' && <optgroup label="라이브러리 (넣으면 목록에 추가)">{FIXED.map(b => <option key={b.id} value={`b:${b.id}`}>{b.label}</option>)}</optgroup>}
          </select>
        </label>
        <div className="insp-field"><span className="insp-lab">부위</span>
          <div className="wk-seg" role="group" aria-label="부위">
            {def.groups.map(g => { const on = form.parts.includes(g.name); return (
              <button key={g.name} type="button" aria-pressed={on} className={on ? 'on' : ''} disabled={locked}
                onClick={() => set({ parts: on ? form.parts.filter(x => x !== g.name) : [...form.parts, g.name] })}>{partLabel(def, g.name)}</button>) })}
          </div>
        </div>
        <div className="insp-field"><span className="insp-lab">방식</span>
          <div className="wk-seg" role="group" aria-label="방식">
            {(['replace', 'add'] as const).map(m => <button key={m} type="button" aria-pressed={form.mode === m} className={form.mode === m ? 'on' : ''} disabled={locked}
              title={m === 'replace' ? '그 부위 관절을 원본 값으로' : '원본 구간 첫 프레임에서 움직인 만큼 더함'} onClick={() => set({ mode: m })}>{MODE[m]}</button>)}
          </div>
        </div>
        <div className="insp-field"><span className="insp-lab">원본 구간 <span>원본 길이 {s1(srcLen)}초</span></span>
          <div className="wk-row">
            <Num label="원본 구간 시작" value={s1(form.srcA)} unit="초" step={0.1} disabled={locked} onCommit={v => set({ srcA: fr(v!) })} />
            <span className="wk-dim" aria-hidden="true">–</span>
            <Num label="원본 구간 끝" value={s1(form.srcB)} unit="초" step={0.1} disabled={locked} onCommit={v => set({ srcB: fr(v!) })} />
          </div>
        </div>
        <div className="insp-field"><span className="insp-lab">얹을 곳 (조각 안) <span>시작 · 길이</span>
          <label className="jp-check"><input type="checkbox" aria-label="반복" checked={!!form.loop} disabled={locked}
            onChange={e => setForm(f => { if (!f) return f; const { loop: _, ...rest } = f; return e.target.checked ? { ...rest, loop: true } : rest })} />반복</label></span>
          <div className="wk-row">
            <Num label="얹을 곳 시작" value={s1(form.at - item.trimIn)} unit="초" step={0.1} disabled={locked} onCommit={v => set({ at: item.trimIn + fr(v!) })} />
            <Num label="얹을 길이" value={s1(form.len)} unit="초" step={0.1} disabled={locked} onCommit={v => set({ len: fr(v!) })} />
          </div>
        </div>
        <div className="insp-field"><span className="insp-lab">세기 · 섞임</span>
          <div className="wk-row">
            <Num label="세기" value={Math.round(form.weight * 100)} unit="%" step={5} disabled={locked} onCommit={v => set({ weight: Math.min(1, v! / 100) })} />
            <Num label="섞임" value={form.fade} unit="F" step={2} disabled={locked} onCommit={v => set({ fade: Math.max(0, Math.round(v!)) })} />
          </div>
        </div>
        {!ready ? <div className="wk-state" role="status"><span className="wk-dim">{msg || '원본 블록을 불러오는 중…'}</span></div>
          : plan ? <div className="wk-state" role="status">
            <div><span className={`wk-tone ${bad ? 'bad' : plan.report.tone}`}>● {TONE[bad ? 'bad' : plan.report.tone]}</span>{' '}
              <span className="wk-dim">관절 속도 {plan.report.vel.toFixed(2)}배{plan.report.gap !== null ? ` · 부위 간격 ${plan.report.gap.toFixed(0)} mm` : ''}{plan.report.ground !== null ? ` · 발 높이 ${(plan.report.ground * 100).toFixed(1)} cm 이상` : ''}</span></div>
            {plan.report.reasons.map((r, i) => <div key={i} className={`wk-why ${r.tone}`}>{r.text}</div>)}
            {plan.walks.length > 0 && <div className="wk-why bad">뒤 걷기 {plan.walks.length}개가 한계 초과가 됩니다 (끝 자세가 바뀜)</div>}
            {bad && <div className="wk-dim">한계 초과 — 이대로는 적용하지 않습니다</div>}
            {bad && (plan.fix.weight || plan.fix.fade) && <div className="wk-fix">
              {plan.fix.weight !== undefined && <button onClick={() => set({ weight: plan.fix.weight! })} title="한계 안에 드는 가장 큰 세기 (5% 단위)">세기 {Math.round(plan.fix.weight * 100)}%로</button>}
              {plan.fix.fade !== undefined && <button onClick={() => set({ fade: plan.fix.fade! })} title="한계 안에 드는 가장 짧은 섞임 (2프레임 단위)">섞임 {plan.fix.fade}프레임으로</button>}
            </div>}
            {bad && !plan.fix.weight && !plan.fix.fade && <div className="wk-dim">세기 · 섞임으로는 고칠 수 없습니다 — 구간이나 부위를 바꿔 보세요</div>}
          </div>
          : <div className="wk-state" role="status"><div className="wk-why warn">{formWhy(draft!, srcLen, item, locked)}</div></div>}
        <div className="pp-tools ov-btns">
          <button onClick={() => { setForm(null); setMsg('') }}>취소</button>
          <button disabled={locked || !plan || bad} onClick={apply} title={bad ? '한계 초과 — 해결 버튼이나 설정을 바꾸세요' : '이 조각에 적용 (실행취소 한 번)'}>적용</button>
        </div>
      </div>}
      {msg && (!form || ready) && <p className="insp-hint" role="status">{msg}</p>}
    </section>
  )
}
