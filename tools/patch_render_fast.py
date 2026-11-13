from pathlib import Path

p = Path('tools/build_ship_fbx.py')
s = p.read_text(encoding='utf-8')
s = s.replace("scene.eevee.taa_render_samples = 64", "scene.eevee.taa_render_samples = 24")
s = s.replace("scene.render.resolution_x = 2200", "scene.render.resolution_x = 1600")
s = s.replace("scene.render.resolution_y = 1650", "scene.render.resolution_y = 1200")
p.write_text(s, encoding='utf-8')
print('render settings relaxed')
