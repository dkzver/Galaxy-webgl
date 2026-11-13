import bpy
import math
import os
from mathutils import Vector
import mathutils

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'assets', 'ship_model')
RENDERS = os.path.join(OUT, 'renders')
os.makedirs(RENDERS, exist_ok=True)

# --------------------------------------------------------------------------
# Clean scene
# --------------------------------------------------------------------------
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
for block in (bpy.data.meshes, bpy.data.materials, bpy.data.cameras, bpy.data.lights):
    for item in list(block):
        if item.users == 0:
            block.remove(item)


def make_mat(name, color, metallic=0.0, roughness=0.5, emission=None, strength=0.0):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = next((node for node in mat.node_tree.nodes if node.type == 'BSDF_PRINCIPLED'), None)
    if bsdf is None:
        raise RuntimeError(f'no Principled BSDF in {name}')
    bsdf.inputs['Base Color'].default_value = (*color, 1.0)
    bsdf.inputs['Metallic'].default_value = metallic
    bsdf.inputs['Roughness'].default_value = roughness
    if emission:
        for key in ('Emission Color', 'Emission'):
            if key in bsdf.inputs:
                bsdf.inputs[key].default_value = (*emission, 1.0)
                break
        if 'Emission Strength' in bsdf.inputs:
            bsdf.inputs['Emission Strength'].default_value = strength
    mat.diffuse_color = (*color, 1.0)
    return mat


MAT_HULL = make_mat('Hull_Black', (0.030, 0.038, 0.048), 0.55, 0.38)
MAT_HULL2 = make_mat('Hull_Dark', (0.038, 0.045, 0.056), 0.48, 0.48)
MAT_GOLD = make_mat('Panel_Gold', (0.58, 0.32, 0.070), 0.55, 0.44)
MAT_GOLD_LIGHT = make_mat('Panel_Gold_Light', (0.78, 0.47, 0.13), 0.55, 0.32)
MAT_GLASS = make_mat('Canopy_Glass', (0.002, 0.005, 0.010), 0.0, 0.65)
_glass_bsdf = next((node for node in MAT_GLASS.node_tree.nodes if node.type == 'BSDF_PRINCIPLED'), None)
if _glass_bsdf and 'Specular IOR Level' in _glass_bsdf.inputs:
    _glass_bsdf.inputs['Specular IOR Level'].default_value = 0.03
MAT_GLOW = make_mat('Engine_Glow', (0.2, 0.03, 0.002), 0.0, 0.25,
                    emission=(1.0, 0.22, 0.015), strength=10.0)
MAT_GLOW_WARM = make_mat('Light_Warm', (0.3, 0.1, 0.01), 0.0, 0.2,
                         emission=(1.0, 0.45, 0.12), strength=2.6)
MAT_METAL = make_mat('Gear_Metal', (0.07, 0.075, 0.085), 0.8, 0.3)
MAT_INTAKE = make_mat('Intake_Dark', (0.004, 0.005, 0.007), 0.2, 0.7)


def apply_texture(mat, filename, normal_filename=None):
    path = os.path.join(OUT, 'textures', filename)
    if not os.path.exists(path):
        return
    bsdf = next((node for node in mat.node_tree.nodes if node.type == 'BSDF_PRINCIPLED'), None)
    if bsdf is None:
        return
    tex = mat.node_tree.nodes.new('ShaderNodeTexImage')
    tex.image = bpy.data.images.load(path)
    tex.location = (-420, 220)
    coord = mat.node_tree.nodes.new('ShaderNodeTexCoord')
    coord.location = (-820, 220)
    mapping = mat.node_tree.nodes.new('ShaderNodeMapping')
    mapping.location = (-620, 220)
    mapping.inputs['Scale'].default_value = (2.2, 2.2, 1.0) if 'Gold' in mat.name else (3.5, 3.5, 1.0)
    mat.node_tree.links.new(coord.outputs['UV'], mapping.inputs['Vector'])
    mat.node_tree.links.new(mapping.outputs['Vector'], tex.inputs['Vector'])
    mat.node_tree.links.new(tex.outputs['Color'], bsdf.inputs['Base Color'])

    if normal_filename:
        npath = os.path.join(OUT, 'textures', normal_filename)
        if os.path.exists(npath):
            ntex = mat.node_tree.nodes.new('ShaderNodeTexImage')
            ntex.image = bpy.data.images.load(npath)
            ntex.image.colorspace_settings.name = 'Non-Color'
            ntex.location = (-420, -80)
            nmap = mat.node_tree.nodes.new('ShaderNodeNormalMap')
            nmap.location = (-180, -80)
            nmap.inputs['Strength'].default_value = 1.0
            mat.node_tree.links.new(mapping.outputs['Vector'], ntex.inputs['Vector'])
            mat.node_tree.links.new(ntex.outputs['Color'], nmap.inputs['Color'])
            mat.node_tree.links.new(nmap.outputs['Normal'], bsdf.inputs['Normal'])

    rpath = os.path.join(OUT, 'textures', filename.replace('.png', '_r.png'))
    if os.path.exists(rpath):
        rtex = mat.node_tree.nodes.new('ShaderNodeTexImage')
        rtex.image = bpy.data.images.load(rpath)
        rtex.image.colorspace_settings.name = 'Non-Color'
        rtex.location = (-420, -360)
        mat.node_tree.links.new(mapping.outputs['Vector'], rtex.inputs['Vector'])
        mat.node_tree.links.new(rtex.outputs['Color'], bsdf.inputs['Roughness'])


apply_texture(MAT_HULL, 'panels_black.png', 'panels_black_n.png')
apply_texture(MAT_HULL2, 'panels_dark.png', 'panels_dark_n.png')
apply_texture(MAT_GOLD, 'panels_gold.png', 'panels_gold_n.png')
apply_texture(MAT_GOLD_LIGHT, 'panels_gold.png', 'panels_gold_n.png')


def add_mesh(name, verts, faces, mats, face_mats=None, smooth=False):
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(verts, [], faces)
    mesh.validate()
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    for mat in mats:
        obj.data.materials.append(mat)
    if face_mats:
        for i, poly in enumerate(mesh.polygons):
            poly.material_index = face_mats[i] if i < len(face_mats) else 0
    for poly in mesh.polygons:
        poly.use_smooth = smooth
    return obj


