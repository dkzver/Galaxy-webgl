import bpy
import bmesh
import math
import os
from mathutils import Vector, Matrix, Euler

def clear_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)

def make_pbr_material(name, base_col, rough, metal, bump_strength=0.1, bump_scale=0.06):
    mat = bpy.data.materials.new(name=name)
    mat.use_nodes = True
    nt = mat.node_tree
    nt.nodes.clear()

    out_node = nt.nodes.new(type='ShaderNodeOutputMaterial')
    bsdf = nt.nodes.new(type='ShaderNodeBsdfPrincipled')
    bsdf.inputs['Base Color'].default_value = base_col
    bsdf.inputs['Roughness'].default_value = rough
    bsdf.inputs['Metallic'].default_value = metal

    if bump_strength > 0:
        tc = nt.nodes.new(type='ShaderNodeTexCoord')
        mapping = nt.nodes.new(type='ShaderNodeMapping')
        mapping.inputs['Scale'].default_value = (bump_scale, bump_scale, bump_scale)
        voronoi = nt.nodes.new(type='ShaderNodeTexVoronoi')
        voronoi.feature = 'F1'
        voronoi.distance = 'CHEBYCHEV'
        voronoi.inputs['Scale'].default_value = 1.0

        bump = nt.nodes.new(type='ShaderNodeBump')
        bump.inputs['Strength'].default_value = bump_strength
        bump.inputs['Distance'].default_value = 1.0

        nt.links.new(tc.outputs['Object'], mapping.inputs['Vector'])
        nt.links.new(mapping.outputs['Vector'], voronoi.inputs['Vector'])
        nt.links.new(voronoi.outputs['Distance'], bump.inputs['Height'])
        nt.links.new(bump.outputs['Normal'], bsdf.inputs['Normal'])

    nt.links.new(bsdf.outputs['BSDF'], out_node.inputs['Surface'])
    return mat

def create_materials():
    mats = {}
    # White Hull with subtle panels
    mats['white'] = make_pbr_material("Mat_Hull_White", (0.84, 0.86, 0.89, 1.0), 0.32, 0.15, bump_strength=0.12)
    # Dark Structural Armor
    mats['dark'] = make_pbr_material("Mat_Hull_Dark", (0.12, 0.13, 0.16, 1.0), 0.42, 0.75, bump_strength=0.08)
    # Orange Sci-Fi Hazard Panels
    mats['orange'] = make_pbr_material("Mat_Hull_Orange", (0.94, 0.46, 0.04, 1.0), 0.35, 0.1, bump_strength=0.1)
    # Grey Technical Metal
    mats['grey'] = make_pbr_material("Mat_Hull_Grey", (0.42, 0.46, 0.52, 1.0), 0.4, 0.35, bump_strength=0.1)

    # Warm Golden Emission for Windows & Docking Guides
    mat_lights = bpy.data.materials.new(name="Mat_Lights_Yellow")
    mat_lights.use_nodes = True
    nt = mat_lights.node_tree
    nt.nodes.clear()
    out_node = nt.nodes.new(type='ShaderNodeOutputMaterial')
    bsdf = nt.nodes.new(type='ShaderNodeBsdfPrincipled')
    bsdf.inputs['Base Color'].default_value = (1.0, 0.76, 0.25, 1.0)
    if 'Emission Color' in bsdf.inputs:
        bsdf.inputs['Emission Color'].default_value = (1.0, 0.74, 0.22, 1.0)
        bsdf.inputs['Emission Strength'].default_value = 8.0
    elif 'Emission' in bsdf.inputs:
        bsdf.inputs['Emission'].default_value = (1.0, 0.74, 0.22, 1.0)
    bsdf.inputs['Roughness'].default_value = 0.2
    nt.links.new(bsdf.outputs['BSDF'], out_node.inputs['Surface'])
    mats['lights'] = mat_lights

    # Red Beacon Light
    mat_beacon = bpy.data.materials.new(name="Mat_Beacon_Red")
    mat_beacon.use_nodes = True
    nt_b = mat_beacon.node_tree
    nt_b.nodes.clear()
    out_b = nt_b.nodes.new(type='ShaderNodeOutputMaterial')
    bsdf_b = nt_b.nodes.new(type='ShaderNodeBsdfPrincipled')
    bsdf_b.inputs['Base Color'].default_value = (1.0, 0.05, 0.05, 1.0)
    if 'Emission Color' in bsdf_b.inputs:
        bsdf_b.inputs['Emission Color'].default_value = (1.0, 0.04, 0.04, 1.0)
        bsdf_b.inputs['Emission Strength'].default_value = 20.0
    elif 'Emission' in bsdf_b.inputs:
        bsdf_b.inputs['Emission'].default_value = (1.0, 0.04, 0.04, 1.0)
    nt_b.links.new(bsdf_b.outputs['BSDF'], out_b.inputs['Surface'])
    mats['beacon'] = mat_beacon

    return mats

