from pathlib import Path

p = Path('tools/build_ship_fbx.py')
s = p.read_text(encoding='utf-8')

repls = [
    (
        "    add_cylinder_y(f'Intake_Light_{side}', 4.85 * side, -0.02,\n"
        "                   [(2.08, 0.10), (2.16, 0.10)], 8, MAT_GLOW_WARM)",
        "    add_cylinder_y(f'Intake_Light_{side}', NAC_CX * side, -0.02,\n"
        "                   [(1.00, 0.10), (1.08, 0.10)], 8, MAT_GLOW_WARM)",
    ),
    (
        "    cx = 4.85 * side\n    # intake fan\n"
        "    for i in range(12):\n"
        "        xz_blade(f'Intake_Blade_{side}_{i}', cx, -0.02, 1.86, 2 * math.pi * i / 12, 0.78, 0.055, 0.03, MAT_METAL)\n"
        "    add_cylinder_y(f'Intake_Hub_{side}', cx, -0.02, [(1.84, 0.14), (1.92, 0.10)], 12, MAT_GOLD_LIGHT)\n"
        "    # nozzle turbine\n"
        "    for i in range(12):\n"
        "        xz_blade(f'Nozzle_Blade_{side}_{i}', cx, -0.02, 7.31, 2 * math.pi * i / 12, 0.58, 0.075, 0.03, MAT_GOLD_LIGHT)\n"
        "    # pod rings\n"
        "    for y in (2.55, 6.35):\n"
        "        add_cylinder_y(f'Pod_Ring_{side}_{y}', cx, -0.02, [(y - 0.035, 1.012), (y + 0.035, 1.012)], 20, MAT_GOLD_LIGHT)\n"
        "    # longitudinal ribs\n"
        "    for k in range(6):\n"
        "        a = 2 * math.pi * k / 6 + 0.2\n"
        "        pts = []\n"
        "        for y in (2.3, 3.6, 5.0, 6.4):\n"
        "            pts.append((cx + math.cos(a) * 0.995, y, -0.02 + math.sin(a) * 0.995))\n"
        "        add_pipe(f'Pod_Rib_{side}_{k}', pts, 0.022, MAT_HULL2 if k % 2 else MAT_GOLD, 6)\n"
        "    # top vents\n"
        "    for i in range(5):\n"
        "        add_box(f'Pod_Vent_{side}_{i}', (cx, 3.2 + i * 0.28, 0.965), (0.28, 0.05, 0.012), MAT_INTAKE)\n"
        "    add_box(f'Pod_Vent_Frame_{side}', (cx, 3.78, 0.99), (0.32, 0.62, 0.008), MAT_GOLD)",
        "    cx = NAC_CX * side\n    # intake fan\n"
        "    for i in range(12):\n"
        "        xz_blade(f'Intake_Blade_{side}_{i}', cx, -0.02, 0.88, 2 * math.pi * i / 12, 0.74, 0.055, 0.03, MAT_METAL)\n"
        "    add_cylinder_y(f'Intake_Hub_{side}', cx, -0.02, [(0.86, 0.14), (0.94, 0.10)], 12, MAT_GOLD_LIGHT)\n"
        "    # nozzle turbine\n"
        "    for i in range(12):\n"
        "        xz_blade(f'Nozzle_Blade_{side}_{i}', cx, -0.02, 7.33, 2 * math.pi * i / 12, 0.58, 0.075, 0.03, MAT_GOLD_LIGHT)\n"
        "    # pod rings\n"
        "    for y in (1.22, 6.6):\n"
        "        add_cylinder_y(f'Pod_Ring_{side}_{y}', cx, -0.02, [(y - 0.035, 0.99), (y + 0.035, 0.99)], 20, MAT_GOLD_LIGHT)\n"
        "    # longitudinal ribs\n"
        "    for k in range(6):\n"
        "        a = 2 * math.pi * k / 6 + 0.2\n"
        "        pts = []\n"
        "        for y in (1.3, 2.6, 4.0, 5.4, 6.4):\n"
        "            pts.append((cx + math.cos(a) * 0.978, y, -0.02 + math.sin(a) * 0.978))\n"
        "        add_pipe(f'Pod_Rib_{side}_{k}', pts, 0.022, MAT_HULL2 if k % 2 else MAT_GOLD, 6)\n"
        "    # top vents\n"
        "    for i in range(5):\n"
        "        add_box(f'Pod_Vent_{side}_{i}', (cx, 2.4 + i * 0.26, 0.945), (0.26, 0.05, 0.012), MAT_INTAKE)\n"
        "    add_box(f'Pod_Vent_Frame_{side}', (cx, 2.92, 0.965), (0.30, 0.58, 0.008), MAT_GOLD)",
    ),
    (
        "    cx = 4.85 * side\n    for i in range(5):\n"
        "        yy = 2.75 + i * 0.75\n"
        "        add_box(f'Clamp_{side}_{i}', (cx, yy, 0.94), (0.34, 0.045, 0.03), MAT_HULL2)\n"
        "    add_pipe(f'CoolPipeA_{side}', [(cx - 0.32, 2.1, 0.80), (cx - 0.30, 4.2, 0.99), (cx - 0.22, 6.6, 0.74)], 0.032, MAT_METAL, 8)\n"
        "    add_pipe(f'CoolPipeB_{side}', [(cx + 0.32, 2.1, 0.80), (cx + 0.30, 4.2, 0.99), (cx + 0.22, 6.6, 0.74)], 0.032, MAT_METAL, 8)\n"
        "    for i in range(6):\n"
        "        yy = 3.0 + i * 0.45\n"
        "        add_box(f'NacFinn_{side}_{i}', (cx, yy, -0.96), (0.20, 0.03, 0.09), MAT_METAL)",
        "    cx = NAC_CX * side\n    for i in range(5):\n"
        "        yy = 1.9 + i * 0.8\n"
        "        add_box(f'Clamp_{side}_{i}', (cx, yy, 0.915), (0.30, 0.045, 0.03), MAT_HULL2)\n"
        "    add_pipe(f'CoolPipeA_{side}', [(cx - 0.28, 1.1, 0.70), (cx - 0.26, 3.6, 0.93), (cx - 0.18, 6.5, 0.70)], 0.032, MAT_METAL, 8)\n"
        "    add_pipe(f'CoolPipeB_{side}', [(cx + 0.28, 1.1, 0.70), (cx + 0.26, 3.6, 0.93), (cx + 0.18, 6.5, 0.70)], 0.032, MAT_METAL, 8)\n"
        "    for i in range(6):\n"
        "        yy = 2.1 + i * 0.45\n"
        "        add_box(f'NacFinn_{side}_{i}', (cx, yy, -0.925), (0.18, 0.03, 0.09), MAT_METAL)",
    ),
    (
        "    ('detail_intake.png', (8.5, -1.5, 1.8), (4.75, 2.4, 0.0), 55),\n"
        "    ('detail_nozzle.png', (8.5, 10.5, 2.0), (4.75, 6.6, 0.0), 55),",
        "    ('detail_intake.png', (6.6, -4.0, 1.8), (3.05, 1.0, 0.1), 55),\n"
        "    ('detail_nozzle.png', (6.8, 9.0, 1.8), (3.05, 7.0, 0.0), 55),",
    ),
    (
        "    add_cylinder_y(f'Intake_Light_{side}', NAC_CX * side, -0.02,\n"
        "                   [(1.00, 0.10), (1.08, 0.10)], 8, MAT_GLOW_WARM)\n"
        "    # warm strip along the forward boom\n"
        "    bv = [\n"
        "        (2.62 * side, 8.8, 0.02), (2.88 * side, 8.8, 0.02),\n"
        "        (2.78 * side, 4.4, 0.02), (2.48 * side, 4.4, 0.02)\n"
        "    ]",
        "    add_cylinder_y(f'Intake_Light_{side}', NAC_CX * side, -0.02,\n"
        "                   [(1.00, 0.10), (1.08, 0.10)], 8, MAT_GLOW_WARM)\n"
        "    # warm strip along the rear boom\n"
        "    bv = [\n"
        "        (3.02 * side, 8.6, -0.16), (3.14 * side, 8.6, -0.16),\n"
        "        (2.86 * side, 4.4, -0.16), (2.74 * side, 4.4, -0.16)\n"
        "    ]",
    ),
]

for old, new in repls:
    if old not in s:
        print('MISS:', old.splitlines()[0][:80])
        continue
    s = s.replace(old, new, 1)

# also fix cool pipe z values if replaced version had 0.80/0.99
s = s.replace("cx - 0.30, 4.2, 0.99", "cx - 0.28, 3.6, 0.93")
s = s.replace("cx + 0.30, 4.2, 0.99", "cx + 0.28, 3.6, 0.93")

p.write_text(s, encoding='utf-8')
print('done')
