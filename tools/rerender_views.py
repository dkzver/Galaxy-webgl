import bpy
import math
import os

OUT = r'D:\GalaxyDemo\assets\ship_model'
RENDERS = os.path.join(OUT, 'renders')

bpy.ops.wm.open_mainfile(filepath=os.path.join(OUT, 'ship_highpoly.blend'))

# frontal fill so the front/back orthos are readable
light_data = bpy.data.lights.new('FrontFill', type='AREA')
light_data.energy = 4200
light_data.size = 24
light = bpy.data.objects.new('FrontFill', light_data)
bpy.context.collection.objects.link(light)
light.location = (0, -30, 10)
light.rotation_euler = (math.radians(72), 0, 0)

back_data = bpy.data.lights.new('BackFill', type='AREA')
back_data.energy = 3200
back_data.size = 24
back = bpy.data.objects.new('BackFill', back_data)
bpy.context.collection.objects.link(back)
back.location = (0, 30, 9)
back.rotation_euler = (math.radians(-72), 0, 0)

scene = bpy.context.scene
scene.render.resolution_x = 1600
scene.render.resolution_y = 1600
scene.eevee.taa_render_samples = 32

for name in ('ortho_front', 'ortho_back', 'ortho_left', 'ortho_right', 'hero'):
    cam = bpy.data.objects.get(name)
    if cam is None:
        print('no camera', name)
        continue
    scene.camera = cam
    scene.render.filepath = os.path.join(RENDERS, f'{name}.png')
    bpy.ops.render.render(write_still=True)
    print('RENDERED', name)