def add_ring_y(name, cx, cz, y0, y1, r_out, r_in, sides, mat):
    verts = []
    for y, r in ((y0, r_out), (y0, r_in), (y1, r_out), (y1, r_in)):
        for k in range(sides):
            a = 2 * math.pi * k / sides
            verts.append((cx + math.cos(a) * r, y, cz + math.sin(a) * r))
    faces = []
    s = sides
    for k in range(s):
        n = (k + 1) % s
        faces.append((k, n, 2 * s + n, 2 * s + k))
        faces.append((s + n, s + k, 3 * s + k, 3 * s + n))
        faces.append((k, s + k, s + n, n))
        faces.append((2 * s + k, 2 * s + n, 3 * s + n, 3 * s + k))
    return add_mesh(name, verts, faces, [mat])


def add_box(name, center, half, mat, rot_z=0.0):
    cx, cy, cz = center
    hx, hy, hz = half
    corners = [
        (-hx, -hy, -hz), (hx, -hy, -hz), (hx, hy, -hz), (-hx, hy, -hz),
        (-hx, -hy, hz), (hx, -hy, hz), (hx, hy, hz), (-hx, hy, hz)
    ]
    c, s = math.cos(rot_z), math.sin(rot_z)
    verts = [(cx + x * c - y * s, cy + x * s + y * c, cz + z) for x, y, z in corners]
    faces = [(0, 1, 2, 3), (4, 7, 6, 5), (0, 4, 5, 1), (1, 5, 6, 2), (2, 6, 7, 3), (3, 7, 4, 0)]
    return add_mesh(name, verts, faces, [mat])


def add_pipe(name, points, radius, mat, sides=8):
    verts = []
    for i, (x, y, z) in enumerate(points):
        if i == 0:
            dx, dy, dz = points[1][0] - x, points[1][1] - y, points[1][2] - z
        elif i == len(points) - 1:
            dx, dy, dz = x - points[i - 1][0], y - points[i - 1][1], z - points[i - 1][2]
        else:
            dx, dy, dz = points[i + 1][0] - points[i - 1][0], points[i + 1][1] - points[i - 1][1], points[i + 1][2] - points[i - 1][2]
        length = math.sqrt(dx * dx + dy * dy + dz * dz) or 1
        ux, uy, uz = dx / length, dy / length, dz / length
        px, py, pz = (0, 1, 0) if abs(uy) < 0.9 else (1, 0, 0)
        tx, ty, tz = uy * pz - uz * py, uz * px - ux * pz, ux * py - uy * px
        tl = math.sqrt(tx * tx + ty * ty + tz * tz) or 1
        tx, ty, tz = tx / tl, ty / tl, tz / tl
        bx, by, bz = uy * tz - uz * ty, uz * tx - ux * tz, ux * ty - uy * tx
        for k in range(sides):
            a = 2 * math.pi * k / sides
            verts.append((x + (tx * math.cos(a) + bx * math.sin(a)) * radius,
                          y + (ty * math.cos(a) + by * math.sin(a)) * radius,
                          z + (tz * math.cos(a) + bz * math.sin(a)) * radius))
    faces = []
    for i in range(len(points) - 1):
        for k in range(sides):
            a = i * sides + k
            b = i * sides + (k + 1) % sides
            c = (i + 1) * sides + (k + 1) % sides
            d = (i + 1) * sides + k
            faces.append((a, b, c, d))
    faces.append(tuple(range(sides - 1, -1, -1)))
    base = (len(points) - 1) * sides
    faces.append(tuple(base + k for k in range(sides)))
    return add_mesh(name, verts, faces, [mat])


def bevel(obj, width=0.018, segments=2):
    if obj is None:
        return
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    mod = obj.modifiers.new('Bevel', 'BEVEL')
    mod.width = width
    mod.segments = segments
    mod.limit_method = 'ANGLE'
    mod.angle_limit = math.radians(35)
    try:
        bpy.ops.object.modifier_apply(modifier=mod.name)
    except Exception:
        pass
    obj.select_set(False)


def bbox_of(objects):
    lo = Vector((1e9, 1e9, 1e9))
    hi = Vector((-1e9, -1e9, -1e9))
    for obj in objects:
        for corner in obj.bound_box:
            p = obj.matrix_world @ Vector(corner)
            lo = Vector((min(lo.x, p.x), min(lo.y, p.y), min(lo.z, p.z)))
            hi = Vector((max(hi.x, p.x), max(hi.y, p.y), max(hi.z, p.z)))
    return lo, hi


def hull_profile(w, h):
    return [
        (0.0, h),
        (w * 0.72, h * 0.72),
        (w, 0.0),
        (w * 0.66, -h * 0.72),
        (0.0, -h),
        (-w * 0.66, -h * 0.72),
        (-w, 0.0),
        (-w * 0.72, h * 0.72)
    ]


# --------------------------------------------------------------------------
# Fuselage
# --------------------------------------------------------------------------
HULL_RINGS = [
    (-10.6, 0.04, 0.04),
    (-9.1, 0.42, 0.35),
    (-7.4, 0.86, 0.64),
    (-5.2, 1.30, 0.94),
    (-2.6, 1.64, 1.10),
    (0.2, 1.82, 1.20),
    (2.6, 1.72, 1.10),
    (4.8, 1.36, 0.90),
    (6.6, 0.80, 0.55),
    (7.7, 0.22, 0.18)
]

verts = []
for y, w, h in HULL_RINGS:
    verts.extend([(x, y, z) for x, z in hull_profile(w, h)])

faces = []
for ring in range(len(HULL_RINGS) - 1):
    for k in range(8):
        a = ring * 8 + k
        b = ring * 8 + (k + 1) % 8
        c = (ring + 1) * 8 + (k + 1) % 8
        d = (ring + 1) * 8 + k
        faces.append((a, b, c, d))
faces.append(tuple(range(7, -1, -1)))
last = (len(HULL_RINGS) - 1) * 8
faces.append(tuple(last + k for k in range(8)))

def hull_dims(y):
    for i in range(len(HULL_RINGS) - 1):
        y0, w0, h0 = HULL_RINGS[i]
        y1, w1, h1 = HULL_RINGS[i + 1]
        if min(y0, y1) <= y <= max(y0, y1):
            t = (y - y0) / (y1 - y0)
            e = t * t * (3 - 2 * t)
            return w0 + (w1 - w0) * e, h0 + (h1 - h0) * e
    y0, w0, h0 = HULL_RINGS[-1]
    return w0, h0


