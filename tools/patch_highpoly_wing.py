from pathlib import Path

p = Path('tools/build_ship_fbx.py')
s = p.read_text(encoding='utf-8')

# ---------------- wing ----------------
start = s.index('def wing(side):')
end = s.index('def add_cylinder_y(name, cx, cz, stations, sides, mat):')
new_wing = '''def wing(side):
    """Dense airfoil loft: root chord -> tip chord, NACA-like thickness."""
    sx = side
    root_le = (1.15, -2.40)
    root_te = (1.80, 5.40)
    tip_le = (6.58, -1.15)
    tip_te = (6.78, 4.95)
    n_span = 30
    n_chord = 26
    verts = []
    for i in range(n_span + 1):
        t = i / n_span
        le = (root_le[0] + (tip_le[0] - root_le[0]) * t, root_le[1] + (tip_le[1] - root_le[1]) * t)
        te = (root_te[0] + (tip_te[0] - root_te[0]) * t, root_te[1] + (tip_te[1] - root_te[1]) * t)
        chord = math.hypot(te[0] - le[0], te[1] - le[1])
        th = 0.135 * (1 - t) + 0.075 * t
        for j in range(n_chord + 1):
            u = 0.5 * (1 - math.cos(math.pi * j / n_chord))
            yt = 5 * th * (0.2969 * math.sqrt(u) - 0.1260 * u - 0.3516 * u * u
                           + 0.2843 * u ** 3 - 0.1015 * u ** 4)
            px = le[0] + (te[0] - le[0]) * u
            py = le[1] + (te[1] - le[1]) * u
            verts.append((px * sx, py, yt * chord))
            verts.append((px * sx, py, -yt * chord))
    stride = (n_chord + 1) * 2
    faces = []
    for i in range(n_span):
        for j in range(n_chord):
            a = i * stride + j * 2
            b = a + 1
            c = a + stride
            d = c + 1
            faces.append((a, c, d, b))          # top
            faces.append((a + stride + 1, c + 1, c, a))  # bottom (offset check below)
    wing_obj = add_mesh(f'Wing_{side}', verts, faces, [MAT_HULL], smooth=True)
    # gold inner plate follows the top skin
    plate = [(1.30, -1.80), (3.60, -0.20), (3.90, 4.20), (1.90, 4.70)]
    pv = []
    for x, y in plate:
        t = (abs(x) - root_le[0]) / (tip_le[0] - root_le[0])
        chord = math.hypot(root_te[0] - root_le[0], root_te[1] - root_le[1])
        th = 0.135 * (1 - t) + 0.075 * t
        pv.append((x * sx, y, 0.135 * chord * 0.55))
    add_mesh(f'Wing_Gold_{side}', pv, [(0, 1, 2, 3)], [MAT_GOLD], smooth=False)
    # wingtip pod
    add_cylinder_y(f'Wingtip_{side}', 6.66 * sx, 0.02, [(1.2, 0.10), (2.4, 0.19), (3.6, 0.20), (4.8, 0.12)], 24, MAT_GOLD)
    return wing_obj


'''
s = s[:start] + new_wing + s[end:]

# fix bottom faces winding: rebuild faces cleanly
s = s.replace(
    "            faces.append((a, c, d, b))          # top\n"
    "            faces.append((a + stride + 1, c + 1, c, a))  # bottom (offset check below)",
    "            faces.append((a, c, d, b))            # top skin\n"
    "            faces.append((b, d, c + stride, a + stride))  # bottom skin")

# ---------------- fin ----------------
start = s.index('def fin(side):')
end = s.index('fin(-1)\nfin(1)')
new_fin = '''def fin(side):
    """Dense vertical fin loft with airfoil section."""
    sx = side
    root_le = (4.55, 0.35)
    root_te = (7.40, 0.35)
    tip_le = (6.05, 2.60)
    tip_te = (7.00, 2.60)
    n_span, n_chord = 18, 16
    verts = []
    for i in range(n_span + 1):
        t = i / n_span
        le = (root_le[0] + (tip_le[0] - root_le[0]) * t, root_le[1] + (tip_le[1] - root_le[1]) * t)
        te = (root_te[0] + (tip_te[0] - root_te[0]) * t, root_te[1] + (tip_te[1] - root_te[1]) * t)
        chord = math.hypot(te[0] - le[0], te[1] - le[1])
        th = 0.16 * (1 - t) + 0.07 * t
        for j in range(n_chord + 1):
            u = 0.5 * (1 - math.cos(math.pi * j / n_chord))
            yt = 5 * th * (0.2969 * math.sqrt(u) - 0.1260 * u - 0.3516 * u * u
                           + 0.2843 * u ** 3 - 0.1015 * u ** 4)
            py = le[0] + (te[0] - le[0]) * u
            pz = le[1] + (te[1] - le[1]) * u
            verts.append((1.37 * sx + yt * chord, py, pz))
            verts.append((1.37 * sx - yt * chord, py, pz))
    stride = (n_chord + 1) * 2
    faces = []
    for i in range(n_span):
        for j in range(n_chord):
            a = i * stride + j * 2
            b = a + 1
            c = a + stride
            d = c + 1
            faces.append((a, c, d, b))
            faces.append((b, d, c + stride, a + stride))
    add_mesh(f'Fin_{side}', verts, faces, [MAT_HULL], smooth=True)
    # gold leading edge strip
    lead = [(4.60, 0.38), (6.06, 2.55), (6.24, 2.55), (4.86, 0.38)]
    lv = [(1.50 * sx, y, z) for y, z in lead] + [(1.24 * sx, y, z) for y, z in lead]
    lf = [(0, 1, 2, 3), (7, 6, 5, 4)]
    for i in range(4):
        j = (i + 1) % 4
        lf.append((i, 4 + i, 4 + j, j))
    add_mesh(f'Fin_Gold_{side}', lv, lf, [MAT_GOLD])


'''
s = s[:start] + new_fin + s[end:]

p.write_text(s, encoding='utf-8')
print('wing + fin replaced')
