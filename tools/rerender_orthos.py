import bpy
import math
import os

OUT = r'D:\GalaxyDemo\assets\ship_model'
RENDERS = os.path.join(OUT, 'renders')

bpy.ops.wm.open_mainfile(filepath=os.path.join(OUT, 'ship_highpoly.blend'))

for name, loc, rot, energy in (
    ('FrontFill', (0, -30, 10), (math.radians(72), 0, 0), 4200),
    ('BackFill', (0, 30, 9), (math.radians(-72), 0, 0), 3200),
):
    if bpy.data.objects.get(name):
        continue
    ld = bpy.data.lights.new(name, type='AREA')
    ld.energy = energy
    ld.size = 24
    ob = bpy.data.objects.new(name, ld)
    bpy.context.collection.objects.link(ob)
    ob.location = loc
    ob.rotation_euler = rot

scene = bpy.context.scene
scene.render.resolution_x = 1600
scene.render.resolution_y = 1200
scene.eevee.taa_render_samples = 32

for name in ('ortho_front', 'ortho_back', 'ortho_left', 'ortho_right', 'ortho_top', 'ortho_bottom'):
    cam = bpy.data.objects.get(name)
    if cam is None:
        print('no camera', name)
        continue
    scene.camera = cam
    scene.render.filepath = os.path.join(RENDERS, f'{name}.png')
    bpy.ops.render.render(write_still=True)
    print('RENDERED', name)
