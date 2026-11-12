import io
import re

path = 'server.js'
src = io.open(path, encoding='utf-8').read().replace('\r\n', '\n')

old_assets = """async function apiAssets(res) {
  const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'public', 'models');
  const files = await fs.promises.readdir(dir).catch(() => []);
  const assets = files
    .filter((file) => file.endsWith('.json'))
    .map((file) => file.slice(0, -'.json'.length));

  return send(res, 200, JSON.stringify({ assets }), { 'Content-Type': 'application/json; charset=utf-8' });
}"""

new_assets = """async function apiAssets(res) {
  const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'public', 'models');
  const files = await fs.promises.readdir(dir).catch(() => []);
  const assets = files
    .filter((file) => file.endsWith('.json') && !file.endsWith('.physics.json'))
    .map((file) => file.slice(0, -'.json'.length));

  return send(res, 200, JSON.stringify({ assets }), { 'Content-Type': 'application/json; charset=utf-8' });
}

/* ---------------------------- Модели и их физика -------------------------- */

const MODELS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'public', 'models');

function defaultModelPhysics(manifest) {
  const bounds = manifest && manifest.bounds;
  const size = bounds
    ? Math.max(bounds.max[0] - bounds.min[0], bounds.max[1] - bounds.min[1], bounds.max[2] - bounds.min[2])
    : 0;
  const radius = Number(manifest && manifest.radius) || size / 2 || 2;

  return {
    kind: 'static',
    mass: 0,
    restitution: 0.55,
    friction: 0.2,
    collider: { shape: 'sphere', radius: Math.max(0.3, radius) }
  };
}

async function apiModel(res, id) {
  let manifest;
  try {
    manifest = JSON.parse(await fs.promises.readFile(path.join(MODELS_DIR, `${id}.json`), 'utf8'));
  } catch {
    return send(res, 404, 'Модель не найдена');
  }

  let physics = null;
  try {
    physics = JSON.parse(await fs.promises.readFile(path.join(MODELS_DIR, `${id}.physics.json`), 'utf8'));
  } catch {
    physics = defaultModelPhysics(manifest);
  }

  const bounds = manifest.bounds || null;
  const size = bounds
    ? [
      bounds.max[0] - bounds.min[0],
      bounds.max[1] - bounds.min[1],
      bounds.max[2] - bounds.min[2]
    ].map((value) => Math.round(value * 100) / 100)
    : null;

  return send(res, 200, JSON.stringify({
    id,
    name: manifest.name || id,
    length: Number(manifest.length) || null,
    radius: Number(manifest.radius) || null,
    bounds,
    size,
    groups: Array.isArray(manifest.groups) ? manifest.groups.length : 0,
    physics
  }), { 'Content-Type': 'application/json; charset=utf-8' });
}

async function saveModelPhysics(res, id, body) {
  const physics = JSON.parse(body || '{}');
  const collider = physics.collider && typeof physics.collider === 'object' ? physics.collider : {};

  const kind = physics.kind === 'dynamic' ? 'dynamic' : 'static';
  const result = {
    kind,
    mass: kind === 'dynamic' ? Math.max(0.1, Number(physics.mass) || 12) : 0,
    restitution: Math.min(1, Math.max(0, Number(physics.restitution) || 0.55)),
    friction: Math.max(0, Number(physics.friction) || 0.2),
    collider: collider.shape === 'box'
      ? {
        shape: 'box',
        halfExtents: Array.isArray(collider.halfExtents) && collider.halfExtents.length >= 3
          ? collider.halfExtents.slice(0, 3).map((value) => Math.max(0.01, Math.abs(Number(value) || 1)))
          : [1, 1, 1]
      }
      : { shape: 'sphere', radius: Math.max(0.01, Number(collider.radius) || 2) }
  };

  await fs.promises.writeFile(
    path.join(MODELS_DIR, `${id}.physics.json`),
    `${JSON.stringify(result, null, 2)}\\n`,
    'utf8'
  );

  return send(res, 200, JSON.stringify({ saved: `${id}.physics.json`, physics: result }), {
    'Content-Type': 'application/json; charset=utf-8'
  });
}"""

if old_assets not in src:
    raise SystemExit('apiAssets block not found')
src = src.replace(old_assets, new_assets, 1)

anchor = "  if (req.method === 'GET' && urlPath === '/api/hud') return apiHudFiles(res);\n"
routes = anchor + """
  // Модель: сводка по манифесту и физика ассета (sidecar <id>.physics.json)
  const modelPhysics = urlPath.match(/^\\/api\\/model\\/([^/]+)\\/physics$/);
  if (modelPhysics && safeId(modelPhysics[1]) && req.method === 'POST') {
    try {
      return await saveModelPhysics(res, modelPhysics[1], await readBody(req));
    } catch (err) {
      return send(res, 400, err.message);
    }
  }

  const model = urlPath.match(/^\\/api\\/model\\/([^/]+)$/);
  if (model && safeId(model[1]) && req.method === 'GET') return apiModel(res, model[1]);
"""
if anchor not in src:
    raise SystemExit('api route anchor not found')
src = src.replace(anchor, routes, 1)

io.open(path, 'w', encoding='utf-8', newline='\n').write(src)
print('server updated')
