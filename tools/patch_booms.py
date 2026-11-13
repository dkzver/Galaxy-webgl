from pathlib import Path

p = Path('tools/build_ship_fbx.py')
s = p.read_text(encoding='utf-8')

start = s.index('# Forward booms / laser prongs')
end = s.index('# Tail fins')

new = '''# Rear booms / stabiliser prongs
# --------------------------------------------------------------------------
def boom(side, name, stations, sides=16, zbase=-0.18, tip_from=None, tip_mat=None):
    sx = side
    verts = []
    for y, cx, r in stations:
        for k in range(sides):
            a = 2 * math.pi * k / sides
            verts.append((cx * sx + math.cos(a) * r, y, zbase + math.sin(a) * r))
    faces = []
    for i in range(len(stations) - 1):
        for k in range(sides):
            a = i * sides + k
            b = i * sides + (k + 1) % sides
            c = (i + 1) * sides + (k + 1) % sides
            d = (i + 1) * sides + k
            faces.append((a, b, c, d))
    faces.append(tuple(range(sides - 1, -1, -1)))
    base = (len(stations) - 1) * sides
    faces.append(tuple(base + k for k in range(sides)))
    add_mesh(f'Boom_{name}_{side}', verts, faces, [MAT_HULL])

    if tip_from is not None:
        tip_verts = []
        for y, cx, r in stations[tip_from:]:
            for k in range(sides):
                a = 2 * math.pi * k / sides
                tip_verts.append((cx * sx + math.cos(a) * r * 1.03, y, zbase + math.sin(a) * r * 1.03))
        tip_faces = []
        for i in range(len(stations[tip_from:]) - 1):
            for k in range(sides):
                a = i * sides + k
                b = i * sides + (k + 1) % sides
                c = (i + 1) * sides + (k + 1) % sides
                d = (i + 1) * sides + k
                tip_faces.append((a, b, c, d))
        base = (len(stations[tip_from:]) - 1) * sides
        tip_faces.append(tuple(base + k for k in range(sides)))
        add_mesh(f'Boom_Tip_{name}_{side}', tip_verts, tip_faces, [tip_mat or MAT_GOLD_LIGHT])


for side in (-1, 1):
    boom(side, 'outer', [(3.60, 5.00, 0.20), (5.40, 5.05, 0.16), (7.40, 5.10, 0.11),
                         (9.10, 5.15, 0.065), (10.40, 5.20, 0.03)],
         sides=16, zbase=-0.16, tip_from=3)
    boom(side, 'inner', [(3.90, 1.55, 0.17), (5.60, 1.62, 0.13), (7.30, 1.68, 0.09),
                         (8.80, 1.72, 0.05), (9.70, 1.75, 0.022)],
         sides=12, zbase=-0.30, tip_from=3)

'''

s = s[:start] + new + s[end:]
p.write_text(s, encoding='utf-8')
print('booms replaced')