def assign_material(obj, mat):
    if obj.data.materials:
        obj.data.materials[0] = mat
    else:
        obj.data.materials.append(mat)


def apply_hard_surface_smooth(obj, angle_deg=35.0):
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    try:
        bpy.ops.object.shade_smooth_by_angle(angle=math.radians(angle_deg))
    except Exception:
        obj.data.shade_smooth()
    obj.select_set(False)

def create_octagonal_tube(name, p1, p2, width, height, chamfer, mats):
    mesh = bpy.data.meshes.new(name)
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)

    bm = bmesh.new()
    v = (p2 - p1)
    length = v.length
    dir_z = v.normalized()
    
    up_ref = Vector((0, 0, 1))
    if abs(dir_z.dot(up_ref)) > 0.99:
        up_ref = Vector((0, 1, 0))
    dir_x = dir_z.cross(up_ref).normalized()
    dir_y = dir_x.cross(dir_z).normalized()

    w2 = width / 2.0
    h2 = height / 2.0
    c = min(chamfer, w2 * 0.8, h2 * 0.8)

    profile_2d = [
        Vector((w2 - c,  h2)),
        Vector((-w2 + c, h2)),
        Vector((-w2,     h2 - c)),
        Vector((-w2,    -h2 + c)),
        Vector((-w2 + c,-h2)),
        Vector((w2 - c, -h2)),
        Vector((w2,     -h2 + c)),
        Vector((w2,      h2 - c)),
    ]

    num_segments = max(8, int(length / 26.0))
    verts_rings = []
    for s in range(num_segments + 1):
        t = s / float(num_segments)
        center = p1 + dir_z * (length * t)
        ring = []
        for p in profile_2d:
            world_p = center + dir_x * p.x + dir_y * p.y
            vert = bm.verts.new(world_p)
            ring.append(vert)
        verts_rings.append(ring)

    for s in range(num_segments):
        r1 = verts_rings[s]
        r2 = verts_rings[s + 1]
        for i in range(8):
            i_next = (i + 1) % 8
            face = bm.faces.new([r1[i], r1[i_next], r2[i_next], r2[i]])
            # Sci-Fi detailing:
            # i=0 (top), i=2,6 (sides), i=4 (bottom), 1,3,5,7 (chamfers)
            if s % 5 == 1 and i in [0, 2, 4, 6]:
                face.material_index = 2 # Orange panel band
            elif i in [2, 6] and (s % 2 == 0):
                face.material_index = 3 # Side glowing windows
            elif i in [1, 3, 5, 7]:
                face.material_index = 1 # Structural dark metal chamfer
            elif s % 4 == 0:
                face.material_index = 4 # Grey tech panel
            else:
                face.material_index = 0 # White hull

    c1 = bm.faces.new(list(reversed(verts_rings[0])))
    c1.material_index = 1
    c2 = bm.faces.new(verts_rings[-1])
    c2.material_index = 1

    bm.to_mesh(mesh)
    bm.free()

    for m in [mats['white'], mats['dark'], mats['orange'], mats['lights'], mats['grey']]:
        obj.data.materials.append(m)

    apply_hard_surface_smooth(obj, 35.0)
    return obj