def hull_surf(y, ang, scale=1.0):
    w, h = hull_dims(y)
    ca, sa = math.cos(ang), math.sin(ang)
    x = math.copysign(abs(ca) ** 0.85, ca) * w * scale
    z = math.copysign(abs(sa) ** 0.92, sa) * h * scale
    return x, z


def hull_surface_patch(name, y0, y1, a0, a1, mat, lift=1.02):
    pts = []
    for y, a in ((y0, a0), (y1, a0), (y1, a1), (y0, a1)):
        x, z = hull_surf(y, a, lift)
        pts.append((x, y, z))
    return add_mesh(name, pts, [(0, 1, 2, 3)], [mat])


# dense fuselage loft
HULL_SIDES = 64
DENSE = []
for i in range(len(HULL_RINGS) - 1):
    y0, w0, h0 = HULL_RINGS[i]
    y1, w1, h1 = HULL_RINGS[i + 1]
    steps = 8
    for s in range(steps):
        t = s / steps
        e = t * t * (3 - 2 * t)
        DENSE.append((y0 + (y1 - y0) * t, w0 + (w1 - w0) * e, h0 + (h1 - h0) * e))
DENSE.append(HULL_RINGS[-1])

hull_verts = []
for y, w, h in DENSE:
    for k in range(HULL_SIDES):
        a = 2 * math.pi * k / HULL_SIDES
        ca, sa = math.cos(a), math.sin(a)
        hull_verts.append((math.copysign(abs(ca) ** 0.85, ca) * w, y,
                           math.copysign(abs(sa) ** 0.92, sa) * h))

hull_faces = []
for ring in range(len(DENSE) - 1):
    for k in range(HULL_SIDES):
        a = ring * HULL_SIDES + k
        b = ring * HULL_SIDES + (k + 1) % HULL_SIDES
        c = (ring + 1) * HULL_SIDES + (k + 1) % HULL_SIDES
        d = (ring + 1) * HULL_SIDES + k
        hull_faces.append((a, b, c, d))
first = tuple(range(HULL_SIDES - 1, -1, -1))
hull_faces.append(first)
last_ring = (len(DENSE) - 1) * HULL_SIDES
hull_faces.append(tuple(last_ring + k for k in range(HULL_SIDES)))

fuselage = add_mesh('Fuselage', hull_verts, hull_faces, [MAT_HULL], smooth=True)

# gold side panels along the nose
for side in (-1, 1):
    levels = [-7.8, -4.8, -1.8]
    panel_verts = []
    for y in levels:
        w, h = hull_dims(y)
        for ang in (0.30, 1.05):
            x, z = hull_surf(y, ang if side > 0 else math.pi - ang, 1.015)
            panel_verts.append((x, y, z))
    pf = [(0, 1, 3, 2), (2, 3, 5, 4)]
    add_mesh(f'Nose_Gold_{side}', panel_verts, pf, [MAT_GOLD])

# --------------------------------------------------------------------------
# Wings (mirrored wedge + gold inner plate)
# --------------------------------------------------------------------------
def wing(side):
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


def add_cylinder_y(name, cx, cz, stations, sides, mat):
    verts = []
    for y, r in stations:
        for k in range(sides):
            a = 2 * math.pi * k / sides
            verts.append((cx + math.cos(a) * r, y, cz + math.sin(a) * r))
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
    return add_mesh(name, verts, faces, [mat])


wing(-1)
wing(1)

# forward canard blades near the nose
for side in (-1, 1):
    sx = side
    plan = [(1.35, -6.4), (3.0, -4.9), (3.35, -3.5), (1.55, -3.2)]
    top = [(x * sx, y, 0.06) for x, y in plan]
    bottom = [(x * sx, y, -0.06) for x, y in plan]
    cv = top + bottom
    cf = [(0, 1, 2, 3), (7, 6, 5, 4)]
    for i in range(4):
        j = (i + 1) % 4
        cf.append((i, 4 + i, 4 + j, j))
    add_mesh(f'Canard_{side}', cv, cf, [MAT_HULL])
    plate = [(1.55, -5.9), (2.55, -4.85), (2.75, -3.9), (1.7, -3.7)]
    add_mesh(f'Canard_Gold_{side}', [(x * sx, y, 0.075) for x, y in plate], [(0, 1, 2, 3)], [MAT_GOLD])

# --------------------------------------------------------------------------
# Engine nacelles: body, gold band, intake, glow
# --------------------------------------------------------------------------
NAC_CX = 3.15


def nacelle(side):
    cx = NAC_CX * side
    S = 64
    cz = 0.78
    add_cylinder_y(f'Nacelle_{side}', cx, cz,
                   [(0.72, 0.58), (0.95, 0.80), (1.18, 0.90), (1.5, 0.945), (2.1, 0.965),
                    (3.0, 0.975), (4.2, 0.985), (5.4, 0.975), (6.2, 0.945), (6.8, 0.88),
                    (7.15, 0.76), (7.32, 0.62)],
                   S, MAT_HULL)
    add_cylinder_y(f'Nacelle_Gold_{side}', cx, cz,
                   [(2.55, 0.995), (3.55, 0.995)], S, MAT_GOLD)
    add_ring_y(f'Intake_Rim_{side}', cx, cz, 0.70, 0.86, 0.66, 0.50, S, MAT_INTAKE)
    add_ring_y(f'Intake_Lip_{side}', cx, cz, 0.68, 0.88, 0.72, 0.60, S, MAT_GOLD_LIGHT)
    add_cylinder_y(f'Intake_Back_{side}', cx, cz,
                   [(1.02, 0.56), (1.06, 0.54)], S, MAT_INTAKE)
    add_ring_y(f'Nozzle_{side}', cx, cz, 7.10, 7.30, 0.70, 0.50, S, MAT_METAL)
    add_ring_y(f'Nozzle_Glow_{side}', cx, cz, 7.27, 7.31, 0.50, 0.34, S, MAT_GLOW)
    add_cylinder_y(f'Nozzle_Core_{side}', cx, cz,
                   [(7.30, 0.34), (7.40, 0.25)], S, MAT_METAL)
    # petal segments on the nozzle
    for k in range(16):
        a = 2 * math.pi * k / 16
        x0 = cx + math.cos(a) * 0.52
        z0 = cz + math.sin(a) * 0.52
        x1 = cx + math.cos(a) * 0.67
        z1 = cz + math.sin(a) * 0.67
        dx, dz = x1 - x0, z1 - z0
        ln = math.hypot(dx, dz) or 1
        nx, nz = -dz / ln * 0.035, dx / ln * 0.035
        verts = [
            (x0 - nx, 7.11, z0 - nz), (x0 + nx, 7.11, z0 + nz),
            (x1 + nx, 7.26, z1 + nz), (x1 - nx, 7.26, z1 - nz)
        ]
        add_mesh(f'Nozzle_Petal_{side}_{k}', verts, [(0, 1, 2, 3)], [MAT_METAL])
    # pylon fairing linking pod to the wing
    add_box(f'Pod_Pylon_{side}', (cx, 3.2, -0.05), (0.34, 1.8, 0.18), MAT_HULL2)


