import type { RobotKind } from '../robot/types';
import type { PhysicsSettings } from '../physics/settings';

export type Interp = 'linear' | 'bezier' | 'hold';
export interface Tan { df: number; dv: number }
export interface Key { f: number; v: number; interp: Interp; inTan: Tan; outTan: Tan }
export interface Curve { keys: Key[] }
export interface Clip { id: string; name: string; robot: RobotKind; length: number; channels: Record<string, Curve> }
export interface Actor { id: string; name: string; robot: RobotKind; color: string; placement: { x: number; y: number; yaw: number } }
export interface Item { id: string; refId: string; start: number; trimIn: number; trimOut: number; hidden?: true /* 숨기기: not drawn on the stage while the playhead is in it (display only) */; restPose?: true | 'prepend' /* 기본자세 (true: overwrite the first 1.5 s, 'prepend': add a lead-in before it): preview and CSV export start from the standing pose; sequence playback ignores it */; restHold?: number; restBlend?: number | 'auto'; inertia?: number /* 덧붙이기 lead-in frames: 차렷 정지, 전이 ('auto' = from joint velocity limits), 관성 (original frames before the cut; missing = auto) */; restTail?: boolean /* 끝 기본자세 (set by a cut on both pieces; false = turned off, a later cut keeps it off): after the last frame, 전이 (auto) then 차렷 정지 0.5 s; preview and CSV only */; offset?: Record<string, Curve> /* 조각 수정 층: delta curves in clip frames, added to the clip for this piece only (model/itemClip.ts) */; use?: 'original' /* 원본 사용: playback, CSV and physics ignore the 수정 층 (kept for comparing); missing = 수정본 */ }
export interface Track { id: string; kind: 'video' | 'motion'; actorId?: string; hidden: boolean; locked: boolean; trail?: true /* 경로 표시 (motion): the root's floor path on the main stage, display only */; items: Item[] }
export interface Media { id: string; name: string; durationF: number }
export interface Sequence { tracks: Track[]; markers: { f: number; name: string }[]; inF: number | null; outF: number | null }
export interface Project { version: 1 | 2; fps: 60; actors: Actor[]; clips: Record<string, Clip>; media: Media[]; sequence: Sequence; physics?: Partial<PhysicsSettings> }
