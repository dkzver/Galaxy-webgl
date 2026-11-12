// Разведка структуры FBX: какие узлы есть, сколько вершин/полигонов/UV.
import fs from 'node:fs';
import { parseFBX } from './fbx-lib.mjs';

const { version, root } = parseFBX(fs.readFileSync(process.argv[2]));
console.log('FBX version', version);

const counts = new Map();
const walk = (node, depth = 0) => {
  counts.set(node.name, (counts.get(node.name) || 0) + 1);
  if (depth < 4 && node.children.length) {
    for (const child of node.children.slice(0, 12)) walk(child, depth + 1);
  }
};
for (const n of root.children) walk(n);

console.log([...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25).map(([k, v]) => `${k}:${v}`).join('  '));

// Фото геометрии
const find = (node, name, out = []) => {
  if (node.name === name) out.push(node);
  for (const c of node.children) find(c, name, out);
  return out;
};

const objects = find(root, 'Objects')[0];
if (!objects) {
  console.log('нет Objects');
  process.exit(0);
}

for (const obj of objects.children) {
  const type = obj.props[2];
  const name = obj.props[1];
  const label = typeof name === 'string' ? name.split('\u0000')[0] : '';
  if (obj.name === 'Geometry') {
    const verts = obj.children.find((c) => c.name === 'Vertices');
    const idx = obj.children.find((c) => c.name === 'PolygonVertexIndex');
    const uvNode = find(obj, 'LayerElementUV')[0];
    const uv = uvNode?.children.find((c) => c.name === 'UV');
    const uvi = uvNode?.children.find((c) => c.name === 'UVIndex');
    console.log(`Geometry "${label}" (${type}): verts=${verts ? verts.props[0].length / 3 : 0} polys=${idx ? idx.props[0].length : 0} uv=${uv ? uv.props[0].length / 2 : 0} uvi=${uvi ? uvi.props[0].length : 0}`);
    if (uvNode) {
      console.log('  UV mapping:', uvNode.children.find((c) => c.name === 'MappingInformationType')?.props[0], 'ref:', uvNode.children.find((c) => c.name === 'ReferenceInformationType')?.props[0]);
    }
  } else if (obj.name === 'Model') {
    const t = obj.children.find((c) => c.name === 'Properties70');
    const tProps = t?.children.filter((c) => c.name === 'P').map((p) => `${p.props[0]}=${p.props.slice(4).join(',')}`).join(' ');
    console.log(`Model "${label}" (${type}) ${tProps?.slice(0, 220) || ''}`);
  }
}