nacelle(-1)
nacelle(1)

# --------------------------------------------------------------------------
# Rear booms / stabiliser prongs
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
         sides=32, zbase=-0.16, tip_from=3)
    boom(side, 'inner', [(3.90, 1.55, 0.17), (5.60, 1.62, 0.13), (7.30, 1.68, 0.09),
                         (8.80, 1.72, 0.05), (9.70, 1.75, 0.022)],
         sides=24, zbase=-0.30, tip_from=3)

# Tail fins
# --------------------------------------------------------------------------
def fin(side):
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
    add_mesh(f'Fin_{side}', verts, faces, [MAT_HULL], smooth=True)
    # gold leading edge strip
    lead = [(4.60, 0.38), (6.06, 2.55), (6.24, 2.55), (4.86, 0.38)]
    lv = [(1.50 * sx, y, z) for y, z in lead] + [(1.24 * sx, y, z) for y, z in lead]
    lf = [(0, 1, 2, 3), (7, 6, 5, 4)]
    for i in range(4):
        j = (i + 1) % 4
        lf.append((i, 4 + i, 4 + j, j))
    add_mesh(f'Fin_Gold_{side}', lv, lf, [MAT_GOLD])


fin(-1)
fin(1)

# --------------------------------------------------------------------------
# Canopy (glass)
# --------------------------------------------------------------------------
CANOPY = [
    (-5.2, 0.22, 0.15), (-4.2, 0.52, 0.40), (-3.0, 0.82, 0.60),
    (-1.2, 0.95, 0.68), (0.8, 0.82, 0.56), (2.0, 0.52, 0.32), (2.7, 0.18, 0.10)
]


def hull_h_at(y):
    for i in range(len(HULL_RINGS) - 1):
        y0, _, h0 = HULL_RINGS[i]
        y1, _, h1 = HULL_RINGS[i + 1]
        if min(y0, y1) <= y <= max(y0, y1):
            t = (y - y0) / (y1 - y0)
            return h0 + (h1 - h0) * t
    return 0.2


CANOPY_DENSE = []
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
    add_mesh(f'Canopy_Rail_{side}', rail, rail_faces, [MAT_GOLD])

# --------------------------------------------------------------------------
# Landing gear (hidden from orthos)
# --------------------------------------------------------------------------
GEAR = []


def add_cylinder(name, loc, radius, depth, rotation=(0, 0, 0), vertices=10, mat=MAT_METAL):
    bpy.ops.mesh.primitive_cylinder_add(vertices=vertices, radius=radius, depth=depth, location=loc, rotation=rotation)
    obj = bpy.context.object
    obj.name = name
    obj.data.materials.append(mat)
    return obj


def gear_leg(name, x, y, z_top, z_bottom, wheel_radius=0.24, wheel_width=0.16):
    length = z_top - z_bottom
    strut = add_cylinder(f'{name}_Strut', (x, y, z_top - length / 2), 0.075, length, vertices=10)
    GEAR.append(strut)
    # telescopic inner piston
    piston = add_cylinder(f'{name}_Piston', (x, y, z_bottom + length * 0.30), 0.048, length * 0.42, vertices=8)
    GEAR.append(piston)
    # diagonal brace
    brace = add_pipe(f'{name}_Brace', [(x * 0.82, y + 0.55, z_top + 0.05), (x, y, z_top - length * 0.45)], 0.032, MAT_METAL, 8)
    GEAR.append(brace)
    # axle + wheel + hub
    axle = add_cylinder(f'{name}_Axle', (x, y, z_bottom), 0.045, wheel_width + 0.10, rotation=(0, math.pi / 2, 0), vertices=8)
    GEAR.append(axle)
    wheel = add_cylinder(f'{name}_Wheel', (x, y, z_bottom), wheel_radius, wheel_width, rotation=(0, math.pi / 2, 0), vertices=16)
    GEAR.append(wheel)
    hub = add_cylinder(f'{name}_Hub', (x, y, z_bottom), wheel_radius * 0.42, wheel_width + 0.03, rotation=(0, math.pi / 2, 0), vertices=12, mat=MAT_GOLD_LIGHT)
    GEAR.append(hub)
    # fork plates
    for sx in (-1, 1):
        GEAR.append(add_box(f'{name}_Fork_{sx}', (x + sx * wheel_width * 0.62, y, z_bottom + wheel_radius * 0.55),
                            (0.018, 0.06, wheel_radius * 0.55), MAT_METAL))


gear_leg('Gear_Nose', 0.0, -5.6, -0.62, -1.62, 0.22, 0.13)
gear_leg('Gear_L', -2.9, 2.4, -1.02, -1.86, 0.28, 0.20)
gear_leg('Gear_R', 2.9, 2.4, -1.02, -1.86, 0.28, 0.20)

# gear bay doors (visible thin panels under hull)
for x, y, w, h in [(0.0, -5.6, 0.42, 1.1), (-2.9, 2.4, 0.7, 1.3), (2.9, 2.4, 0.7, 1.3)]:
    verts = [
        (x - w / 2, y - h / 2, -0.92), (x + w / 2, y - h / 2, -0.92),
        (x + w / 2, y + h / 2, -0.92), (x - w / 2, y + h / 2, -0.92)
    ]
    add_mesh(f'Gear_Door_{x}_{y}', verts, [(0, 1, 2, 3)], [MAT_HULL2])

for obj in GEAR:
    obj.hide_render = True
    obj.hide_set(True)