def build_central_hub(mats):
    hub_objects = []

    profile = [
        # Upper cupola / spire base
        (90, 14, 'dark'),
        (85, 24, 'dark'),
        (76, 38, 'lights'),   # Observation deck windows
        (66, 52, 'white'),
        (58, 70, 'dark'),     # Step ledge
        # Main disk upper shell
        (48, 105, 'white'),
        (38, 134, 'orange'),  # Upper hazard ring
        (26, 144, 'lights'),  # Upper panoramic windows
        (12, 148, 'white'),
        (0,  150, 'dark'),    # Central mechanical belt
        (-12, 148, 'white'),
        (-24, 142, 'lights'), # Lower panoramic windows
        (-36, 130, 'orange'), # Lower hazard ring
        (-46, 105, 'dark'),   # Ledge 1
        # Engineering step 1
        (-50, 92, 'white'),
        (-64, 90, 'lights'),  # Ring lights
        (-72, 78, 'dark'),    # Ledge 2
        # Engineering step 2
        (-76, 70, 'white'),
        (-92, 68, 'lights'),
        (-100, 56, 'dark'),   # Ledge 3
        # Engineering step 3
        (-106, 48, 'white'),
        (-124, 46, 'lights'),
        (-134, 34, 'dark'),   # Ledge 4
        # Engineering step 4 & bottom emitter
        (-142, 28, 'white'),
        (-165, 22, 'lights'),
        (-180, 16, 'dark'),
        (-195, 8,  'white'),
        (-205, 3,  'dark'),   # Lower tip
    ]

    mesh = bpy.data.meshes.new("Central_Hub_Mesh")
    obj = bpy.data.objects.new("Central_Hub", mesh)
    bpy.context.collection.objects.link(obj)

    bm = bmesh.new()
    num_radial = 48

    ring_verts = []
    for z, r, _ in profile:
        ring = []
        for i in range(num_radial):
            angle = i * (2.0 * math.pi / num_radial)
            x = r * math.cos(angle)
            y = r * math.sin(angle)
            ring.append(bm.verts.new(Vector((x, y, z))))
        ring_verts.append(ring)

    mat_map = {'white': 0, 'dark': 1, 'orange': 2, 'lights': 3, 'grey': 4}
    for s in range(len(profile) - 1):
        r1 = ring_verts[s]
        r2 = ring_verts[s + 1]
        mat_key = profile[s][2]
        for i in range(num_radial):
            i_next = (i + 1) % num_radial
            f = bm.faces.new([r1[i], r1[i_next], r2[i_next], r2[i]])
            if mat_key == 'white' and (i % 4 == 0):
                f.material_index = mat_map['grey']
            else:
                f.material_index = mat_map.get(mat_key, 0)

    c1 = bm.faces.new(list(reversed(ring_verts[0])))
    c1.material_index = 1
    c2 = bm.faces.new(ring_verts[-1])
    c2.material_index = 1

    bm.to_mesh(mesh)
    bm.free()

    mat_list = [mats['white'], mats['dark'], mats['orange'], mats['lights'], mats['grey']]
    for m in mat_list:
        obj.data.materials.append(m)

    apply_hard_surface_smooth(obj, 35.0)
    hub_objects.append(obj)

    # Center spire (Z = 90 to 205m)
    bpy.ops.mesh.primitive_cylinder_add(radius=2.6, depth=115, location=(0, 0, 147))
    spire_center = bpy.context.active_object
    spire_center.name = "Spire_Center"
    assign_material(spire_center, mats['dark'])
    apply_hard_surface_smooth(spire_center, 40.0)
    hub_objects.append(spire_center)

    # Beacon light on top of center spire
    bpy.ops.mesh.primitive_uv_sphere_add(radius=4.0, location=(0, 0, 205))
    beacon = bpy.context.active_object
    beacon.name = "Beacon_Red_Top"
    assign_material(beacon, mats['beacon'])
    apply_hard_surface_smooth(beacon, 40.0)
    hub_objects.append(beacon)

    # 4 satellite antennas surrounding center spire
    for i in range(4):
        ang = i * (math.pi / 2.0) + (math.pi / 4.0)
        ax = 16 * math.cos(ang)
        ay = 16 * math.sin(ang)
        bpy.ops.mesh.primitive_cylinder_add(radius=1.3, depth=65, location=(ax, ay, 122))
        ant = bpy.context.active_object
        ant.name = f"Spire_Satellite_{i}"
        assign_material(ant, mats['dark'])
        apply_hard_surface_smooth(ant, 40.0)
        hub_objects.append(ant)

        bpy.ops.mesh.primitive_uv_sphere_add(radius=2.0, location=(ax, ay, 155))
        sb = bpy.context.active_object
        sb.name = f"Beacon_Sat_{i}"
        assign_material(sb, mats['lights'])
        apply_hard_surface_smooth(sb, 40.0)
        hub_objects.append(sb)

    # 8 Vertical Structural Ribs on Central Hub
    for i in range(8):
        ang = i * (2.0 * math.pi / 8.0)
        rx = 145 * math.cos(ang)
        ry = 145 * math.sin(ang)
        bpy.ops.mesh.primitive_cube_add(size=1.0, location=(rx, ry, 0))
        rib = bpy.context.active_object
        rib.scale = (8, 6, 50)
        rib.rotation_euler = (0, 0, ang)
        rib.name = f"Hub_Pillar_{i}"
        assign_material(rib, mats['dark'])
        hub_objects.append(rib)

    return hub_objects



