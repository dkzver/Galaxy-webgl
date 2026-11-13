from pathlib import Path

p = Path('tools/build_ship_fbx.py')
s = p.read_text(encoding='utf-8')

repls = [
    (
        "    # warm strip along the rear boom\n"
        "    bv = [\n"
        "        (3.02 * side, 8.6, -0.16), (3.14 * side, 8.6, -0.16),\n"
        "        (2.86 * side, 4.4, -0.16), (2.74 * side, 4.4, -0.16)\n"
        "    ]",
        "    # warm strip along the outer boom\n"
        "    bv = [\n"
        "        (5.02 * side, 9.2, -0.16), (5.09 * side, 9.2, -0.16),\n"
        "        (4.96 * side, 6.2, -0.16), (4.89 * side, 6.2, -0.16)\n"
        "    ]",
    ),
    (
        "    for y, r, bx in ((4.6, 0.36, 2.53), (7.0, 0.26, 2.86), (9.2, 0.18, 3.10)):\n"
        "        add_cylinder_y(f'Boom_Ring_{side}_{y}', bx * side, -0.18, [(y - 0.05, r + 0.02), (y + 0.05, r + 0.02)], 12, MAT_GOLD_LIGHT)\n"
        "    # boom fins / sensors\n"
        "    add_box(f'Boom_Fin_{side}', (2.75 * side, 5.6, -0.18), (0.05, 0.35, 0.22), MAT_HULL2, rot_z=0.2 * side)",
        "    for y, r, bx in ((5.6, 0.155, 5.05), (7.4, 0.112, 5.10), (9.1, 0.066, 5.15)):\n"
        "        add_cylinder_y(f'Boom_Ring_{side}_{y}', bx * side, -0.16, [(y - 0.04, r + 0.02), (y + 0.04, r + 0.02)], 16, MAT_GOLD_LIGHT)\n"
        "    # inner prong collars\n"
        "    for y, r, bx in ((5.6, 0.132, 1.62), (7.3, 0.092, 1.68)):\n"
        "        add_cylinder_y(f'Prong_Ring_{side}_{y}', bx * side, -0.30, [(y - 0.03, r + 0.018), (y + 0.03, r + 0.018)], 12, MAT_GOLD_LIGHT)",
    ),
    (
        "for name in ('Fuselage', 'Wing_-1', 'Wing_1', 'Nacelle_-1', 'Nacelle_1', 'Boom_-1', 'Boom_1', 'Fin_-1', 'Fin_1'):",
        "for name in ('Fuselage', 'Wing_-1', 'Wing_1', 'Nacelle_-1', 'Nacelle_1',\n"
        "             'Boom_outer_-1', 'Boom_outer_1', 'Boom_inner_-1', 'Boom_inner_1', 'Fin_-1', 'Fin_1'):",
    ),
    (
        "    ('detail_boom.png', (6.5, 13.5, 3.0), (3.2, 10.3, 0.0), 55),",
        "    ('detail_boom.png', (9.5, 13.5, 3.2), (5.1, 8.4, -0.1), 55),",
    ),
]

for old, new in repls:
    if old not in s:
        print('MISS:', old.splitlines()[0][:70])
        continue
    s = s.replace(old, new, 1)

p.write_text(s, encoding='utf-8')
print('patched')
