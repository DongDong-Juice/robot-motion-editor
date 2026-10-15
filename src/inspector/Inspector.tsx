import { useEffect, useState } from 'react'
import Go2BlockPanel from '../go2blocks/Go2BlockPanel'
import { curveKeyCount, offsetKeyCount } from '../model/itemClip'
import { actorOf, clipLocked, editLock, editTarget, getEditor, targetItem, trackLocked, useEditor } from '../store/store'
import JointPanel from '../viewer/JointPanel'

const ROOT = ['root.x', 'root.y', 'root.z', 'root.roll', 'root.pitch', 'root.yaw']

// 이 조각 수정: the edit that gives the piece its first 수정 key opens 수정 비교 (main = 원본, pane = 수정본), unless the preview
// pane already shows another piece.
function useAutoEditCompare() {
  useEffect(() => getEditor().subscribe((s, prev) => {
    if (s.layer !== 'piece' || s.project === prev.project || !s.sel.actorId) return
    const id = editTarget(s, s.sel.actorId)?.itemId
    const find = (p: typeof s.project) => p.sequence.tracks.flatMap(t => t.items).find(i => i.id === id)
    const now = find(s.project), before = find(prev.project)
    if (!now || !before || offsetKeyCount(before) || !offsetKeyCount(now)) return
    if ((s.itemPreview && s.itemPreview !== now.id) || s.previewEdit) return
    s.openEditCompare(now.id)
  }), [])
}

export default function Inspector() {
  useAutoEditCompare()
  const go2 = useEditor(s => s.project.actors.find(a => a.id === s.sel.actorId && a.robot === 'go2')?.id)
  return <>{go2 && <Go2BlockPanel key={go2} actorId={go2} />}<InspectorBody /></>
}