# --------------------------------------------------------------------------
# Small details: sensor, lights, panels
# --------------------------------------------------------------------------
add_cylinder_y('Nose_Sensor', 0, 0.04, [(-9.3, 0.09), (-8.8, 0.13)], 8, MAT_METAL)

# dorsal spine
spine_v = [
    (-0.30, -1.0, 1.18), (0.30, -1.0, 1.18), (0.30, 6.2, 0.88), (-0.30, 6.2, 0.88),
    (-0.30, -1.0, 1.34), (0.30, -1.0, 1.34), (0.30, 6.2, 1.02), (-0.30, 6.2, 1.02)
]
spine_f = [(0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7), (4, 5, 6, 7)]
add_mesh('Dorsal_Spine', spine_v, spine_f, [MAT_HULL2])
add_mesh('Dorsal_Gold', [(-0.12, -0.9, 1.345), (0.12, -0.9, 1.345), (0.12, 6.1, 1.025), (-0.12, 6.1, 1.025)], [(0, 1, 2, 3)], [MAT_GOLD])

for side in (-1, 1):
    # small light near intake
    add_cylinder_y(f'Intake_Light_{side}', NAC_CX * side, 0.78,
                   [(1.02, 0.08), (1.08, 0.08)], 8, MAT_GLOW_WARM)
    # warm strip along the outer boom
    bv = [
        (5.02 * side, 9.2, -0.03), (5.09 * side, 9.2, -0.03),
        (4.96 * side, 6.2, -0.03), (4.89 * side, 6.2, -0.03)
    ]
    add_mesh(f'Boom_Light_{side}', bv, [(0, 1, 2, 3)], [MAT_GLOW_WARM])

# --------------------------------------------------------------------------
# High-detail additions: panels, vents, fan blades, pipes, frames
# --------------------------------------------------------------------------
def xz_blade(name, cx, cz, y, angle, length, width, depth, mat):
    ca, sa = math.cos(angle), math.sin(angle)
    ux, uz = ca * length / 2, sa * length / 2
    vx, vz = -sa * width / 2, ca * width / 2
    verts = [
        (cx + ux + vx, y - depth / 2, cz + uz + vz), (cx + ux - vx, y - depth / 2, cz + uz - vz),
        (cx - ux - vx, y - depth / 2, cz - uz - vz), (cx - ux + vx, y - depth / 2, cz - uz + vz),
        (cx + ux + vx, y + depth / 2, cz + uz + vz), (cx + ux - vx, y + depth / 2, cz + uz - vz),
        (cx - ux - vx, y + depth / 2, cz - uz - vz), (cx - ux + vx, y + depth / 2, cz - uz + vz)
    ]
    faces = [(0, 1, 2, 3), (4, 7, 6, 5), (0, 4, 5, 1), (1, 5, 6, 2), (2, 6, 7, 3), (3, 7, 4, 0)]
    return add_mesh(name, verts, faces, [mat])


for side in (-1, 1):
    cx = NAC_CX * side
    # intake fan
    for i in range(12):
        xz_blade(f'Intake_Blade_{side}_{i}', cx, 0.78, 0.80, 2 * math.pi * i / 12, 0.74, 0.055, 0.03, MAT_METAL)
    add_cylinder_y(f'Intake_Hub_{side}', cx, 0.78, [(0.76, 0.15), (0.86, 0.11)], 16, MAT_GOLD_LIGHT)
    # nozzle turbine
    for i in range(12):
        xz_blade(f'Nozzle_Blade_{side}_{i}', cx, 0.78, 7.33, 2 * math.pi * i / 12, 0.58, 0.075, 0.03, MAT_GOLD_LIGHT)
    # pod rings
    for y in (1.22, 6.6):
        add_cylinder_y(f'Pod_Ring_{side}_{y}', cx, 0.78, [(y - 0.035, 0.99), (y + 0.035, 0.99)], 20, MAT_GOLD_LIGHT)
    # longitudinal ribs
    for k in range(6):
        a = 2 * math.pi * k / 6 + 0.2
        pts = []
        for y in (1.3, 2.6, 4.0, 5.4, 6.4):
            pts.append((cx + math.cos(a) * 0.978, y, 0.78 + math.sin(a) * 0.978))
        add_pipe(f'Pod_Rib_{side}_{k}', pts, 0.022, MAT_HULL2 if k % 2 else MAT_GOLD, 6)
    # top vents
    for i in range(5):
        add_box(f'Pod_Vent_{side}_{i}', (cx, 2.4 + i * 0.26, 1.725), (0.26, 0.05, 0.012), MAT_INTAKE)
    add_box(f'Pod_Vent_Frame_{side}', (cx, 2.92, 1.745), (0.30, 0.58, 0.008), MAT_GOLD)

    # wing panel seams + leading edge
    add_pipe(f'Wing_Lead_{side}', [(1.15 * side, -2.40, 0.012), (3.85 * side, -0.55, 0.010), (6.58 * side, 1.30, 0.008)], 0.028, MAT_GOLD, 10)

    # boom rings
    for y, r, bx in ((5.6, 0.155, 5.05), (7.4, 0.112, 5.10), (9.1, 0.066, 5.15)):
        add_cylinder_y(f'Boom_Ring_{side}_{y}', bx * side, -0.16, [(y - 0.04, r + 0.02), (y + 0.04, r + 0.02)], 16, MAT_GOLD_LIGHT)
    # inner prong collars
    for y, r, bx in ((5.6, 0.132, 1.62), (7.3, 0.092, 1.68)):
        add_cylinder_y(f'Prong_Ring_{side}_{y}', bx * side, -0.30, [(y - 0.03, r + 0.018), (y + 0.03, r + 0.018)], 12, MAT_GOLD_LIGHT)

# fuselage panel seams and dorsal details
for side in (-1, 1):
    pts = []
    for y in (-8.5, -6.0, -3.5, -1.0, 1.5, 4.0, 6.0):
        for i in range(len(HULL_RINGS) - 1):
            y0, w0, h0 = HULL_RINGS[i]
            y1, w1, h1 = HULL_RINGS[i + 1]
            if min(y0, y1) <= y <= max(y0, y1):
                t = (y - y0) / (y1 - y0)
                w = w0 + (w1 - w0) * t
                h = h0 + (h1 - h0) * t
                break
        px, pz = hull_profile(w, h)[1]
        pts.append((px * side * 1.012, y, pz * 1.012))
    add_pipe(f'Hull_Seam_{side}', pts, 0.012, MAT_HULL2, 6)

