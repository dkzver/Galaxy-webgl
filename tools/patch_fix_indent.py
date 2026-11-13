from pathlib import Path

p = Path('tools/build_ship_fbx.py')
s = p.read_text(encoding='utf-8')

old = "add_mesh('Dorsal_Gold', [(-0.12, -0.9, 1.345), (0.12, -0.9, 1.345), (0.12, 6.1, 1.025), (-0.12, 6.1, 1.025)], [(0, 1, 2, 3)], [MAT_GOLD])\n\n    # small light near intake"
new = "add_mesh('Dorsal_Gold', [(-0.12, -0.9, 1.345), (0.12, -0.9, 1.345), (0.12, 6.1, 1.025), (-0.12, 6.1, 1.025)], [(0, 1, 2, 3)], [MAT_GOLD])\n\nfor side in (-1, 1):\n    # small light near intake"

if old not in s:
    print('MISS')
else:
    s = s.replace(old, new, 1)
    p.write_text(s, encoding='utf-8')
    print('fixed')
