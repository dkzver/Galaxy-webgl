from pathlib import Path
from PIL import Image, ImageDraw, ImageFont, ImageOps
import numpy as np

ROOT = Path(__file__).resolve().parents[1]
R = ROOT / 'assets' / 'ship_model' / 'renders'

W, H = 3200, 2350
HEADER = 150
canvas = Image.new('RGB', (W, H), '#0b1118')
draw = ImageDraw.Draw(canvas)

FB = 'C:/Windows/Fonts/segoeuib.ttf'
FR = 'C:/Windows/Fonts/segoeui.ttf'
FM = 'C:/Windows/Fonts/consola.ttf'


def f(path, size):
    return ImageFont.truetype(path, size)


f_title = f(FB, 62)
f_sub = f(FR, 26)
f_label = f(FB, 22)
f_note = f(FR, 19)
f_mono = f(FM, 16)

draw.text((34, 24), 'КОСМИЧЕСКИЙ КОРАБЛЬ', font=f_title, fill='#e9eef5')
draw.text((36, 98), 'Высокодетализированная low-poly модель · FBX + PBR-текстуры', font=f_sub, fill='#93a4b5')
draw.text((W - 420, 34), 'HIGH-DETAIL MODEL', font=f_mono, fill='#4fd1e0')
draw.text((W - 420, 58), 'FBX · 8.7K TRIS · 2K TEXTURES', font=f_mono, fill='#c9963f')
draw.line([0, HEADER, W, HEADER], fill='#c9963f', width=2)


def trim(image, margin=40):
    a = np.asarray(image.convert('RGB')).astype(np.int16)
    b = a.max(axis=2)
    ys, xs = np.where(b > 24)
    if len(xs) == 0:
        return image
    x0, y0, x1, y1 = xs.min(), ys.min(), xs.max(), ys.max()
    return image.crop((max(0, x0 - margin), max(0, y0 - margin), min(image.width, x1 + margin), min(image.height, y1 + margin)))


def fit(image, size):
    return ImageOps.contain(image, size, Image.LANCZOS)


# hero
hero = Image.open(R / 'hero_3q.png').convert('RGB')
hero = trim(hero, 20)
hero = fit(hero, (1460, 1080))
canvas.paste(hero, (30, HEADER + 30))
draw.rectangle([20, HEADER + 20, 1510, HEADER + 1140], outline='#2b3a48', width=2)
draw.text((36, HEADER + 26), '3/4 · МАТЕРИАЛЫ И ДЕТАЛИ', font=f_label, fill='#e9eef5')

# orthographic views 3x2
views = [
    ('СВЕРХУ', 'ortho_top.png'),
    ('СНИЗУ', 'ortho_bottom.png'),
    ('СПЕРЕДИ', 'ortho_front.png'),
    ('СЛЕВА', 'ortho_left.png'),
    ('СПРАВА', 'ortho_right.png'),
    ('СЗАДИ', 'ortho_back.png'),
]
gx0, gy0 = 1540, HEADER + 20
cw, ch = 540, 560
for i, (label, name) in enumerate(views):
    col, row = i % 3, i // 3
    x = gx0 + col * (cw + 10)
    y = gy0 + row * (ch + 10)
    draw.rectangle([x, y, x + cw, y + ch], fill='#0d1720', outline='#22303c', width=2)
    draw.text((x + 12, y + 10), label, font=f_label, fill='#e9eef5')
    img = Image.open(R / name).convert('RGB')
    img = trim(img, 50)
    img = fit(img, (cw - 24, ch - 60))
    canvas.paste(img, (x + (cw - img.width) // 2, y + 46 + (ch - 56 - img.height) // 2))

# details
details = [
    ('ФОНАРЬ', 'detail_cockpit.png'),
    ('ВОЗДУХОЗАБОРНИК', 'detail_intake.png'),
    ('СОПЛО', 'detail_nozzle.png'),
    ('ЛУЧ / ЗАКОНЦОВКА', 'detail_boom.png'),
    ('ШАССИ / ДНИЩЕ', 'detail_gear.png'),
]
dx0, dy0 = 30, HEADER + 1170
dw, dh = 620, 500
for i, (label, name) in enumerate(details):
    x = dx0 + i * (dw + 10)
    draw.rectangle([x, dy0, x + dw, dy0 + dh], fill='#0d1720', outline='#22303c', width=2)
    img = Image.open(R / name).convert('RGB')
    img = trim(img, 20)
    img = fit(img, (dw - 20, dh - 70))
    canvas.paste(img, (x + (dw - img.width) // 2, dy0 + 10))
    draw.text((x + 12, dy0 + dh - 52), label, font=f_label, fill='#e9eef5')

draw.text((30, H - 52), 'Модель: FBX, 8704 треугольника, 9 материалов, 2K panel/normal текстуры.', font=f_note, fill='#6f8294')
draw.text((W - 760, H - 52), 'Ship + LandingGear · текстуры в .fbm и textures/', font=f_note, fill='#4fd1e0')

OUT = ROOT / 'assets' / 'ship_model' / 'preview.png'
canvas.save(OUT, 'PNG')
print(OUT, canvas.size)
