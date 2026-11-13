from pathlib import Path

p = Path('tools/build_ship_fbx.py')
s = p.read_text(encoding='utf-8')

s = s.replace("    mod.levels = 1\n    mod.render_levels = 1", "    mod.levels = 2\n    mod.render_levels = 2")

# extra ultra details inserted before the bevel section
anchor = "# --------------------------------------------------------------------------\n# Bevel primary shells"
extra = '''# sensor domes, fuel caps, service ports
for side in (-1, 1):
    for i, (yy, ang) in enumerate(((-4.9, 1.25), (-2.2, 1.30), (3.4, 1.28), (5.2, 1.30))):
        x, z = hull_surf(yy, ang if side > 0 else math.pi - ang, 1.005)
        add_cylinder_y(f'Sensor_Dome_{side}_{i}', x * 0.98, z, [(yy - 0.10, 0.075), (yy + 0.10, 0.085)], 16, MAT_GLASS)
    # fuel caps
    for i, yy in enumerate((-6.8, -0.4)):
        x, z = hull_surf(yy, 0.25 if side > 0 else math.pi - 0.25, 1.01)
        add_cylinder_y(f'FuelCap_{side}_{i}', x, z, [(yy - 0.09, 0.10), (yy + 0.09, 0.10)], 20, MAT_GOLD_LIGHT)
    # service ports
    for i, yy in enumerate((1.0, 2.2, 3.4)):
        x, z = hull_surf(yy, 1.5 if side > 0 else math.pi - 1.5, 1.008)
        add_box(f'ServicePort_{side}_{i}', (x, yy, z), (0.05, 0.12, 0.012), MAT_HULL2)

# spine conduit and clamps
for i in range(10):
    yy = -0.8 + i * 0.75
    add_box(f'Spine_Clamp_{i}', (0.0, yy, 1.30), (0.16, 0.05, 0.03), MAT_METAL)
add_pipe('Spine_Conduit', [(0.0, -1.0, 1.36), (0.0, 1.4, 1.34), (0.0, 4.0, 1.20), (0.0, 6.1, 1.05)], 0.045, MAT_METAL, 14)

# wing root fairings
for side in (-1, 1):
    add_box(f'RootFairing_{side}', (1.55 * side, 1.2, 0.22), (0.22, 2.4, 0.10), MAT_HULL2, rot_z=0.04 * side)
    add_box(f'RootFairingTrim_{side}', (1.62 * side, 3.4, 0.26), (0.14, 0.5, 0.02), MAT_GOLD)

# nozzle inner cone and heat vanes
for side in (-1, 1):
    cx = NAC_CX * side
    add_cylinder_y(f'Nozzle_Cone_{side}', cx, 0.78, [(7.30, 0.30), (7.52, 0.10)], 32, MAT_METAL)
    for k in range(12):
        a = 2 * math.pi * k / 12
        bx = cx + math.cos(a) * 0.40
        bz = 0.78 + math.sin(a) * 0.40
        add_box(f'HeatVane_{side}_{k}', (bx, 7.20, bz), (0.02, 0.10, 0.05), MAT_GOLD, rot_z=a)

# --------------------------------------------------------------------------
# Bevel primary shells'''

if anchor in s:
    s = s.replace(anchor, extra, 1)
    print('extra details added')
else:
    print('MISS anchor')

# higher render resolution / samples
s = s.replace("scene.eevee.taa_render_samples = 32", "scene.eevee.taa_render_samples = 64")
s = s.replace("scene.render.resolution_x = 1600", "scene.render.resolution_x = 2200")
s = s.replace("scene.render.resolution_y = 1200", "scene.render.resolution_y = 1650")

p.write_text(s, encoding='utf-8')
print('ok')
