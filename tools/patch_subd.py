from pathlib import Path

p = Path('tools/build_ship_fbx.py')
s = p.read_text(encoding='utf-8')

# subdivision pass appended to the bevel loop block
old_loop = """for name in ('Fuselage', 'Wing_-1', 'Wing_1', 'Nacelle_-1', 'Nacelle_1',
             'Boom_outer_-1', 'Boom_outer_1', 'Boom_inner_-1', 'Boom_inner_1', 'Fin_-1', 'Fin_1'):
    bevel(bpy.data.objects.get(name), 0.02, 3)"""

new_loop = """SHELLS = ['Fuselage', 'Wing_-1', 'Wing_1', 'Nacelle_-1', 'Nacelle_1',
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
    mod.levels = 1
    mod.render_levels = 1
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
    obj.select_set(False)"""

if old_loop in s:
    s = s.replace(old_loop, new_loop, 1)
    print('subd inserted')
else:
    print('MISS loop')
    print(s[s.index("for name in ('Fuselage'"):][:400])

s = s.replace("os.path.join(OUT, 'ship_lowpoly.blend')", "os.path.join(OUT, 'ship_highpoly.blend')")
s = s.replace("os.path.join(OUT, 'ship_lowpoly.fbx')", "os.path.join(OUT, 'ship_highpoly.fbx')")

p.write_text(s, encoding='utf-8')
print('renamed outputs')
