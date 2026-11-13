from pathlib import Path

p = Path('tools/build_ship_fbx.py')
s = p.read_text(encoding='utf-8')

repls = [
    # wing plan polygon
    ("    return [(x * side, y) for x, y in ((1.15, -2.2), (6.15, 0.8), (6.5, 4.4), (1.8, 5.4))]",
     "    return [(x * side, y) for x, y in ((1.15, -2.40), (6.58, 1.30), (6.80, 4.55), (1.85, 5.40))]"),
    # gold plate polygon reference inside greeble filter
    ("    plate_poly = [(x * side, y) for x, y in ((1.30, -1.80), (3.60, -0.20), (3.90, 4.20), (1.90, 4.70))]",
     "    plate_poly = [(x * side, y) for x, y in ((2.20, -1.30), (5.40, 2.10), (5.30, 4.10), (2.30, 4.70))]"),
    # leading edge trim along the new LE
    ("    add_pipe(f'Wing_Lead_{side}', [(1.15 * side, -2.2, 0.205), (3.6 * side, -0.7, 0.205), (6.15 * side, 0.8, 0.205)], 0.022, MAT_GOLD, 6)",
     "    add_pipe(f'Wing_Lead_{side}', [(1.15 * side, -2.40, 0.012), (3.85 * side, -0.55, 0.010), (6.58 * side, 1.30, 0.008)], 0.028, MAT_GOLD, 10)"),
    # drop flat wing seams
    ("    for x in (2.7, 4.0, 5.2):\n"
     "        t = (x - 1.15) / 5.0\n"
     "        y0 = -2.2 + t * 3.0\n"
     "        y1 = 5.4 - t * 1.0\n"
     "        add_pipe(f'Wing_Seam_{side}_{x}', [(x * side, y0, 0.212), (x * side, y1, 0.212)], 0.012, MAT_HULL2, 6)\n"
     "    # small raised gold plates on wing\n"
     "    add_box(f'Wing_Plate_{side}', (3.2 * side, 2.0, 0.235), (0.55, 0.9, 0.012), MAT_GOLD_LIGHT, rot_z=0.18 * side)\n",
     ""),
    # drop old flat-wing rivets
    ("# rivet lines along wing seams\n"
     "for side in (-1, 1):\n"
     "    for i in range(9):\n"
     "        x = (2.2 + i * 0.45) * side\n"
     "        t = (abs(x) - 1.15) / 5.0\n"
     "        y0 = -2.2 + t * 3.0\n"
     "        y1 = 5.4 - t * 1.0\n"
     "        add_pipe(f'Rivet_{side}_{i}', [(x, y0 + 0.1, 0.253), (x, y0 + 0.13, 0.253)], 0.014, MAT_GOLD_LIGHT, 6)\n"
     "        add_pipe(f'Rivet2_{side}_{i}', [(x, y1 - 0.13, 0.253), (x, y1 - 0.10, 0.253)], 0.014, MAT_GOLD_LIGHT, 6)\n",
     ""),
    # flaps follow the new trailing edge
    ("    add_box(f'WingFlap_{side}', (4.3 * side, 4.05, 0.135), (1.35, 0.26, 0.045), MAT_GOLD, rot_z=0.1 * side)\n"
     "    add_box(f'WingFlap_Gap_{side}', (4.3 * side, 3.78, 0.145), (1.35, 0.03, 0.012), MAT_INTAKE, rot_z=0.1 * side)\n"
     "    add_box(f'WingFlap2_{side}', (2.55 * side, 4.32, 0.12), (0.65, 0.2, 0.04), MAT_HULL2, rot_z=0.1 * side)",
     "    add_box(f'WingFlap_{side}', (4.25 * side, 4.86, 0.10), (1.15, 0.24, 0.035), MAT_GOLD, rot_z=0.08 * side)\n"
     "    add_box(f'WingFlap2_{side}', (2.55 * side, 5.14, 0.09), (0.60, 0.18, 0.03), MAT_HULL2, rot_z=0.08 * side)"),
    ("    add_box(f'NavLight_{side}', (6.36 * side, 0.95, 0.125), (0.035, 0.03, 0.012), MAT_GLOW_WARM)",
     "    add_box(f'NavLight_{side}', (6.62 * side, 2.32, 0.20), (0.035, 0.03, 0.012), MAT_GLOW_WARM)"),
]

for old, new in repls:
    if old not in s:
        print('MISS:', old.splitlines()[0][:70])
        continue
    s = s.replace(old, new, 1)

p.write_text(s, encoding='utf-8')
print('details retuned')