# canopy frames
for yf in (-3.6, -1.4, 0.8):
    for i in range(len(CANOPY) - 1):
        y0, w0, h0 = CANOPY[i]
        y1, w1, h1 = CANOPY[i + 1]
        if min(y0, y1) <= yf <= max(y0, y1):
            t = (yf - y0) / (y1 - y0)
            w = w0 + (w1 - w0) * t
            h = h0 + (h1 - h0) * t
            break
    base = hull_h_at(yf) - 0.03
    add_pipe(f'Canopy_Frame_{yf}', [(-w * 0.86, yf, base + h * 0.82), (0, yf, base + h + 0.005), (w * 0.86, yf, base + h * 0.82)], 0.012, MAT_HULL2, 6)
add_pipe('Canopy_Spine', [(0, y, hull_h_at(y) - 0.03 + h + 0.006) for y, w, h in CANOPY], 0.012, MAT_GOLD, 6)

# nose sensor cluster
for x in (-0.18, 0.18):
    add_cylinder_y(f'Nose_Probe_{x}', x, 0.08, [(-9.8, 0.025), (-9.0, 0.04)], 6, MAT_METAL)
add_box('Nose_Avionics', (0, -8.4, 0.32), (0.34, 0.5, 0.12), MAT_HULL2)
add_box('Nose_Avionics_Gold', (0, -8.4, 0.445), (0.22, 0.38, 0.008), MAT_GOLD)

# underside details
add_box('Belly_Bay', (0, -0.6, -0.91), (0.58, 1.55, 0.03), MAT_INTAKE)
for side in (-1, 1):
    add_pipe(f'Belly_Pipe_{side}', [(1.15 * side, -4.6, -0.95), (1.3 * side, -1.0, -1.02), (1.25 * side, 3.2, -0.98)], 0.035, MAT_METAL, 6)
    add_box(f'Belly_Hatch_{side}', (1.8 * side, 0.2, -0.94), (0.32, 0.7, 0.02), MAT_HULL2)

# tail fin panel lines / gold trim
for side in (-1, 1):
    add_pipe(f'Fin_Edge_{side}', [(1.42 * side, 4.62, 0.42), (1.42 * side, 6.1, 2.53), (1.42 * side, 7.0, 2.53)], 0.018, MAT_GOLD, 6)

# extra layered panels
for side in (-1, 1):
    for iy in range(4):
        y = -5.4 + iy * 2.4
        add_box(f'Hull_Side_Plate_{side}_{iy}', (1.05 * side, y, 0.62), (0.26, 0.55, 0.01), MAT_GOLD if iy % 2 else MAT_HULL2)
    for iy in range(3):
        y = 5.2 + iy * 0.6
        add_box(f'Fin_Plate_{side}_{iy}', (1.38 * side, y, 0.85 + iy * 0.55), (0.035, 0.30, 0.18), MAT_HULL2)


# landing gear hydraulics and hubs
for x, y in ((0.0, -5.6), (-2.9, 2.4), (2.9, 2.4)):
    GEAR.append(add_pipe(f'Gear_Hydraulic_{x}', [(x + 0.09, y, -0.85), (x + 0.07, y, -2.0)], 0.025, MAT_METAL, 6))
    add_box(f'Gear_Bay_Box_{x}', (x, y, -0.86), (0.28, 0.55, 0.05), MAT_INTAKE)

for obj in GEAR:
    obj.hide_render = True
    obj.hide_set(True)

# --------------------------------------------------------------------------
# Surface panel grid, greebles, control surfaces
# --------------------------------------------------------------------------
import random
random.seed(11)

BANDS = [(0.12, 0.78), (0.78, 1.35), (1.35, 1.80),
         (-0.12, -0.78), (-0.78, -1.35), (-1.35, -1.80), (1.80, 2.25), (-1.80, -2.25)]
y = -9.2
while y < 6.5:
    y1 = min(6.5, y + random.uniform(0.30, 0.62))
    for bi, (a0, a1) in enumerate(BANDS):
        if random.random() < 0.45:
            continue
        mat = MAT_HULL
        if bi in (0, 3) and random.random() < 0.12:
            mat = MAT_GOLD
        hull_surface_patch(f'HullPanel_{y:.2f}_{bi}', y + 0.02, y1 - 0.02, a0, a1, mat, 1.006)
    y = y1 + 0.02

# vents and heat sinks on the rear hull sides
for side in (-1, 1):
    for i in range(9):
        yy = 2.6 + i * 0.30
        x, z = hull_surf(yy, 0.45 if side > 0 else math.pi - 0.45, 1.02)
        add_box(f'Vent_{side}_{i}', (x, yy, z), (0.035, 0.11, 0.012), MAT_INTAKE, rot_z=0.0)
    for i in range(6):
        yy = -1.2 + i * 0.42
        x, z = hull_surf(yy, -0.55 if side > 0 else math.pi + 0.55, 1.02)
        add_box(f'VentLow_{side}_{i}', (x, yy, z), (0.03, 0.09, 0.01), MAT_INTAKE)

# antenna blades
for side in (-1, 1):
    x, z = hull_surf(-6.3, 1.15 if side > 0 else math.pi - 1.15, 1.01)
    add_box(f'Antenna_{side}', (x, -6.3, z + 0.10), (0.018, 0.30, 0.12), MAT_HULL2, rot_z=0.15 * side)
    x2, z2 = hull_surf(-7.6, 1.05 if side > 0 else math.pi - 1.05, 1.01)
    add_pipe(f'Antenna_Mast_{side}', [(x2, -7.6, z2), (x2, -7.9, z2 + 0.34)], 0.018, MAT_METAL, 6)

# wing greebles, inside the wing plan
def wing_plan(side):
    return [(x * side, y) for x, y in ((1.15, -2.40), (6.58, 1.30), (6.80, 4.55), (1.85, 5.40))]


def point_in_poly(px, py, poly):
    inside = False
    n = len(poly)
    for i in range(n):
        x0, y0 = poly[i]
        x1, y1 = poly[(i + 1) % n]
        if (y0 > py) != (y1 > py):
            xin = (x1 - x0) * (py - y0) / (y1 - y0) + x0
            if px < xin:
                inside = not inside
    return inside


