"""Рендер корабля из .blend: вид сзади и сбоку — для сверки материалов с игрой.

    blender -b corinth_cargo_transported.blend -P tools/render-blend-preview.py
"""

import math
import sys
from pathlib import Path

import bpy
from mathutils import Vector

OUT = Path('build/blend-preview')
OUT.mkdir(parents=True, exist_ok=True)

scene = bpy.context.scene

meshes = [obj for obj in scene.objects if obj.type == 'MESH']
if not meshes:
    sys.exit('в .blend нет мешей')

# Скрываем энергетический щит: он прозрачный и закрывает корпус
hidden = []
for obj in list(meshes):
    materials = [slot.material.name for slot in obj.material_slots if slot.material]
    if any(name in ('Mat_Energy_Shield', 'Mat_Tactical_Markings') for name in materials):
        hidden.append((obj.name, materials))
        obj.hide_render = True
        meshes.remove(obj)
print('скрыто:', hidden)

points = []
for obj in meshes:
    for corner in obj.bound_box:
        points.append(obj.matrix_world @ Vector(corner))

min_v = Vector((min(p[i] for p in points) for i in range(3)))
max_v = Vector((max(p[i] for p in points) for i in range(3)))
center = (min_v + max_v) * 0.5
size = max_v - min_v
radius = max(size) * 0.5

print('bounds', tuple(round(v, 2) for v in min_v), tuple(round(v, 2) for v in max_v))

# Свет: ключевой сверху-сбоку, заполняющий снизу, чтобы читались панели
sun = bpy.data.objects.get('PreviewSun') or bpy.data.objects.new('PreviewSun', bpy.data.lights.new('PreviewSun', 'SUN'))
if sun.name not in scene.objects:
    scene.collection.objects.link(sun)
sun.data.energy = 4.0
sun.rotation_euler = (math.radians(55), 0, math.radians(35))

fill = bpy.data.objects.get('PreviewFill') or bpy.data.objects.new('PreviewFill', bpy.data.lights.new('PreviewFill', 'SUN'))
if fill.name not in scene.objects:
    scene.collection.objects.link(fill)
fill.data.energy = 1.2
fill.rotation_euler = (math.radians(115), 0, math.radians(200))

world = scene.world or bpy.data.worlds.new('PreviewWorld')
scene.world = world
world.use_nodes = True
world.node_tree.nodes['Background'].inputs[0].default_value = (0.02, 0.03, 0.05, 1)
world.node_tree.nodes['Background'].inputs[1].default_value = 1.0

cam_data = bpy.data.cameras.new('PreviewCam')
cam = bpy.data.objects.new('PreviewCam', cam_data)
scene.collection.objects.link(cam)
cam_data.lens = 60
scene.camera = cam

scene.render.engine = 'BLENDER_EEVEE_NEXT' if 'BLENDER_EEVEE_NEXT' in {
    item.identifier for item in bpy.types.RenderSettings.bl_rna.properties['engine'].enum_items
} else 'BLENDER_WORKBENCH'
scene.render.resolution_x = 900
scene.render.resolution_y = 700
scene.render.film_transparent = False

if scene.render.engine == 'BLENDER_WORKBENCH':
    shading = scene.display.shading
    shading.light = 'FLAT'
    shading.color_type = 'TEXTURE'

VIEWS = {
    'rear': Vector((0.55, 0.42, 1.0)),
    'rear-left': Vector((0.9, 0.35, 0.75)),
    'front': Vector((0.5, 0.4, -1.0)),
}

for name, direction in VIEWS.items():
    direction = direction.normalized()
    cam.location = center + direction * radius * 3.6
    track = cam.constraints.get('PreviewTrack') or cam.constraints.new('TRACK_TO')
    track.name = 'PreviewTrack'
    track.target = None
    # Смотрим в центр модели: пустышка-таргет
    empty = bpy.data.objects.get('PreviewTarget') or bpy.data.objects.new('PreviewTarget', None)
    if empty.name not in scene.objects:
        scene.collection.objects.link(empty)
    empty.location = center
    track.target = empty
    track.track_axis = 'TRACK_NEGATIVE_Z'
    track.up_axis = 'UP_Y'

    scene.render.filepath = str(OUT / f'{name}.png')
    bpy.ops.render.render(write_still=True)
    print('rendered', scene.render.filepath)
