// 라이브러리 › 사용자 블록 (§26): the 설정 칸 of a picked 사용자 블록 — where it goes (a robot of its kind: track end · a new robot ·
// 목록에만), 추가, 이름 바꾸기, 삭제 — and the same actions for its right-click menu. Kept in this browser only (userBlocks.ts).
import { useState } from 'react'
import { getEditor, useEditor } from '../store/store'
import { blockClip, deleteUserBlock, renameUserBlock, type UserBlock } from '../userBlocks'
import type { Entry as MenuEntry } from './AssetList'

export const USER_DIR = '사용자 블록'
export const USER_NOTE = '이 브라우저에만 저장됩니다 (사이트 데이터를 지우거나 다른 PC에서는 보이지 않음)'
const ROBOT = { go2: 'GO2', g1: 'G1' } as const

/** Puts the block in: `to` = an actor id (its track end), 'new' (a new robot from 0 s) or 'asset' (목록에만). The text to show. */
export function addUserBlock(u: UserBlock, to: string): string {
  const st = getEditor().getState(), { clip, have } = blockClip(st.project, u)
  if (to === 'asset') {
    if (have) return `이미 목록에 있습니다: ${u.name} (새로 만들지 않음)`
    st.addClip(clip)
    return `목록에 추가했습니다: ${u.name}`
  }
  const id = st.appendClip(to === 'new' ? null : to, clip)
  if (!id) return '추가하지 못했습니다 (잠긴 트랙이거나 다른 로봇)'
  const s2 = getEditor().getState(), a = s2.project.sequence.tracks.find(t => t.items.some(i => i.id === id))?.actorId
  if (a) { s2.selectItem(id); s2.select(a) }
  return have ? `목록에 있는 ${u.name}을(를) 붙였습니다` : `추가했습니다: ${u.name}`
}
export function userMenuEntries(u: UserBlock, actors: { id: string; name: string }[], say: (t: string) => void): MenuEntry[] {
  return [
    ...actors.map(a => [`${a.name} 트랙 끝에 추가`, () => say(addUserBlock(u, a.id))] as MenuEntry),
    [`새 ${ROBOT[u.robot]} 로봇으로 추가`, () => say(addUserBlock(u, 'new'))],
    ['목록에만 추가', () => say(addUserBlock(u, 'asset'))],
    // the row is picked on right click, so its 설정 칸 is below: these go to its fields (삭제 asks once more there)
    ['이름 바꾸기', () => setTimeout(() => { const i = document.querySelector<HTMLInputElement>('[data-ub="name"]'); i?.focus(); i?.select() })],
    ['삭제…', () => setTimeout(() => document.querySelector<HTMLButtonElement>('[data-ub="del"]')?.click())],
  ]
}

export default function UserBlockPanel({ u, onMsg }: { u: UserBlock; onMsg: (t: string) => void }) {
  const actors = useEditor(s => s.project.actors).filter(a => a.robot === u.robot), selActor = useEditor(s => s.sel.actorId)
  const [to, setTo] = useState<string | null>(null)
  const pick = to === 'new' || to === 'asset' || actors.some(a => a.id === to) ? to! : (actors.find(a => a.id === selActor) ?? actors[0])?.id ?? 'new'
  const [name, setName] = useState(u.name)
  const [sure, setSure] = useState(false)
  return (
    <>
      <h3 className="pp-blk-t">{u.name}</h3>
      <p className="pp-dim">{ROBOT[u.robot]} · {(u.clip.length / 60).toFixed(2)}초 · {new Date(u.savedAt).toLocaleDateString()} 저장</p>
      <label className="pp-blk-field"><span>붙일 로봇</span>
        <select aria-label="붙일 로봇" value={pick} onChange={e => setTo(e.target.value)}>
          {actors.map(a => <option key={a.id} value={a.id}>{a.name} (트랙 끝에 붙임)</option>)}
          <option value="new">새 {ROBOT[u.robot]} 로봇 (0초부터)</option>
          <option value="asset">목록에만 추가 (시퀀스에 놓지 않음)</option>
        </select>
      </label>
      <div className="pp-tools"><span className="pp-gap" /><button onClick={() => onMsg(addUserBlock(u, pick))}>추가</button></div>
      <label className="pp-blk-field"><span>이름</span>
        <input aria-label="사용자 블록 이름" data-ub="name" value={name} onChange={e => setName(e.target.value)} style={{ textAlign: 'left' }}
          onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur() }}
          onBlur={() => { if (name.trim() && name.trim() !== u.name) void renameUserBlock(u.id, name).then(ok => onMsg(ok ? '이름을 바꿨습니다' : '')); else setName(u.name) }} />
      </label>
      <div className="pp-tools">
        <span className="pp-dim pp-why">{USER_NOTE}</span>
        <button data-ub="del" onClick={e => { if (!sure) { setSure(true); e.currentTarget.focus(); return } void deleteUserBlock(u.id).then(() => onMsg(`삭제했습니다: ${u.name}`)) }}
          onBlur={() => setSure(false)} title="이 브라우저의 사용자 블록에서 지웁니다 (프로젝트 목록에 넣은 것은 그대로)">{sure ? '정말 삭제' : '삭제'}</button>
      </div>
    </>
  )
}