def build_ring(mats, outer_radius=480.0, ring_w=76.0, ring_h=48.0):
    mesh = bpy.data.meshes.new("Outer_Ring_Mesh")
    ring_obj = bpy.data.objects.new("Outer_Ring", mesh)
    bpy.context.collection.objects.link(ring_obj)

    bm = bmesh.new()
    num_segments = 72
    w2 = ring_w / 2.0
    h2 = ring_h / 2.0
    chamf = 16.0

    profile = [
        Vector(( w2 - chamf,  h2)),
        Vector((-w2 + chamf,  h2)),
        Vector((-w2,          h2 - chamf)),
        Vector((-w2,         -h2 + chamf)),
        Vector((-w2 + chamf, -h2)),
        Vector(( w2 - chamf, -h2)),
        Vector(( w2,         -h2 + chamf)),
        Vector(( w2,          h2 - chamf)),
    ]

    ring_rings = []
    for s in range(num_segments):
        theta = s * (2.0 * math.pi / num_segments)
        cos_t = math.cos(theta)
        sin_t = math.sin(theta)

        verts = []
        for dr, dz in profile:
            r = outer_radius + dr
            x = r * cos_t
            y = r * sin_t
            z = dz
            verts.append(bm.verts.new(Vector((x, y, z))))
        ring_rings.append(verts)

    mat_map = {'white': 0, 'dark': 1, 'orange': 2, 'lights': 3, 'grey': 4}
    for s in range(num_segments):
        s_next = (s + 1) % num_segments
        r1 = ring_rings[s]
        r2 = ring_rings[s_next]
        # Spokes are at s = 0, 18, 36, 54
        spoke_dist = min([abs(s - sp) for sp in [0, 18, 36, 54, 72]])
        for p in range(len(profile)):
            p_next = (p + 1) % len(profile)
            f = bm.faces.new([r1[p], r1[p_next], r2[p_next], r2[p]])
            if spoke_dist in [7, 8]:
                f.material_index = mat_map['orange'] # Bold hazard blocks
            elif p in [2, 6] and (s % 2 == 0):
                f.material_index = mat_map['lights'] # Panoramic lateral window bands
            elif p in [1, 3, 5, 7]:
                f.material_index = mat_map['dark']   # Beveled structural armor
            elif s % 4 == 0:
                f.material_index = mat_map['grey']
            else:
                f.material_index = mat_map['white']

    bm.to_mesh(mesh)
    bm.free()

    mat_list = [mats['white'], mats['dark'], mats['orange'], mats['lights'], mats['grey']]
    for m in mat_list:
        ring_obj.data.materials.append(m)

    apply_hard_surface_smooth(ring_obj, 30.0)

    # Add 4 reinforced T-junction boxes at spoke crossings
    for sp_idx in [0, 18, 36, 54]:
        ang = sp_idx * (2.0 * math.pi / 72.0)
        jx = outer_radius * math.cos(ang)
        jy = outer_radius * math.sin(ang)
        bpy.ops.mesh.primitive_cube_add(size=1.0, location=(jx, jy, 0))
        junc = bpy.context.active_object
        junc.name = f"Ring_Junction_{sp_idx}"
        junc.scale = (ring_w * 1.15, ring_w * 1.15, ring_h * 1.15)
        junc.rotation_euler = (0, 0, ang)
        assign_material(junc, mats['dark'])
        apply_hard_surface_smooth(junc, 35.0)

    return ring_obj

