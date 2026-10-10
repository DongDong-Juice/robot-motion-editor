// node scripts/physicsFiles.mjs g1 -> public/physics/g1/files.json (meshes the worker fetches)
import fs from 'node:fs'
const r = process.argv[2] || 'g1', d = `public/physics/${r}`
fs.writeFileSync(`${d}/files.json`, JSON.stringify(fs.readdirSync(`${d}/meshes`).sort().map(f => `meshes/${f}`)))
