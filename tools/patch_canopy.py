from pathlib import Path

p = Path('tools/build_ship_fbx.py')
s = p.read_text(encoding='utf-8')

start = s.index("canopy_verts = []")
end = s.index("add_mesh(f'Canopy_Rail_{side}', rail, rail_faces, [MAT_GOLD])") + len("add_mesh(f'Canopy_Rail_{side}', rail, rail_faces, [MAT_GOLD])")

new = '''CANOPY_DENSE = []
for i in range(len(CANOPY) - 1):
    y0, w0, h0 = CANOPY[i]
    y1, w1, h1 = CANOPY[i + 1]
    for k in range(6):
        t = k / 6.0
        e = t * t * (3 - 2 * t)
        CANOPY_DENSE.append((y0 + (y1 - y0) * t, w0 + (w1 - w0) * e, h0 + (h1 - h0) * e))
CANOPY_DENSE.append(CANOPY[-1])

N_ANG = 40
canopy_verts = []
for y, w, h in CANOPY_DENSE:
    base = hull_h_at(y) - 0.035
    for k in range(N_ANG + 1):
        a = math.pi * k / N_ANG
        canopy_verts.append((math.cos(a) * w, y, base + math.sin(a) * h))

stride_c = N_ANG + 1
canopy_faces = []
for i in range(len(CANOPY_DENSE) - 1):
    for k in range(N_ANG):
        a = i * stride_c + k
        b = a + 1
        c = a + stride_c
        d = c + 1
        canopy_faces.append((a, c, d, b))
add_mesh('Canopy', canopy_verts, canopy_faces, [MAT_GLASS], smooth=True)

# cockpit interior: tub, seat, console, stick, HUD
INT_Y0, INT_Y1 = -4.55, 1.55
add_box('Cockpit_Tub', (0.0, (INT_Y0 + INT_Y1) / 2, -0.02), (0.52, (INT_Y1 - INT_Y0) / 2, 0.10), MAT_INTAKE)
add_box('Cockpit_Seat', (0.0, -0.55, 0.26), (0.19, 0.26, 0.16), MAT_METAL)
add_box('Cockpit_SeatBack', (0.0, -0.24, 0.42), (0.19, 0.06, 0.24), MAT_METAL)
add_box('Cockpit_Headrest', (0.0, -0.18, 0.66), (0.11, 0.05, 0.07), MAT_GOLD_LIGHT)
add_box('Cockpit_Console', (0.0, -1.28, 0.20), (0.30, 0.24, 0.10), MAT_HULL2)
add_box('Cockpit_Panel', (0.0, -1.52, 0.30), (0.30, 0.03, 0.11), MAT_INTAKE)
add_box('Cockpit_Screen', (0.0, -1.54, 0.33), (0.20, 0.008, 0.06), MAT_GLOW_WARM)
add_pipe('Cockpit_Stick', [(0.0, -1.02, 0.22), (0.0, -1.06, 0.42)], 0.022, MAT_METAL, 10)
add_box('Cockpit_StickGrip', (0.0, -1.06, 0.45), (0.035, 0.035, 0.05), MAT_INTAKE)
for side in (-1, 1):
    add_box(f'Cockpit_SideConsole_{side}', (0.36 * side, -1.1, 0.16), (0.10, 0.30, 0.07), MAT_HULL2)
    add_box(f'Cockpit_Sill_{side}', (0.50 * side, -1.6, 0.03), (0.03, 1.2, 0.03), MAT_GOLD)
    add_pipe(f'Cockpit_HUDFrame_{side}', [(0.14 * side, -1.62, 0.36), (0.14 * side, -1.55, 0.55), (0.10 * side, -1.40, 0.60)], 0.012, MAT_METAL, 8)
add_box('Cockpit_HUD', (0.0, -1.56, 0.46), (0.13, 0.006, 0.09), MAT_GLASS)

# gold trim along both canopy rails
for side in (-1, 1):
    rail = []
    for y, w, h in CANOPY_DENSE:
        base = hull_h_at(y) - 0.035
        rail.append((w * side, y, base + 0.005))
        rail.append((w * side + 0.035 * side, y, base + 0.03))
    rail_faces = []
    for i in range(len(CANOPY_DENSE) - 1):
        a = i * 2
        rail_faces.append((a, a + 1, a + 3, a + 2))
    add_mesh(f'Canopy_Rail_{side}', rail, rail_faces, [MAT_GOLD])'''

s = s[:start] + new + s[end:]
p.write_text(s, encoding='utf-8')
print('canopy replaced')