def build_spokes(mats, hub_radius=120.0, ring_radius=480.0, spoke_w=46.0, spoke_h=36.0):
    spoke_objects = []
    directions = [
        ("Spoke_PosX", Vector((1, 0, 0))),
        ("Spoke_PosY", Vector((0, 1, 0))),
        ("Spoke_NegX", Vector((-1, 0, 0))),
        ("Spoke_NegY", Vector((0, -1, 0))),
    ]

    for name, dir_vec in directions:
        p1 = dir_vec * hub_radius
        p2 = dir_vec * (ring_radius + 35.0)
        spoke = create_octagonal_tube(name, p1, p2, spoke_w, spoke_h, 10.0, mats)
        spoke_objects.append(spoke)

        # Hub reinforced collar
        col_mesh = bpy.data.meshes.new(f"{name}_HubCollar_Mesh")
        col_obj = bpy.data.objects.new(f"{name}_HubCollar", col_mesh)
        bpy.context.collection.objects.link(col_obj)
        bm = bmesh.new()
        bmesh.ops.create_cube(bm, size=1.0)
        bm.to_mesh(col_mesh)
        bm.free()
        col_obj.scale = (20.0, spoke_w * 1.35, spoke_h * 1.35) if dir_vec.x != 0 else (spoke_w * 1.35, 20.0, spoke_h * 1.35)
        col_obj.location = dir_vec * (hub_radius + 10.0)
        assign_material(col_obj, mats['dark'])
        apply_hard_surface_smooth(col_obj, 35.0)
        spoke_objects.append(col_obj)

    return spoke_objects

