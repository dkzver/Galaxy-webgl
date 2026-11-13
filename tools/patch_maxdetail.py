from pathlib import Path

p = Path('tools/build_ship_fbx.py')
s = p.read_text(encoding='utf-8')

repls = [
    ("HULL_SIDES = 22", "HULL_SIDES = 64"),
    ("    steps = 4\n", "    steps = 8\n"),
    ("def nacelle(side):\n    cx = NAC_CX * side\n    S = 32\n    cz = 0.78",
     "def nacelle(side):\n    cx = NAC_CX * side\n    S = 64\n    cz = 0.78"),
    ("         sides=16, zbase=-0.16, tip_from=3)", "         sides=32, zbase=-0.16, tip_from=3)"),
    ("         sides=12, zbase=-0.30, tip_from=3)", "         sides=24, zbase=-0.30, tip_from=3)"),
]

for old, new in repls:
    if old not in s:
        print('MISS param:', old[:50])
        continue
    s = s.replace(old, new, 1)

detail = '''
# --------------------------------------------------------------------------
# MAX DETAIL PASS: surface hardware, fasteners, plumbing, engine internals
# --------------------------------------------------------------------------
import mathutils


def surface_hit(obj, x, y, from_z=6.0):
    """Ray-cast down onto an object; returns hit z or None."""
    if obj is None:
        return None
    ok, loc, normal, index = obj.ray_cast(mathutils.Vector((x, y, from_z)),
                                          mathutils.Vector((0, 0, -1)))
    return loc.z if ok else None


def add_bolt(name, loc, axis='Z', radius=0.017, depth=0.012, mat=MAT_METAL):
    rot = (0, 0, 0) if axis == 'Z' else ((0, math.pi / 2, 0) if axis == 'X' else (math.pi / 2, 0, 0))
    return add_cylinder(name, loc, radius, depth, rotation=rot, vertices=10, mat=mat)


wing_objs = {side: bpy.data.objects.get(f'Wing_{side}') for side in (-1, 1)}

# fasteners across the wing skin
for side in (-1, 1):
    obj = wing_objs[side]
    for i in range(46):
        t = i / 45.0
        x = (1.35 + t * 5.15) * side
        for j, frac in enumerate((0.16, 0.42, 0.68, 0.90)):
            le_y = -2.40 + (1.25) * t
            te_y = 5.40 - (0.45) * t
            y = le_y + (te_y - le_y) * frac
            z = surface_hit(obj, x, y)
            if z is None:
                continue
            add_bolt(f'Bolt_Wing_{side}_{i}_{j}', (x, y, z + 0.006))

# access hatches with hinges along the wing
for side in (-1, 1):
    obj = wing_objs[side]
    for i, (fx, fy) in enumerate(((0.35, 0.55), (0.55, 0.72), (0.72, 0.45))):
        x = (1.35 + fx * 5.15) * side
        le_y = -2.40 + 1.25 * fx
        te_y = 5.40 - 0.45 * fx
        y = le_y + (te_y - le_y) * fy
        z = surface_hit(obj, x, y)
        if z is None:
            continue
        add_box(f'Hatch_Wing_{side}_{i}', (x, y, z + 0.012), (0.16, 0.22, 0.012), MAT_HULL2)
        add_box(f'Hatch_Hinge_{side}_{i}', (x, y - 0.22, z + 0.018), (0.10, 0.02, 0.008), MAT_METAL)

# hull fasteners along frame stations
for side in (-1, 1):
    for i in range(34):
        y = -8.6 + i * 0.44
        for ang in (0.55, 1.15, 1.75):
            a = ang if side > 0 else math.pi - ang
            x, z = hull_surf(y, a, 1.02)
            add_bolt(f'Bolt_Hull_{side}_{i}_{int(ang*100)}', (x, y, z), axis='X')

# hull cable bundles along the belly
for side in (-1, 1):
    pts = []
    for i in range(14):
        y = -8.2 + i * 0.98
        x, z = hull_surf(y, -1.05 if side > 0 else math.pi + 1.05, 1.015)
        pts.append((x, y, z - 0.012))
    add_pipe(f'Cable_A_{side}', pts, 0.028, MAT_METAL, 10)
    pts2 = [(x, yy - 0.03, zz - 0.05) for x, yy, zz in pts]
    add_pipe(f'Cable_B_{side}', pts2, 0.020, MAT_INTAKE, 8)

# ventral strakes
for side in (-1, 1):
    for i in range(5):
        y = -3.6 + i * 1.55
        x, z = hull_surf(y, -1.35 if side > 0 else math.pi + 1.35, 1.0)
        add_box(f'Strake_{side}_{i}', (x, y, z - 0.05), (0.02, 0.42, 0.07), MAT_HULL2)

# engine internals: intake turbine stack and afterburner flame holder
for side in (-1, 1):
    cx = NAC_CX * side
    for stage, yy in enumerate((0.98, 1.16, 1.36)):
        add_cylinder_y(f'Turbine_Disk_{side}_{stage}', cx, 0.78, [(yy, 0.30 + stage * 0.03), (yy + 0.06, 0.30 + stage * 0.03)], 32, MAT_METAL)
        for k in range(32):
            a = 2 * math.pi * k / 32
            bx = cx + math.cos(a) * (0.30 + stage * 0.03) * 0.55
            bz = 0.78 + math.sin(a) * (0.30 + stage * 0.03) * 0.55
            add_box(f'Turbine_Blade_{side}_{stage}_{k}', (bx, yy + 0.03, bz), (0.035, 0.012, 0.10), MAT_METAL, rot_z=a)
    # flame holder
    add_cylinder_y(f'FlameHolder_{side}', cx, 0.78, [(7.05, 0.34), (7.12, 0.34)], 32, MAT_GOLD)
    for k in range(24):
        a = 2 * math.pi * k / 24
        bx = cx + math.cos(a) * 0.22
        bz = 0.78 + math.sin(a) * 0.22
        add_box(f'FlameStrut_{side}_{k}', (bx, 7.08, bz), (0.012, 0.05, 0.12), MAT_METAL, rot_z=a)

# nose cannon barrels
for side in (-1, 1):
    add_pipe(f'Cannon_{side}', [(-0.34 * side, -8.3, -0.10), (-0.30 * side, -9.9, -0.06)], 0.035, MAT_METAL, 14)
    add_cylinder_y(f'Cannon_Muzzle_{side}', -0.30 * side, -0.06, [(-9.95, 0.05), (-9.80, 0.05)], 14, MAT_INTAKE)

# RCS thruster clusters
for side in (-1, 1):
    for i, (yy, ang) in enumerate(((-7.4, 0.9), (-6.0, 1.0), (5.6, 1.2), (6.4, 1.3))):
        x, z = hull_surf(yy, ang if side > 0 else math.pi - ang, 1.01)
        add_cylinder_y(f'RCS_{side}_{i}', x, z, [(yy - 0.01, 0.055), (yy + 0.01, 0.075)], 12, MAT_METAL)
        add_cylinder_y(f'RCS_Nozzle_{side}_{i}', x, z, [(yy - 0.05, 0.05), (yy - 0.02, 0.075)], 12, MAT_INTAKE)

# spine antenna array
for i in range(6):
    yy = -1.4 + i * 1.15
    add_box(f'Spine_Blade_{i}', (0.0, yy, 1.36), (0.012, 0.18, 0.10), MAT_HULL2)

# gold trim strips on the fin tips
for side in (-1, 1):
    add_box(f'Fin_TipTrim_{side}', (1.37 * side, 6.55, 2.62), (0.09, 0.45, 0.02), MAT_GOLD)

# --------------------------------------------------------------------------
# Bevel primary shells'''

s = s.replace("# --------------------------------------------------------------------------\n# Bevel primary shells", detail, 1)

# stronger bevel on shells
s = s.replace("    bevel(bpy.data.objects.get(name), 0.016, 2)",
              "    bevel(bpy.data.objects.get(name), 0.02, 3)")

p.write_text(s, encoding='utf-8')
print('detail pass inserted')