for side in (-1, 1):
    # trailing edge flaps
    add_box(f'WingFlap_{side}', (4.25 * side, 4.86, 0.10), (1.15, 0.24, 0.035), MAT_GOLD, rot_z=0.08 * side)
    add_box(f'WingFlap2_{side}', (2.55 * side, 5.14, 0.09), (0.60, 0.18, 0.03), MAT_HULL2, rot_z=0.08 * side)
    # navigation light
    add_box(f'NavLight_{side}', (6.62 * side, 2.32, 0.20), (0.035, 0.03, 0.012), MAT_GLOW_WARM)

# nacelle clamps and cooling pipes
for side in (-1, 1):
    cx = NAC_CX * side
    for i in range(5):
        yy = 1.9 + i * 0.8
        add_box(f'Clamp_{side}_{i}', (cx, yy, 1.695), (0.30, 0.045, 0.03), MAT_HULL2)
    add_pipe(f'CoolPipeA_{side}', [(cx - 0.28, 1.1, 1.48), (cx - 0.26, 3.6, 1.71), (cx - 0.18, 6.5, 1.48)], 0.032, MAT_METAL, 8)
    add_pipe(f'CoolPipeB_{side}', [(cx + 0.28, 1.1, 1.48), (cx + 0.26, 3.6, 1.71), (cx + 0.18, 6.5, 1.48)], 0.032, MAT_METAL, 8)
    for i in range(6):
        yy = 2.1 + i * 0.45
        add_box(f'NacFinn_{side}_{i}', (cx, yy, -0.145), (0.18, 0.03, 0.09), MAT_METAL)


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

# flush vents and louvres on the wing skin (raycast placed)
for side in (-1, 1):
    obj = wing_objs[side]
    for row, frac in enumerate((0.30, 0.52, 0.74)):
        for i in range(9):
            t = 0.22 + i * 0.075
            x = (1.35 + t * 5.15) * side
            le_y = -2.40 + 3.70 * t
            te_y = 5.40 - 0.85 * t
            y = le_y + (te_y - le_y) * frac
            z = surface_hit(obj, x, y)
            if z is None:
                continue
            add_box(f'WingLouvre_{side}_{row}_{i}', (x, y, z + 0.004), (0.035, 0.085, 0.006), MAT_INTAKE)

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

# sensor domes, fuel caps, service ports
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
# Bevel primary shells
# --------------------------------------------------------------------------
SHELLS = ['Fuselage', 'Wing_-1', 'Wing_1', 'Nacelle_-1', 'Nacelle_1',
          'Boom_outer_-1', 'Boom_outer_1', 'Boom_inner_-1', 'Boom_inner_1',
          'Fin_-1', 'Fin_1', 'Canopy']
for name in SHELLS:
    bevel(bpy.data.objects.get(name), 0.02, 3)

# subdivision for smooth high-poly shells
for name in SHELLS:
    obj = bpy.data.objects.get(name)
    if not obj:
        continue
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    mod = obj.modifiers.new('Subd', 'SUBSURF')
    mod.levels = 2
    mod.render_levels = 2
    try:
        bpy.ops.object.modifier_apply(modifier=mod.name)
    except Exception as exc:
        print('subd skip', name, exc)
    obj.select_set(False)

# smooth shading everywhere, flat boxes keep crisp edges by angle
bpy.ops.object.select_all(action='DESELECT')
for obj in [o for o in bpy.context.scene.objects if o.type == 'MESH']:
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    try:
        bpy.ops.object.shade_smooth_by_angle(angle=math.radians(38))
    except Exception:
        pass
    obj.select_set(False)
    obj = bpy.data.objects.get(name)
    if obj:
        bpy.context.view_layer.objects.active = obj
        obj.select_set(True)
        try:
            bpy.ops.object.shade_smooth_by_angle(angle=math.radians(32))
        except Exception:
            try:
                bpy.ops.object.shade_smooth()
            except Exception:
                pass
        obj.select_set(False)

# --------------------------------------------------------------------------
# Center model at origin
# --------------------------------------------------------------------------
ship_objects = [o for o in bpy.context.scene.objects if o.type == 'MESH' and o.name not in [g.name for g in GEAR]]
lo, hi = bbox_of(ship_objects)
center = (lo + hi) * 0.5
for obj in bpy.context.scene.objects:
    if obj.type == 'MESH':
        obj.location -= center

root = bpy.data.objects.new('ShipRoot', None)
bpy.context.collection.objects.link(root)
for obj in bpy.context.scene.objects:
    if obj.type == 'MESH':
        obj.parent = root
        obj.matrix_parent_inverse = root.matrix_world.inverted()

# --------------------------------------------------------------------------
# Materials display for viewport / workbench
# --------------------------------------------------------------------------
for mat in bpy.data.materials:
    pass

# UV unwrap all textured meshes
bpy.ops.object.select_all(action='DESELECT')
for obj in [o for o in bpy.context.scene.objects if o.type == 'MESH']:
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    try:
        bpy.ops.object.mode_set(mode='EDIT')
        bpy.ops.mesh.select_all(action='SELECT')
        bpy.ops.uv.smart_project(angle_limit=math.radians(66), island_margin=0.012)
        bpy.ops.object.mode_set(mode='OBJECT')
    except Exception as exc:
        print('UV skip', obj.name, exc)
        try:
            bpy.ops.object.mode_set(mode='OBJECT')
        except Exception:
            pass
    obj.select_set(False)

# --------------------------------------------------------------------------
# Lights and world
# --------------------------------------------------------------------------
world = bpy.data.worlds.new('World')
world.use_nodes = True
bg = next((node for node in world.node_tree.nodes if node.type == 'BACKGROUND'), None)
if bg is None:
    raise RuntimeError('no Background node')
bg.inputs[0].default_value = (0.008, 0.011, 0.016, 1.0)
bg.inputs[1].default_value = 1.0
bpy.context.scene.world = world

def add_area(name, loc, energy, size, color=(1.0, 0.95, 0.88)):
    data = bpy.data.lights.new(name, 'AREA')
    data.energy = energy
    data.shape = 'DISK'
    data.size = size
    data.color = color
    obj = bpy.data.objects.new(name, data)
    bpy.context.collection.objects.link(obj)
    obj.location = loc
    direction = Vector((0, 0, 0)) - Vector(loc)
    obj.rotation_euler = direction.to_track_quat('-Z', 'Y').to_euler()
    return obj