def build_docking_ports(mats, ring_radius=480.0):
    dock_objects = []
    
    angles = [0, math.pi / 2.0, math.pi, 3.0 * math.pi / 2.0]
    names = ["DockingPort_East", "DockingPort_North", "DockingPort_West", "DockingPort_South"]

    dock_len = 125.0
    start_r = ring_radius + 10.0 # Starts from ring and extends to 605m (Ø 1210m)
    w_out = 72.0
    h_out = 56.0
    w_in = 48.0
    h_in = 38.0
    chamf = 16.0

    for ang, name in zip(angles, names):
        cos_a = math.cos(ang)
        sin_a = math.sin(ang)

        mesh = bpy.data.meshes.new(f"{name}_Mesh")
        obj = bpy.data.objects.new(name, mesh)
        bpy.context.collection.objects.link(obj)

        bm = bmesh.new()

        w2 = w_out / 2.0
        h2 = h_out / 2.0
        c = chamf

        profile_outer = [
            Vector(( w2 - c,  h2)),
            Vector((-w2 + c,  h2)),
            Vector((-w2,      h2 - c)),
            Vector((-w2,     -h2 + c)),
            Vector((-w2 + c, -h2)),
            Vector(( w2 - c, -h2)),
            Vector(( w2,     -h2 + c)),
            Vector(( w2,      h2 - c)),
        ]

        w2_in = w_in / 2.0
        h2_in = h_in / 2.0
        c_in = 10.0
        profile_inner = [
            Vector(( w2_in - c_in,  h2_in)),
            Vector((-w2_in + c_in,  h2_in)),
            Vector((-w2_in,          h2_in - c_in)),
            Vector((-w2_in,         -h2_in + c_in)),
            Vector((-w2_in + c_in,  -h2_in)),
            Vector(( w2_in - c_in,  -h2_in)),
            Vector(( w2_in,         -h2_in + c_in)),
            Vector(( w2_in,          h2_in - c_in)),
        ]

        r0 = [bm.verts.new(Vector((p.x, p.y, 0))) for p in profile_outer]
        r1 = [bm.verts.new(Vector((p.x, p.y, dock_len * 0.45))) for p in profile_outer]
        r2 = [bm.verts.new(Vector((p.x, p.y, dock_len * 0.85))) for p in profile_outer]
        r3 = [bm.verts.new(Vector((p.x * 1.08, p.y * 1.08, dock_len))) for p in profile_outer]

        r4 = [bm.verts.new(Vector((p.x, p.y, dock_len))) for p in profile_inner]
        r5 = [bm.verts.new(Vector((p.x * 0.95, p.y * 0.95, dock_len * 0.6))) for p in profile_inner]
        r6 = [bm.verts.new(Vector((p.x * 0.9, p.y * 0.9, dock_len * 0.5))) for p in profile_inner]

        def connect_rings(ring_a, ring_b, invert=False):
            fc = []
            for i in range(8):
                i_next = (i + 1) % 8
                if not invert:
                    f = bm.faces.new([ring_a[i], ring_a[i_next], ring_b[i_next], ring_b[i]])
                else:
                    f = bm.faces.new([ring_a[i], ring_b[i], ring_b[i_next], ring_a[i_next]])
                fc.append(f)
            return fc

        faces_sec1 = connect_rings(r0, r1)
        for f in faces_sec1:
            f.material_index = 0

        faces_sec2 = connect_rings(r1, r2)
        for f in faces_sec2:
            f.material_index = 2 # Orange hazard ring

        faces_sec3 = connect_rings(r2, r3)
        for f in faces_sec3:
            f.material_index = 0

        faces_mouth = []
        for i in range(8):
            i_next = (i + 1) % 8
            f = bm.faces.new([r3[i], r3[i_next], r4[i_next], r4[i]])
            f.material_index = 1 # Dark industrial entrance collar
            faces_mouth.append(f)

        faces_inner_tunnel = connect_rings(r4, r5, invert=True)
        for f in faces_inner_tunnel:
            f.material_index = 1 # Dark inner tunnel hull

        faces_airlock_bevel = connect_rings(r5, r6, invert=True)
        for f in faces_airlock_bevel:
            f.material_index = 1

        f_al = bm.faces.new(list(reversed(r6)))
        f_al.material_index = 3 # Central airlock target indicator

        f_b = bm.faces.new(r0)
        f_b.material_index = 1

        # Add 8 discrete amber guide light strips along tunnel interior
        for i in range(8):
            p_a = profile_inner[i]
            p_b = profile_inner[(i + 1) % 8]
            mid_p = (p_a + p_b) * 0.485
            # Create a strip quad slightly inset from wall
            v1 = bm.verts.new(Vector((mid_p.x * 0.98 - 1.2, mid_p.y * 0.98, dock_len * 0.95)))
            v2 = bm.verts.new(Vector((mid_p.x * 0.98 + 1.2, mid_p.y * 0.98, dock_len * 0.95)))
            v3 = bm.verts.new(Vector((mid_p.x * 0.95 + 1.2, mid_p.y * 0.95, dock_len * 0.65)))
            v4 = bm.verts.new(Vector((mid_p.x * 0.95 - 1.2, mid_p.y * 0.95, dock_len * 0.65)))
            f_strip = bm.faces.new([v1, v2, v3, v4])
            f_strip.material_index = 3 # Amber docking guidance light

        bm.to_mesh(mesh)
        bm.free()

        for m in [mats['white'], mats['dark'], mats['orange'], mats['lights'], mats['grey']]:
            obj.data.materials.append(m)

        obj.location = Vector((start_r * cos_a, start_r * sin_a, 0))
        rot_mat = Matrix.Rotation(ang, 4, 'Z') @ Matrix.Rotation(math.pi / 2.0, 4, 'Y')
        obj.matrix_world = Matrix.Translation(obj.location) @ rot_mat

        apply_hard_surface_smooth(obj, 35.0)
        dock_objects.append(obj)

    return dock_objects



