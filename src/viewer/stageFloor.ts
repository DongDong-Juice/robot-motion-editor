import * as THREE from 'three'

type Colors = { floor: string; line: string; edge: string; front: string }

/** 무대 at the origin: `width` = world Y length, `depth` = world X length; audience at +X (strip + 객석 label). */
export function makeStage(width: number, depth: number, c: Colors): THREE.Group {
  const g = new THREE.Group(); g.name = 'stage'
  const hx = depth / 2, hy = width / 2
  const add = (o: THREE.Object3D, name: string) => { o.name = name; g.add(o); return o }

  const floor = add(new THREE.Mesh(new THREE.PlaneGeometry(depth, width), new THREE.MeshBasicMaterial({ color: c.floor })), 'floor')
  floor.position.z = -0.001

  // 0.5 m grid inside the stage only (1 m lines brighter); leftover margin is covered by the edge
  const fine: number[] = [], bold: number[] = []
  for (let i = Math.ceil(-hx * 2); i <= hx * 2; i++) (i % 2 === 0 ? bold : fine).push(i / 2, -hy, 0, i / 2, hy, 0)
  for (let i = Math.ceil(-hy * 2); i <= hy * 2; i++) (i % 2 === 0 ? bold : fine).push(-hx, i / 2, 0, hx, i / 2, 0)
  const line = new THREE.Color(c.line), hi = line.clone().multiplyScalar(1.8), colors: number[] = []
  for (let i = 0; i < fine.length / 3; i++) colors.push(line.r, line.g, line.b)
  for (let i = 0; i < bold.length / 3; i++) colors.push(hi.r, hi.g, hi.b)
  const gg = new THREE.BufferGeometry()
  gg.setAttribute('position', new THREE.Float32BufferAttribute([...fine, ...bold], 3))
  gg.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))
  add(new THREE.LineSegments(gg, new THREE.LineBasicMaterial({ vertexColors: true })), 'grid')

  const eg = new THREE.BufferGeometry().setFromPoints([[-hx, -hy], [hx, -hy], [hx, hy], [-hx, hy]].map(([x, y]) => new THREE.Vector3(x, y, 0.001)))
  add(new THREE.LineLoop(eg, new THREE.LineBasicMaterial({ color: c.edge })), 'edge')

  const front = add(new THREE.Mesh(new THREE.PlaneGeometry(0.12, width), new THREE.MeshBasicMaterial({ color: c.front })), 'front')
  front.position.set(hx + 0.06 + 0.06, 0, 0.001) // strip spans x = depth/2 + 0.06 .. + 0.18

  if (typeof document !== 'undefined') {
    const cv = document.createElement('canvas'); cv.width = 256; cv.height = 64
    const ctx = cv.getContext('2d')!
    ctx.font = '600 30px "IBM Plex Sans KR"'; ctx.fillStyle = c.front; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
    ctx.fillText('객석', 128, 32)
    const labelTex = new THREE.CanvasTexture(cv); labelTex.colorSpace = THREE.SRGBColorSpace
    const label = add(new THREE.Mesh(new THREE.PlaneGeometry(2, 0.5), new THREE.MeshBasicMaterial({ map: labelTex, transparent: true, depthWrite: false })), 'label')
    label.position.set(hx + 0.18 + 0.05 + 0.25, 0, 0.002)
    label.rotation.z = Math.PI / 2 // text bottom faces +X: viewed from the audience side it reads upright
  }
  return g
}

export function disposeStage(g: THREE.Group) {
  g.traverse(o => {
    const m = o as THREE.Mesh
    m.geometry?.dispose()
    for (const x of [m.material].flat() as THREE.MeshBasicMaterial[]) { x?.map?.dispose(); x?.dispose() }
  })
}