function InspectorBody() {
  const ed = getEditor()
  const { project, defs, frame, sel, editing, layer, clipEdit } = useEditor(s => s)
  const [lenMsg, setLenMsg] = useState(false)
  const [tol, setTol] = useState(0.001)
  const [simpMsg, setSimpMsg] = useState<{ n: number; at: number } | null>(null)
  useEffect(() => { if (!simpMsg) return; const t = setTimeout(() => setSimpMsg(null), 3000); return () => clearTimeout(t) }, [simpMsg])
  const actor = actorOf({ project, clipEdit }, sel.actorId)
  if (!actor) return <div className="insp-empty">무대에서 링크를 클릭하거나 타임라인에서 채널을 고르세요.</div>
  const clipMode = !!clipEdit // 클립 편집 모드: the open clip on its virtual actor

  const def = defs[actor.robot]
  const target = editTarget({ project, frame, editing, clipEdit }, actor.id)
  if (!target) return <div className="insp-empty">이 액터에 클립이 없습니다.</div>
  const { clipId } = target
  const clip = project.clips[clipId]
  const item = targetItem({ project, editing, clipEdit }, target.itemId)!
  const piece = layer === 'piece' && !clipMode, asset = layer === 'asset' && clipMode
  const nOffset = clipMode ? curveKeyCount(clip.offset) : offsetKeyCount(item)
  const lockedTrack = asset ? false : trackLocked(project, actor.id) || clipLocked(project, clipId) // a clip's 수정 층 is the asset's own

  const channels = sel.channel === 'root' ? ROOT : sel.channel && !sel.channel.startsWith('group:') ? [sel.channel] : []
  const group = !sel.channel ? null
    : sel.channel.startsWith('group:') ? sel.channel.slice(6)
    : sel.channel.startsWith('root') ? '루트'
    : def.groups.find(g => g.joints.includes(sel.channel!))?.name ?? null

  const lockOf = (ch: string) => editLock({ project, frame, editing, clipEdit }, actor.id, ch)
  const locks = channels.map(lockOf)
  const groupNames = group === '루트' ? ROOT : def.groups.find(g => g.name === group)?.joints ?? []
  const groupLocks = groupNames.map(lockOf)
  const xfade = locks.includes('crossfade') || groupLocks.includes('crossfade')
  const stitch = locks.includes('stitch') || groupLocks.includes('stitch')

  const act = ed.getState()

  return (
    <div className="insp">
      <div className="insp-head">
        {clipMode ? <span className="insp-swatch" style={{ background: actor.color }} aria-hidden="true" />
          : <label className="insp-swatch" style={{ background: actor.color }} title="로봇 색 바꾸기">
            <input type="color" aria-label="색" value={actor.color} onChange={e => act.setColor(actor.id, e.target.value)} />
          </label>}
        <b className="insp-title">{clipMode ? `${actor.name} (클립 편집)` : actor.name}</b>
        <span className="pp-tag">{actor.robot === 'g1' ? 'G1' : 'GO2'}</span>
      </div>
      <section className="insp-sec">
      <h3 className="insp-sec-t">편집 대상</h3>
      {clipMode ? <>
      <div className="insp-row insp-layer" role="group" aria-label="편집 대상">
        <button aria-pressed={asset} onClick={() => act.setLayer('asset')} title="원본 곡선은 그대로 두고, 이 클립에 차이를 더합니다(이 클립을 쓰는 모든 조각과 CSV 저장에 반영)">이 클립 수정</button>
        <button aria-pressed={!asset} onClick={() => act.setLayer('clip')} title="원본 곡선 자체를 고칩니다(자동 키 필요)">원본 클립 수정</button>
      </div>
      {asset ? <div className="insp-note">
        <span className="insp-hint">{nOffset ? `이 클립의 수정 키 ${nOffset}개` : '원본은 그대로 두고 이 클립에 더합니다'}</span>
        {nOffset > 0 && <button onClick={() => act.clearClipOffset(clipId)} title="이 클립의 수정을 모두 지우고 원본대로 되돌립니다">수정 지우기</button>}
      </div> : <p className="insp-hint">원본 곡선을 직접 고칩니다</p>}
      </> : <>
      <div className="insp-row insp-layer" role="group" aria-label="편집 대상">
        <button aria-pressed={piece} onClick={() => act.setLayer('piece')} title="원본 클립은 그대로 두고, 이 조각에만 차이를 더합니다(재생·CSV = 원본 + 수정)">이 조각 수정</button>
        <button aria-pressed={!piece} onClick={() => act.setLayer('clip')} title="공유 클립 자체를 고칩니다. 같은 클립을 쓰는 모든 조각이 바뀝니다(자동 키 필요)">원본 클립 수정</button>
      </div>
      {piece ? <div className="insp-note">
        <span className="insp-hint">{nOffset ? `이 조각의 수정 키 ${nOffset}개` : '원본 클립은 그대로 두고 이 조각에만 더합니다'}</span>
        {nOffset > 0 && <button disabled={lockedTrack} onClick={() => act.clearOffset(item.id)} title="이 조각의 수정을 모두 지우고 원본 클립대로 되돌립니다">수정 지우기</button>}
      </div> : <p className="insp-hint">같은 클립을 쓰는 모든 조각이 바뀝니다</p>}
      </>}
      </section>
      {xfade && <p className="insp-hint" role="status">크로스페이드 구간에서는 클립 보기에서 편집하세요</p>}
      {!xfade && stitch && <p className="insp-hint" role="status">이 프레임의 루트 위치·방향은 앞 클립 끝에 맞춰집니다</p>}
      <JointPanel />
      {group && <button className="insp-group" disabled={lockedTrack || groupLocks.some(Boolean)} onClick={() => act.keyGroup(actor.id, group)}>{group} 전체 키</button>}
      {!clipMode && <section className="insp-sec">
      <h3 className="insp-sec-t">배치</h3>
      <div className="insp-grid3">
        {(['x', 'y', 'yaw'] as const).map(k => (
          <label key={k} className="insp-field"><span className="insp-lab">{k}</span>
            <span className="insp-unit"><input type="number" aria-label={k} step={k === 'yaw' ? 1 : 0.01} disabled={lockedTrack}
              value={k === 'yaw' ? +(actor.placement.yaw * 180 / Math.PI).toFixed(1) : actor.placement[k]}
              onChange={e => {
                const v = e.target.valueAsNumber
                if (Number.isFinite(v)) act.setPlacement(actor.id, { [k]: k === 'yaw' ? v * Math.PI / 180 : v })
              }} /><i>{k === 'yaw' ? '°' : 'm'}</i></span>
          </label>
        ))}
      </div>
      </section>}
      <section className="insp-sec">
      <h3 className="insp-sec-t">클립</h3>
      <label className="insp-field"><span className="insp-lab">이름</span>
        <input aria-label="클립 이름" key={`n${clip.name}`} disabled={lockedTrack} defaultValue={clip.name}
          onBlur={e => act.setClip(clipId, { name: e.target.value })}
          onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur() }} />
      </label>
      <label className="insp-field"><span className="insp-lab">길이<span>{(clip.length / 60).toFixed(2)}초</span></span>
          <span className="insp-unit insp-unit-w"><input type="number" aria-label="길이 (프레임)" min={1} step={1} key={`l${clip.length}`} disabled={lockedTrack} defaultValue={clip.length}
            onBlur={e => {
              if (!act.setClip(clipId, { length: e.target.valueAsNumber })) { setLenMsg(true); setTimeout(() => setLenMsg(false), 3000) }
              e.target.value = String(ed.getState().project.clips[clipId].length) }}
            onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur() }} /><i>프레임</i></span>
      </label>
      <div className="insp-field"><span className="insp-lab" title="이 오차 안에서 곡선 모양을 유지하며 키를 줄입니다">키 줄이기 허용 오차</span>
        <div className="insp-tol">
          <input type="number" aria-label="허용 오차" min={0.00001} step={0.0001} value={tol} onChange={e => setTol(e.target.valueAsNumber)} />
          <button disabled={lockedTrack || !(tol >= 0.00001)} onClick={() => setSimpMsg({ n: act.simplifyClip(clipId, tol, tol), at: Date.now() })}>키 줄이기</button>
        </div>
      </div>
      </section>
      {lockedTrack && <p className="insp-hint" role="status">잠긴 트랙입니다</p>}
      {simpMsg && <p className="insp-hint" role="status">{simpMsg.n > 0 ? `키 ${simpMsg.n}개를 줄였습니다` : '줄일 키가 없습니다'}</p>}
      {lenMsg && <p className="insp-hint" role="status">다른 클립과 겹쳐서 길이를 바꿀 수 없습니다</p>}
    </div>
  )
}