add_area('Key', (12, -14, 16), 4000, 14)
add_area('Fill', (-15, -6, 9), 1800, 16, (0.7, 0.82, 1.0))
add_area('Rim', (0, 16, 12), 3000, 14, (1.0, 0.82, 0.6))
add_area('Bottom', (0, -1, -14), 1400, 22, (0.75, 0.84, 1.0))
add_area('BottomFront', (0, -10, -9), 900, 16, (0.7, 0.8, 1.0))

scene = bpy.context.scene
scene.render.engine = 'BLENDER_EEVEE'
scene.render.resolution_x = 1600
scene.render.resolution_y = 1200
scene.render.resolution_percentage = 100
scene.render.image_settings.file_format = 'PNG'
scene.render.film_transparent = False
scene.render.image_settings.color_mode = 'RGBA'
scene.eevee.taa_render_samples = 24
scene.view_settings.view_transform = 'AgX'
try:
    scene.view_settings.look = 'AgX - Medium High Contrast'
except Exception:
    pass
scene.view_settings.exposure = 0.35

# --------------------------------------------------------------------------
# Camera helpers
# --------------------------------------------------------------------------
def camera(name, loc, target=(0, 0, 0), ortho=True, scale=22.0, lens=55.0):
    data = bpy.data.cameras.new(name)
    data.type = 'ORTHO' if ortho else 'PERSP'
    data.ortho_scale = scale
    data.lens = lens
    data.clip_start = 0.1
    data.clip_end = 300
    obj = bpy.data.objects.new(name, data)
    bpy.context.collection.objects.link(obj)
    obj.location = loc
    direction = Vector(target) - Vector(loc)
    up = 'Y' if abs(direction.z) > 0.9 else 'Z'
    obj.rotation_euler = direction.to_track_quat('-Z', up).to_euler()
    return obj


def render(cam, filename):
    scene.camera = cam
    scene.render.filepath = os.path.join(RENDERS, filename)
    bpy.ops.render.render(write_still=True)
    print('RENDER', filename)


ortho_scale = 26.0
views = {
    'ortho_top.png': ((0, 0, 40), (0, 0, math.pi)),
    'ortho_bottom.png': ((0, 0, -40), (math.pi, 0, 0)),
    'ortho_front.png': ((0, -40, 0), (math.pi / 2, 0, 0)),
    'ortho_back.png': ((0, 40, 0), (math.pi / 2, 0, math.pi)),
    'ortho_left.png': ((-40, 0, 0), (math.pi / 2, 0, -math.pi / 2)),
    'ortho_right.png': ((40, 0, 0), (math.pi / 2, 0, math.pi / 2))
}
for name, (loc, rot) in views.items():
    cam = camera(name.replace('.png', ''), loc, scale=ortho_scale)
    cam.rotation_euler = rot
    render(cam, name)

# detail views
for obj in GEAR:
    obj.hide_render = False
    obj.hide_set(False)

details = [
    ('detail_cockpit.png', (0.9, -9.4, 3.2), (0.0, -2.6, 1.10), 60),
    ('detail_intake.png', (6.7, -4.6, 2.8), (3.05, 0.95, 0.85), 55),
    ('detail_nozzle.png', (7.2, 10.2, 2.8), (3.05, 7.15, 0.80), 55),
    ('detail_wingtip.png', (9.8, 3.4, 3.2), (6.55, 3.9, 0.15), 55),
    ('detail_boom.png', (9.8, 13.6, 3.4), (5.1, 8.4, -0.15), 55),
    ('detail_gear.png', (6.0, -8.6, -4.2), (0.4, -2.6, -1.5), 48),
    ('detail_underside.png', (0.0, -4.0, -19.0), (0.0, -0.5, 0.0), 55),
]
for name, loc, target, lens in details:
    cam = camera(name.replace('.png', ''), loc, target=target, ortho=False, lens=lens)
    render(cam, name)

# hide gear again, hero render with low camera
for obj in GEAR:
    obj.hide_render = True
    obj.hide_set(True)

hero = camera('hero', (13, -20, 9), (0, -0.5, 0.5), ortho=False, lens=55)
render(hero, 'hero_3q.png')

# --------------------------------------------------------------------------
# Join detail meshes into a clean hierarchy
# --------------------------------------------------------------------------
def join_meshes(objects, name):
    if not objects:
        return None
    bpy.ops.object.select_all(action='DESELECT')
    for obj in objects:
        obj.hide_set(False)
        obj.select_set(True)
    bpy.context.view_layer.objects.active = objects[0]
    bpy.ops.object.join()
    joined = bpy.context.view_layer.objects.active
    joined.name = name
    return joined


gear_ids = {obj.name for obj in GEAR}
ship_parts = [o for o in bpy.context.scene.objects if o.type == 'MESH' and o.name not in gear_ids]
gear_parts = [o for o in bpy.context.scene.objects if o.type == 'MESH' and o.name in gear_ids]
ship_obj = join_meshes(ship_parts, 'Ship')
gear_obj = join_meshes(gear_parts, 'LandingGear')
if gear_obj:
    gear_obj.hide_render = True
    gear_obj.hide_set(False)
for obj in (ship_obj, gear_obj):
    if obj:
        obj.parent = root
        obj.matrix_parent_inverse = root.matrix_world.inverted()

# --------------------------------------------------------------------------
# Save + export
# --------------------------------------------------------------------------
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT, 'ship_highpoly.blend'))

bpy.ops.object.select_all(action='DESELECT')
root.select_set(True)
for obj in bpy.context.scene.objects:
    if obj.type == 'MESH':
        obj.select_set(True)
bpy.context.view_layer.objects.active = root

bpy.ops.export_scene.fbx(
    filepath=os.path.join(OUT, 'ship_highpoly.fbx'),
    use_selection=True,
    apply_scale_options='FBX_SCALE_ALL',
    axis_forward='-Z',
    axis_up='Y',
    object_types={'EMPTY', 'MESH'},
    mesh_smooth_type='FACE',
    path_mode='COPY',
    add_leaf_bones=False,
    use_mesh_modifiers=True
)

triangles = 0
for obj in bpy.context.scene.objects:
    if obj.type == 'MESH':
        for poly in obj.data.polygons:
            triangles += max(1, len(poly.vertices) - 2)
print('TRIS', triangles)
print('DONE')
