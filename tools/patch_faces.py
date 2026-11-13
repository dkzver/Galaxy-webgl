from pathlib import Path

p = Path('tools/build_ship_fbx.py')
s = p.read_text(encoding='utf-8')

# ---- wing faces fix + plate raycast + tip caps ----
old = """    stride = (n_chord + 1) * 2
    faces = []
    for i in range(n_span):
        for j in range(n_chord):
            a = i * stride + j * 2
            b = a + 1
            c = a + stride
            d = c + 1
            faces.append((a, c, d, b))            # top skin
            faces.append((b, d, c + stride, a + stride))  # bottom skin
    wing_obj = add_mesh(f'Wing_{side}', verts, faces, [MAT_HULL], smooth=True)
    # gold inner plate follows the top skin
    plate = [(1.30, -1.80), (3.60, -0.20), (3.90, 4.20), (1.90, 4.70)]
    pv = []
    for x, y in plate:
        t = (abs(x) - root_le[0]) / (tip_le[0] - root_le[0])
        chord = math.hypot(root_te[0] - root_le[0], root_te[1] - root_le[1])
        th = 0.135 * (1 - t) + 0.075 * t
        pv.append((x * sx, y, 0.135 * chord * 0.55))
    add_mesh(f'Wing_Gold_{side}', pv, [(0, 1, 2, 3)], [MAT_GOLD], smooth=False)"""

new = """    stride = (n_chord + 1) * 2
    faces = []
    for i in range(n_span):
        for j in range(n_chord):
            a = i * stride + j * 2
            b = a + 2
            c = a + stride
            d = c + 2
            faces.append((a, b, d, c))              # top skin
            faces.append((a + 1, c + 1, d + 1, b + 1))  # bottom skin
    # root and tip caps
    for j in range(n_chord):
        r0 = j * 2
        faces.append((r0, r0 + 1, r0 + 3, r0 + 2))
        base_tip = n_span * stride + j * 2
        faces.append((base_tip, base_tip + 2, base_tip + 3, base_tip + 1))
    wing_obj = add_mesh(f'Wing_{side}', verts, faces, [MAT_HULL], smooth=True)
    # gold inner plate follows the top skin via raycast
    plate = [(1.30, -1.80), (3.60, -0.20), (3.90, 4.20), (1.90, 4.70)]
    pv = []
    for x, y in plate:
        ok, loc, nrm, idx = wing_obj.ray_cast(mathutils.Vector((x * sx, y, 2.0)),
                                              mathutils.Vector((0, 0, -1)))
        zz = loc.z + 0.012 if ok else 0.16
        pv.append((x * sx, y, zz))
    add_mesh(f'Wing_Gold_{side}', pv, [(0, 1, 2, 3)], [MAT_GOLD], smooth=False)"""

if old in s:
    s = s.replace(old, new, 1)
    print('wing faces fixed')
else:
    print('MISS wing faces')

# ---- fin faces fix ----
old_fin = """    stride = (n_chord + 1) * 2
    faces = []
    for i in range(n_span):
        for j in range(n_chord):
            a = i * stride + j * 2
            b = a + 1
            c = a + stride
            d = c + 1
            faces.append((a, c, d, b))
            faces.append((b, d, c + stride, a + stride))
    add_mesh(f'Fin_{side}', verts, faces, [MAT_HULL], smooth=True)"""

new_fin = """    stride = (n_chord + 1) * 2
    faces = []
    for i in range(n_span):
        for j in range(n_chord):
            a = i * stride + j * 2
            b = a + 2
            c = a + stride
            d = c + 2
            faces.append((a, b, d, c))
            faces.append((a + 1, c + 1, d + 1, b + 1))
    for j in range(n_chord):
        r0 = j * 2
        faces.append((r0, r0 + 1, r0 + 3, r0 + 2))
        base_tip = n_span * stride + j * 2
        faces.append((base_tip, base_tip + 2, base_tip + 3, base_tip + 1))
    add_mesh(f'Fin_{side}', verts, faces, [MAT_HULL], smooth=True)"""

if old_fin in s:
    s = s.replace(old_fin, new_fin, 1)
    print('fin faces fixed')
else:
    print('MISS fin faces')

# ---- pod gold band stands proud ----
s = s.replace("[(2.55, 0.978), (3.55, 0.978)], S, MAT_GOLD)",
              "[(2.55, 0.995), (3.55, 0.995)], S, MAT_GOLD)")

p.write_text(s, encoding='utf-8')
print('done')
