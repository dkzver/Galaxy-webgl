from pathlib import Path

p = Path('tools/build_ship_fbx.py')
s = p.read_text(encoding='utf-8')

repls = [
    # remove glowing wing strip
    ("for side in (-1, 1):\n"
     "    # warm strip along outer wing\n"
     "    verts = [\n"
     "        (4.7 * side, 1.55, 0.225), (5.6 * side, 2.35, 0.225),\n"
     "        (5.65 * side, 2.68, 0.225), (4.75 * side, 1.88, 0.225)\n"
     "    ]\n"
     "    add_mesh(f'Wing_Strip_{side}', verts, [(0, 1, 2, 3)], [MAT_GLOW_WARM])\n",
     ""),
    # remove wing tile grid
    ("# extra layered panels / tiles\n"
     "for side in (-1, 1):\n"
     "    for ix in range(3):\n"
     "        for iy in range(4):\n"
     "            x = (2.35 + ix * 1.02) * side\n"
     "            y = -0.25 + iy * 1.25\n"
     "            add_box(f'Wing_Tile_{side}_{ix}_{iy}', (x, y, 0.232), (0.22, 0.14, 0.005),\n"
     "                    MAT_HULL2, rot_z=0.18 * side)\n"
     "    for iy in range(4):\n",
     "# extra layered panels\n"
     "for side in (-1, 1):\n"
     "    for iy in range(4):\n"),
    # pylon lower
    ("    add_box(f'Pod_Pylon_{side}', (cx, 3.2, 0.0), (0.34, 1.8, 0.30), MAT_HULL2)",
     "    add_box(f'Pod_Pylon_{side}', (cx, 3.2, -0.05), (0.34, 1.8, 0.18), MAT_HULL2)"),
    # deeper gold
    ("MAT_GOLD = make_mat('Panel_Gold', (0.72, 0.43, 0.12), 0.7, 0.3)",
     "MAT_GOLD = make_mat('Panel_Gold', (0.62, 0.34, 0.075), 0.62, 0.36)"),
    ("MAT_GOLD_LIGHT = make_mat('Panel_Gold_Light', (0.88, 0.58, 0.20), 0.55, 0.28)",
     "MAT_GOLD_LIGHT = make_mat('Panel_Gold_Light', (0.78, 0.47, 0.13), 0.55, 0.32)"),
]

for old, new in repls:
    if old not in s:
        print('MISS:', old.splitlines()[0][:80])
        continue
    s = s.replace(old, new, 1)

p.write_text(s, encoding='utf-8')
print('patched')
