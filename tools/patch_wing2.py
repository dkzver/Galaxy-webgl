from pathlib import Path

p = Path('tools/build_ship_fbx.py')
s = p.read_text(encoding='utf-8')

start = s.index('def wing(side):')
end = s.index('def add_cylinder_y(name, cx, cz, stations, sides, mat):')

new_wing = '''def wing(side):
    """Dense delta wing: airfoil loft with gold skin panels by face material."""
    sx = side
    root_le = (1.15, -2.40)
    root_te = (1.85, 5.40)
    tip_le = (6.58, 1.30)
    tip_te = (6.80, 4.55)
    n_span = 34
    n_chord = 30
    verts = []
    for i in range(n_span + 1):
        t = i / n_span
        le = (root_le[0] + (tip_le[0] - root_le[0]) * t, root_le[1] + (tip_le[1] - root_le[1]) * t)
        te = (root_te[0] + (tip_te[0] - root_te[0]) * t, root_te[1] + (tip_te[1] - root_te[1]) * t)
        chord = math.hypot(te[0] - le[0], te[1] - le[1])
        th = 0.135 * (1 - t) + 0.070 * t
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
    face_mats = []
    for i in range(n_span):
        for j in range(n_chord):
            a = i * stride + j * 2
            b = a + 2
            c = a + stride
            d = c + 2
            faces.append((a, b, d, c))
            gold = (3 <= i < n_span - 9) and (3 <= j < n_chord - 7)
            face_mats.append(1 if gold else 0)
            faces.append((a + 1, c + 1, d + 1, b + 1))
            face_mats.append(0)
    for j in range(n_chord):
        r0 = j * 2
        faces.append((r0, r0 + 1, r0 + 3, r0 + 2))
        face_mats.append(0)
        base_tip = n_span * stride + j * 2
        faces.append((base_tip, base_tip + 2, base_tip + 3, base_tip + 1))
        face_mats.append(0)
    wing_obj = add_mesh(f'Wing_{side}', verts, faces, [MAT_HULL, MAT_GOLD], face_mats=face_mats, smooth=True)
    # wingtip pod
    add_cylinder_y(f'Wingtip_{side}', 6.62 * sx, 0.03,
                   [(2.10, 0.10), (2.60, 0.17), (3.60, 0.18), (4.30, 0.11)], 24, MAT_GOLD)
    return wing_obj


'''
s = s[:start] + new_wing + s[end:]

p.write_text(s, encoding='utf-8')
print('wing rewritten')
