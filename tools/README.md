# tools
Dependencies (tool only): `pip install trimesh pycollada numpy`
GO2: `git clone --depth 1 --filter=blob:none --sparse https://github.com/unitreerobotics/unitree_ros <dir> && git -C <dir> sparse-checkout set robots/go2_description`
Run: `python tools/urdf_to_json.py <dir>/robots/go2_description/urdf/go2_description.urdf <dir>/robots/go2_description/dae public/robots/go2`

Examples: `node tools/make_examples.mjs` → `assets/examples/` (synthetic test CSVs + project, see its README)