def setup_lighting_and_camera():
    world = bpy.data.worlds.new("Space_World")
    world.use_nodes = True
    bg_node = world.node_tree.nodes.get("Background")
    if bg_node:
        bg_node.inputs['Color'].default_value = (0.005, 0.008, 0.015, 1.0)
        bg_node.inputs['Strength'].default_value = 0.35
    bpy.context.scene.world = world

    sun_data = bpy.data.lights.new(name="Sun_Key", type='SUN')
    sun_data.energy = 5.5
    sun_data.color = (1.0, 0.98, 0.95)
    sun_obj = bpy.data.objects.new(name="Sun_Key", object_data=sun_data)
    bpy.context.collection.objects.link(sun_obj)
    sun_obj.rotation_euler = (math.radians(45), math.radians(28), math.radians(-55))

    fill_data = bpy.data.lights.new(name="Nebula_Fill", type='SUN')
    fill_data.energy = 1.0
    fill_data.color = (0.25, 0.4, 0.7)
    fill_obj = bpy.data.objects.new(name="Nebula_Fill", object_data=fill_data)
    bpy.context.collection.objects.link(fill_obj)
    fill_obj.rotation_euler = (math.radians(-55), math.radians(-30), math.radians(125))

    cam_data = bpy.data.cameras.new(name="Hero_Camera")
    cam_data.lens = 42
    cam_data.clip_start = 1.0
    cam_data.clip_end = 20000.0

    cam_obj = bpy.data.objects.new(name="Hero_Camera", object_data=cam_data)
    bpy.context.collection.objects.link(cam_obj)
    
    # Hero viewpoint matching reference 3/4 perspective
    cam_dist = 1420.0
    cam_elev = 580.0
    cam_angle = math.radians(-42.0)
    cam_obj.location = (
        cam_dist * math.cos(cam_angle),
        cam_dist * math.sin(cam_angle),
        cam_elev
    )
    cam_obj.rotation_euler = (math.radians(68.0), 0, math.radians(48.0))
    bpy.context.scene.camera = cam_obj

    # Top View Ortho Camera (matching reference "Вид сверху")
    top_cam_data = bpy.data.cameras.new(name="Top_Camera")
    top_cam_data.type = 'ORTHO'
    top_cam_data.ortho_scale = 1350.0
    top_cam_data.clip_start = 1.0
    top_cam_data.clip_end = 5000.0
    top_cam_obj = bpy.data.objects.new(name="Top_Camera", object_data=top_cam_data)
    bpy.context.collection.objects.link(top_cam_obj)
    top_cam_obj.location = (0, 0, 1200.0)
    top_cam_obj.rotation_euler = (0, 0, 0)

    # Side View Ortho Camera (matching reference "Вид сбоку")
    side_cam_data = bpy.data.cameras.new(name="Side_Camera")
    side_cam_data.type = 'ORTHO'
    side_cam_data.ortho_scale = 1350.0
    side_cam_data.clip_start = 1.0
    side_cam_data.clip_end = 5000.0
    side_cam_obj = bpy.data.objects.new(name="Side_Camera", object_data=side_cam_data)
    bpy.context.collection.objects.link(side_cam_obj)
    side_cam_obj.location = (0, -1200.0, 0)
    side_cam_obj.rotation_euler = (math.radians(90.0), 0, 0)

    scene = bpy.context.scene
    scene.render.engine = 'CYCLES'
    scene.cycles.samples = 8
    scene.cycles.use_denoising = True
    scene.render.resolution_x = 1280
    scene.render.resolution_y = 720
    scene.render.resolution_percentage = 100

