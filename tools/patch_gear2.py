from pathlib import Path

p = Path('tools/build_ship_fbx.py')
s = p.read_text(encoding='utf-8')

# remove duplicate wheel hub creation block
old_hub = """for obj in list(GEAR):
    if 'Wheel' in obj.name:
        GEAR.append(add_pipe(f'{obj.name}_Hub', [(obj.location.x - 0.09, obj.location.y, obj.location.z),
                                                  (obj.location.x + 0.09, obj.location.y, obj.location.z)], 0.07, MAT_GOLD_LIGHT, 8))
"""
if old_hub in s:
    s = s.replace(old_hub, '', 1)
    print('hub block removed')

repls = [
    ("    ('detail_cockpit.png', (2.9, -8.6, 3.4), (0.0, -2.4, 1.15), 58),",
     "    ('detail_cockpit.png', (0.9, -9.4, 3.2), (0.0, -2.6, 1.10), 60),"),
    ("    ('detail_gear.png', (5.5, -7.8, -5.6), (0, -3.2, -1.3), 50),",
     "    ('detail_gear.png', (6.0, -8.6, -4.2), (0.4, -2.6, -1.5), 48),"),
    ("add_area('Bottom', (0, -1, -14), 900, 20, (0.6, 0.75, 1.0))",
     "add_area('Bottom', (0, -1, -14), 2600, 22, (0.75, 0.84, 1.0))\nadd_area('BottomFront', (0, -10, -9), 1200, 16, (0.7, 0.8, 1.0))"),
]

for old, new in repls:
    if old not in s:
        print('MISS:', old[:60])
        continue
    s = s.replace(old, new, 1)

p.write_text(s, encoding='utf-8')
print('ok')
