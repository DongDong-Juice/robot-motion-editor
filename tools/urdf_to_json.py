"""URDF + DAE -> model.json / meshes.json (RobotDef JSON). Usage: urdf_to_json.py <urdf> <mesh_dir> <out_dir>"""
import base64, json, sys
import xml.etree.ElementTree as ET
from pathlib import Path

import numpy as np
import trimesh


def vec(s, default):
    return [float(x) for x in s.split()] if s else default


def b64(a):
    return base64.b64encode(a.tobytes()).decode()


def main(urdf, mesh_dir, out_dir):
    root = ET.parse(urdf).getroot()
    links, meshes = {}, {}
    for l in root.findall('link'):
        vis = l.findall('visual')
        if len(vis) > 1:
            raise SystemExit(f"{l.get('name')}: multiple visuals not supported")
        link = {'mesh': None, 'xyz': [0, 0, 0], 'rpy': [0, 0, 0], 'scale': [1, 1, 1], 'color': None}
        if vis:
            v = vis[0]
            o = v.find('origin')
            m = v.find('geometry/mesh')
            if m is not None:
                stem = Path(m.get('filename')).stem
                if stem not in meshes:
                    t = trimesh.load(Path(mesh_dir) / f'{stem}.dae', force='mesh')
                    if isinstance(t, trimesh.Scene):
                        t = t.dump(concatenate=True)
                    meshes[stem] = {'nv': len(t.vertices),
                                    'pos': b64(np.asarray(t.vertices, '<f4')),
                                    'idx': b64(np.asarray(t.faces, '<u4'))}
                link.update(mesh=stem,
                            xyz=vec(o.get('xyz') if o is not None else None, [0, 0, 0]),
                            rpy=vec(o.get('rpy') if o is not None else None, [0, 0, 0]),
                            scale=vec(m.get('scale'), [1, 1, 1]))
        links[l.get('name')] = link

    joints = []
    for j in root.findall('joint'):
        t = j.get('type')
        if t not in ('revolute', 'fixed'):
            continue
        o = j.find('origin')
        a = j.find('axis')
        d = {'name': j.get('name'), 'type': t, 'parent': j.find('parent').get('link'),
             'child': j.find('child').get('link'),
             'xyz': vec(o.get('xyz') if o is not None else None, [0, 0, 0]),
             'rpy': vec(o.get('rpy') if o is not None else None, [0, 0, 0]),
             'axis': vec(a.get('xyz') if a is not None else None, [0, 0, 1])}
        if t == 'revolute':
            lim = j.find('limit')
            d.update({k: float(lim.get(k)) for k in ('lower', 'upper', 'velocity', 'effort')})
        joints.append(d)

    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    (out / 'model.json').write_text(json.dumps({'name': root.get('name'), 'links': links, 'joints': joints}, separators=(',', ':')))
    (out / 'meshes.json').write_text(json.dumps(meshes, separators=(',', ':')))
    print({k: (v['nv'], len(v['pos'])) for k, v in meshes.items()})


if __name__ == '__main__':
    main(*sys.argv[1:4])