def main():
    print("=== STARTING ORBITAL BASE GENERATION ===")
    clear_scene()

    print("Creating materials...")
    mats = create_materials()

    print("Building central hub...")
    hub_objs = build_central_hub(mats)

    print("Building outer toroidal ring...")
    ring_obj = build_ring(mats, outer_radius=480.0, ring_w=76.0, ring_h=48.0)

    print("Building spokes / transit corridors...")
    spoke_objs = build_spokes(mats, hub_radius=120.0, ring_radius=480.0, spoke_w=46.0, spoke_h=36.0)

    print("Building docking ports...")
    dock_objs = build_docking_ports(mats, ring_radius=480.0)

    print("Setting up cameras and lighting...")
    setup_lighting_and_camera()

    master_empty = bpy.data.objects.new("Orbital_Station_Root", None)
    bpy.context.collection.objects.link(master_empty)
    for obj in bpy.context.scene.objects:
        if obj.type == 'MESH' and obj.parent is None:
            obj.parent = master_empty

    output_dir = r"D:\GalaxyDemo\assets\orbital_station"
    os.makedirs(output_dir, exist_ok=True)

    blend_path = os.path.join(output_dir, "orbital_station.blend")
    obj_path = os.path.join(output_dir, "orbital_station.obj")
    glb_path = os.path.join(output_dir, "orbital_station.glb")
    render_hero_path = os.path.join(output_dir, "orbital_station_render.png")
    render_top_path = os.path.join(output_dir, "orbital_station_top_render.png")
    render_side_path = os.path.join(output_dir, "orbital_station_side_render.png")

    print(f"Saving Blender file to: {blend_path}")
    bpy.ops.wm.save_as_mainfile(filepath=blend_path)

    print(f"Exporting GLB to: {glb_path}")
    try:
        bpy.ops.export_scene.gltf(
            filepath=glb_path,
            export_format='GLB',
            use_selection=False,
            export_apply=True
        )
    except Exception as e:
        print(f"GLTF export notice: {e}")

    print(f"Exporting OBJ to: {obj_path}")
    try:
        if hasattr(bpy.ops.wm, 'obj_export'):
            bpy.ops.wm.obj_export(filepath=obj_path)
        elif hasattr(bpy.ops.export_scene, 'obj'):
            bpy.ops.export_scene.obj(filepath=obj_path)
    except Exception as e:
        print(f"OBJ export notice: {e}")

    print(f"Rendering hero view to: {render_hero_path}")
    hero_cam = bpy.data.objects.get("Hero_Camera")
    if hero_cam:
        bpy.context.scene.camera = hero_cam
        bpy.context.scene.render.filepath = render_hero_path
        try:
            bpy.ops.render.render(write_still=True)
        except Exception as e:
            print(f"Hero render notice: {e}")

    print(f"Rendering top view to: {render_top_path}")
    top_cam = bpy.data.objects.get("Top_Camera")
    if top_cam:
        bpy.context.scene.camera = top_cam
        bpy.context.scene.render.filepath = render_top_path
        try:
            bpy.ops.render.render(write_still=True)
        except Exception as e:
            print(f"Top render notice: {e}")

    print(f"Rendering side view to: {render_side_path}")
    side_cam = bpy.data.objects.get("Side_Camera")
    if side_cam:
        bpy.context.scene.camera = side_cam
        bpy.context.scene.render.filepath = render_side_path
        try:
            bpy.ops.render.render(write_still=True)
        except Exception as e:
            print(f"Side render notice: {e}")

    print("=== ORBITAL BASE GENERATION COMPLETE ===")

if __name__ == "__main__":
    main()

