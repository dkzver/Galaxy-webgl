from pathlib import Path

p = Path('tools/build_ship_fbx.py')
s = p.read_text(encoding='utf-8')

repls = [
    ("MAT_GLOW_WARM = make_mat('Light_Warm', (0.3, 0.1, 0.01), 0.0, 0.2,\n                         emission=(1.0, 0.55, 0.18), strength=6.0)",
     "MAT_GLOW_WARM = make_mat('Light_Warm', (0.3, 0.1, 0.01), 0.0, 0.2,\n                         emission=(1.0, 0.45, 0.12), strength=2.6)"),
    ("    add_box(f'NavLight_{side}', (6.36 * side, 0.95, 0.13), (0.06, 0.05, 0.02), MAT_GLOW_WARM)",
     "    add_box(f'NavLight_{side}', (6.36 * side, 0.95, 0.125), (0.035, 0.03, 0.012), MAT_GLOW_WARM)"),
    ("scene.view_settings.exposure = 0.5", "scene.view_settings.exposure = 0.35"),
    ("MAT_GOLD = make_mat('Panel_Gold', (0.62, 0.34, 0.075), 0.62, 0.36)",
     "MAT_GOLD = make_mat('Panel_Gold', (0.58, 0.32, 0.070), 0.55, 0.44)"),
]

for old, new in repls:
    if old not in s:
        print('MISS:', old.splitlines()[0][:70])
        continue
    s = s.replace(old, new, 1)

p.write_text(s, encoding='utf-8')
print('ok')
