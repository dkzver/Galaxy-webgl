# Blender 5.2: Максимально детализированная модель корабля

## Исходные данные проекта
В папке `D:\GalaxyDemo\assets\` находятся файлы референса:
- `ship_ref_top_raw.jpg` - вид сверху
- `ship_ref_bottom2_raw.jpg` - вид снизу
- `ship_ref_side_raw.jpg` - вид сбordo
- `ship_ref_front3_raw.jpg` - вид спереди
- `ship_ref_back2_raw.jpg` - вид сзади

Также генерируется `ship_ref_ortho_sheet.png` (сшитый орто-лист).

## Шаг 1: Подготовка reference изображений

### Вариант А: Сшитый орто-лист
Выполните Python-скрипт для создания единого изображения:
```python
from PIL import Image
import pathlib

ROOT = pathlib.Path('D:/GalaxyDemo')
A = ROOT / 'assets'

# Открытие всех изображений
top = Image.open(A / 'ship_ref_top_raw.jpg').convert('RGB')
bottom = Image.open(A / 'ship_ref_bottom2_raw.jpg').convert('RGB')
side = Image.open(A / 'ship_ref_side_raw.jpg').convert('RGB')
front = Image.open(A / 'ship_ref_front3_raw.jpg').convert('RGB')
back = Image.open(A / 'ship_ref_back2_raw.jpg').convert('RGB')

# Канвас: 5 ракурсов в вертикальном ряду
W, H = side.size
canvas = Image.new('RGB', (W, H * 5))

# Раскладка
canvas.paste(top, (0, 0))
canvas.paste(bottom, (0, H))
canvas.paste(side, (0, H * 2))
canvas.paste(front, (0, H * 3))
canvas.paste(back, (0, H * 4))

OUT = A / 'ship_ref_ortho_sheet.png'
canvas.save(OUT, 'PNG')
print(f"Сохранено: {OUT}")
```

### Шаг 2: Настройка Blender 5.2
- Preferences: Enable GPU acceleration, increase Undo Steps to 200+
- Interface: Set default font size, workspace preferences

## Шаг 3: Импорт и размещение reference

1. Blender 5.2 запуск
2. `Shift+A → Image → Reference → Reference Image`
3. Загрузите `ship_ref_ortho_sheet.png`
4. Панель N (Sidebar):
   - Orthographic: ON
   - Alpha: 0.5
   - Size: подогнать под корабль

## Шаг 4: 5 орто-камер

```python
import bpy

def setup_cam(name, loc, rot, scale):
    bpy.ops.object.camera_add(location=loc, rotation=rot)
    cam = bpy.context.active_object
    cam.name = name
    cam.data.type = 'ORTHO'
    cam.data.ortho_scale = scale
    cam.location = loc
    cam.rotation_euler = rot
    return cam

cams = [
    ("Cam_Front", (0,-10,0), (0,0,0), 10),
    ("Cam_Back", (0,10,0), (0,0,1.57), 10),
    ("Cam_Side", (10,0,0), (0,1.57,0), 10),
    ("Cam_Top", (0,0,-10), (1.57,0,0), 10),
    ("Cam_Bottom", (0,0,10), (-1.57,0,0), 10),
]

for name, loc, rot, scale in cams:
    setup_cam(name, loc, rot, scale)

bpy.context.scene.camera = bpy.data.objects['Cam_Front']
```