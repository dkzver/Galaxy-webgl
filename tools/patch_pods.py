from pathlib import Path

p = Path('tools/build_ship_fbx.py')
s = p.read_text(encoding='utf-8')

repls = [
    # pod height
    ("def nacelle(side):\n    cx = NAC_CX * side\n    S = 32\n", "def nacelle(side):\n    cx = NAC_CX * side\n    S = 32\n    cz = 0.78\n"),
    ("    add_cylinder_y(f'Nacelle_{side}', cx, -0.02,", "    add_cylinder_y(f'Nacelle_{side}', cx, cz,"),
    ("    add_cylinder_y(f'Nacelle_Gold_{side}', cx, -0.02,\n                   [(2.55, 0.978), (3.55, 0.978)], S, MAT_GOLD)",
     "    add_cylinder_y(f'Nacelle_Gold_{side}', cx, cz,\n                   [(2.55, 0.978), (3.55, 0.978)], S, MAT_GOLD)"),
    ("    add_ring_y(f'Intake_Rim_{side}', cx, -0.02, 0.70, 0.86, 0.66, 0.50, S, MAT_INTAKE)\n"
     "    add_ring_y(f'Intake_Lip_{side}', cx, -0.02, 0.68, 0.88, 0.72, 0.60, S, MAT_GOLD_LIGHT)",
     "    add_ring_y(f'Intake_Rim_{side}', cx, cz, 0.70, 0.86, 0.66, 0.50, S, MAT_INTAKE)\n"
     "    add_ring_y(f'Intake_Lip_{side}', cx, cz, 0.68, 0.88, 0.72, 0.60, S, MAT_GOLD_LIGHT)"),
    ("    add_cylinder_y(f'Intake_Back_{side}', cx, -0.02,", "    add_cylinder_y(f'Intake_Back_{side}', cx, cz,"),
    ("    add_ring_y(f'Nozzle_{side}', cx, -0.02, 7.10, 7.30, 0.70, 0.50, S, MAT_METAL)\n"
     "    add_ring_y(f'Nozzle_Glow_{side}', cx, -0.02, 7.27, 7.31, 0.50, 0.34, S, MAT_GLOW)\n"
     "    add_cylinder_y(f'Nozzle_Core_{side}', cx, -0.02,",
     "    add_ring_y(f'Nozzle_{side}', cx, cz, 7.10, 7.30, 0.70, 0.50, S, MAT_METAL)\n"
     "    add_ring_y(f'Nozzle_Glow_{side}', cx, cz, 7.27, 7.31, 0.50, 0.34, S, MAT_GLOW)\n"
     "    add_cylinder_y(f'Nozzle_Core_{side}', cx, cz,"),
    ("        x0 = cx + math.cos(a) * 0.52\n        z0 = -0.02 + math.sin(a) * 0.52\n"
     "        x1 = cx + math.cos(a) * 0.67\n        z1 = -0.02 + math.sin(a) * 0.67",
     "        x0 = cx + math.cos(a) * 0.52\n        z0 = cz + math.sin(a) * 0.52\n"
     "        x1 = cx + math.cos(a) * 0.67\n        z1 = cz + math.sin(a) * 0.67"),
    ("    add_box(f'Pod_Pylon_{side}', (cx, 3.2, -0.72), (0.30, 1.7, 0.22), MAT_HULL2)",
     "    add_box(f'Pod_Pylon_{side}', (cx, 3.2, 0.0), (0.34, 1.8, 0.30), MAT_HULL2)"),
    # intake fan/nozzle blade heights
    ("        xz_blade(f'Intake_Blade_{side}_{i}', cx, -0.02, 0.88,", "        xz_blade(f'Intake_Blade_{side}_{i}', cx, 0.78, 0.88,"),
    ("    add_cylinder_y(f'Intake_Hub_{side}', cx, -0.02, [(0.86, 0.14), (0.94, 0.10)], 12, MAT_GOLD_LIGHT)",
     "    add_cylinder_y(f'Intake_Hub_{side}', cx, 0.78, [(0.86, 0.14), (0.94, 0.10)], 12, MAT_GOLD_LIGHT)"),
    ("        xz_blade(f'Nozzle_Blade_{side}_{i}', cx, -0.02, 7.33,", "        xz_blade(f'Nozzle_Blade_{side}_{i}', cx, 0.78, 7.33,"),
    ("        add_cylinder_y(f'Pod_Ring_{side}_{y}', cx, -0.02, [(y - 0.035, 0.99), (y + 0.035, 0.99)], 20, MAT_GOLD_LIGHT)",
     "        add_cylinder_y(f'Pod_Ring_{side}_{y}', cx, 0.78, [(y - 0.035, 0.99), (y + 0.035, 0.99)], 20, MAT_GOLD_LIGHT)"),
    ("            pts.append((cx + math.cos(a) * 0.978, y, -0.02 + math.sin(a) * 0.978))",
     "            pts.append((cx + math.cos(a) * 0.978, y, 0.78 + math.sin(a) * 0.978))"),
    ("        add_box(f'Pod_Vent_{side}_{i}', (cx, 2.4 + i * 0.26, 0.945), (0.26, 0.05, 0.012), MAT_INTAKE)\n"
     "    add_box(f'Pod_Vent_Frame_{side}', (cx, 2.92, 0.965), (0.30, 0.58, 0.008), MAT_GOLD)",
     "        add_box(f'Pod_Vent_{side}_{i}', (cx, 2.4 + i * 0.26, 1.725), (0.26, 0.05, 0.012), MAT_INTAKE)\n"
     "    add_box(f'Pod_Vent_Frame_{side}', (cx, 2.92, 1.745), (0.30, 0.58, 0.008), MAT_GOLD)"),
    # clamps/pipes heights
    ("        add_box(f'Clamp_{side}_{i}', (cx, yy, 0.915), (0.30, 0.045, 0.03), MAT_HULL2)",
     "        add_box(f'Clamp_{side}_{i}', (cx, yy, 1.695), (0.30, 0.045, 0.03), MAT_HULL2)"),
    ("    add_pipe(f'CoolPipeA_{side}', [(cx - 0.28, 1.1, 0.70), (cx - 0.26, 3.6, 0.93), (cx - 0.18, 6.5, 0.70)], 0.032, MAT_METAL, 8)",
     "    add_pipe(f'CoolPipeA_{side}', [(cx - 0.28, 1.1, 1.48), (cx - 0.26, 3.6, 1.71), (cx - 0.18, 6.5, 1.48)], 0.032, MAT_METAL, 8)"),
    ("    add_pipe(f'CoolPipeB_{side}', [(cx + 0.28, 1.1, 0.70), (cx + 0.26, 3.6, 0.93), (cx + 0.18, 6.5, 0.70)], 0.032, MAT_METAL, 8)",
     "    add_pipe(f'CoolPipeB_{side}', [(cx + 0.28, 1.1, 1.48), (cx + 0.26, 3.6, 1.71), (cx + 0.18, 6.5, 1.48)], 0.032, MAT_METAL, 8)"),
    ("        add_box(f'NacFinn_{side}_{i}', (cx, yy, -0.925), (0.18, 0.03, 0.09), MAT_METAL)",
     "        add_box(f'NacFinn_{side}_{i}', (cx, yy, -0.145), (0.18, 0.03, 0.09), MAT_METAL)"),
    ("    add_cylinder_y(f'Intake_Light_{side}', NAC_CX * side, -0.02,\n                   [(1.00, 0.10), (1.08, 0.10)], 8, MAT_GLOW_WARM)",
     "    add_cylinder_y(f'Intake_Light_{side}', NAC_CX * side, 0.78,\n                   [(1.02, 0.08), (1.08, 0.08)], 8, MAT_GLOW_WARM)"),
    # bv boom light z
    ("        (5.02 * side, 9.2, -0.16), (5.09 * side, 9.2, -0.16),\n"
     "        (4.96 * side, 6.2, -0.16), (4.89 * side, 6.2, -0.16)",
     "        (5.02 * side, 9.2, -0.03), (5.09 * side, 9.2, -0.03),\n"
     "        (4.96 * side, 6.2, -0.03), (4.89 * side, 6.2, -0.03)"),
    # panel subtlety
    ("        mat = MAT_HULL2\n        if bi in (0, 3) and random.random() < 0.22:\n            mat = MAT_GOLD\n        hull_surface_patch(f'HullPanel_{y:.2f}_{bi}', y + 0.02, y1 - 0.02, a0, a1, mat, 1.012)",
     "        mat = MAT_HULL\n        if bi in (0, 3) and random.random() < 0.12:\n            mat = MAT_GOLD\n        hull_surface_patch(f'HullPanel_{y:.2f}_{bi}', y + 0.02, y1 - 0.02, a0, a1, mat, 1.006)"),
    ("        if random.random() < 0.22:\n            continue", "        if random.random() < 0.45:\n            continue"),
    # gold texture mapping scale finer for gold
    ("    mapping.inputs['Scale'].default_value = (3.5, 3.5, 1.0)",
     "    mapping.inputs['Scale'].default_value = (2.2, 2.2, 1.0) if 'Gold' in mat.name else (3.5, 3.5, 1.0)"),
    # detail cameras for raised pods
    ("    ('detail_intake.png', (6.6, -4.0, 1.8), (3.05, 1.0, 0.1), 55),\n"
     "    ('detail_nozzle.png', (6.8, 9.0, 1.8), (3.05, 7.0, 0.0), 55),",
     "    ('detail_intake.png', (6.8, -4.2, 2.6), (3.05, 1.1, 0.8), 55),\n"
     "    ('detail_nozzle.png', (7.0, 9.4, 2.6), (3.05, 7.1, 0.8), 55),"),
]

for old, new in repls:
    if old not in s:
        print('MISS:', old.splitlines()[0][:80])
        continue
    s = s.replace(old, new, 1)

p.write_text(s, encoding='utf-8')
print('patched')
