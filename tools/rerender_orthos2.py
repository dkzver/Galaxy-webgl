import bpy
import math
import os

OUT = r'D:\GalaxyDemo\assets\ship_model'
RENDERS = os.path.join(OUT, 'renders')

bpy.ops.wm.open_mainfile(filepath=os.path.join(OUT, 'ship_highpoly.blend'))

fills = [
    ('FillFront', (0, -34, 12), (math.radians(70), 0, 0), 5200, 26),
    ('FillBack', (0, 34, 12), (math.radians(-70), 0, 0), 4200, 26),
    ('FillLeft', (-34, 0, 10), (math.radians(80), 0, math.radians(-90)), 4200, 26),
    ('FillRight', (34, 0, 10), (math.radians(80), 0, math.radians(90)), 4200, 26),
]
for name, loc, rot, energy, size in fills:
    if bpy.data.objects.get(name):
        continue
    ld = bpy.data.lights.new(name, type='AREA')
    ld.energy = energy
    ld.size = size
    ob = bpy.data.objects.new(name, ld)
    bpy.context.collection.objects.link(ob)
    ob.location = loc
    ob.rotation_euler = rot

world = bpy.context.scene.world
bg = next((n for n in world.node_tree.nodes if n.type == 'BACKGROUND'), None)
if bg:
    bg.inputs[1].default_value = 1.15

scene = bpy.context.scene
scene.render.resolution_x = 1600
scene.render.resolution_y = 1200
scene.eevee.taa_render_samples = 32

for name in ('ortho_top', 'ortho_bottom', 'ortho_front', 'ortho_back', 'ortho_left', 'ortho_right'):
    cam = bpy.data.objects.get(name)
    if cam is None:
        print('no camera', name)
        continue
    cam.data.type = 'ORTHO'
    cam.data.ortho_scale = 23.5
    scene.camera = cam
    scene.render.filepath = os.path.join(RENDERS, f'{name}.png')
    bpy.ops.render.render(write_still=True)
    print('RENDERED', name)
