export type SyncAction = { kind: 'seek'; t: number; play: boolean } | { kind: 'none'; play: boolean }

// Pure: what to do with the <video> so it matches the playhead's media time.
export function syncAction(target: { seconds: number }, video: { currentTime: number; paused: boolean }, playing: boolean): SyncAction {
  const tol = playing ? 2 / 60 : 0.5 / 60
  return Math.abs(video.currentTime - target.seconds) > tol
    ? { kind: 'seek', t: target.seconds, play: playing }
    : { kind: 'none', play: playing }
}
