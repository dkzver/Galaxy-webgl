from pathlib import Path
from PIL import Image, ImageDraw, ImageFont, ImageOps
import numpy as np

ROOT = Path(__file__).resolve().parents[1]
R = ROOT / 'assets' / 'ship_model' / 'renders'

W, H = 3400, 2150
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

draw.text((36, 22), 'КОСМИЧЕСКИЙ КОРАБЛЬ', font=f_title, fill='#e9eef5')
draw.text((38, 98), 'High-poly модель · FBX + PBR 4K · без low-poly', font=f_sub, fill='#93a4b5')
draw.text((W - 520, 30), 'HIGH-POLY ASSET', font=f_mono, fill='#4fd1e0')
draw.text((W - 520, 56), '563K TRIS · 4K TEXTURES · 9 MATERIALS', font=f_mono, fill='#c9963f')
draw.line([0, HEADER, W, HEADER], fill='#c9963f', width=2)


def trim(image, margin=30, thresh=22):
    a = np.asarray(image.convert('RGB')).astype(np.int16)
    b = a.max(axis=2)
    ys, xs = np.where(b > thresh)
    if len(xs) == 0:
        return image
    x0, y0, x1, y1 = xs.min(), ys.min(), xs.max(), ys.max()
    return image.crop((max(0, x0 - margin), max(0, y0 - margin),
                       min(image.width, x1 + margin), min(image.height, y1 + margin)))


def fit(image, size):
    return ImageOps.contain(image, size, Image.LANCZOS)


hero = fit(trim(Image.open(R / 'hero_3q.png').convert('RGB'), 18), (1470, 1060))
canvas.paste(hero, (40, HEADER + 50))
draw.rectangle([24, HEADER + 26, 1530, HEADER + 1130], outline='#2b3a48', width=2)
draw.text((44, HEADER + 34), '3/4 · МАТЕРИАЛЫ, ПАНЕЛИ, ДЕТАЛИ', font=f_label, fill='#e9eef5')

views = [
    ('СВЕРХУ', 'ortho_top.png'),
    ('СНИЗУ', 'ortho_bottom.png'),
    ('СПЕРЕДИ', 'ortho_front.png'),
    ('СЛЕВА', 'ortho_left.png'),
    ('СПРАВА', 'ortho_right.png'),
    ('СЗАДИ', 'ortho_back.png'),
]
gx0, gy0 = 1550, HEADER + 20
cw, ch = 612, 545
for i, (label, name) in enumerate(views):
    col, row = i % 3, i // 3
    x = gx0 + col * (cw + 10)
    y = gy0 + row * (ch + 10)
    draw.rectangle([x, y, x + cw, y + ch], fill='#0d1720', outline='#22303c', width=2)
    draw.text((x + 14, y + 10), label, font=f_label, fill='#e9eef5')
    img = fit(trim(Image.open(R / name).convert('RGB'), 30), (cw - 24, ch - 64))
    canvas.paste(img, (x + (cw - img.width) // 2, y + 46 + (ch - 56 - img.height) // 2))

details = [
    ('ФОНАРЬ / КАБИНА', 'detail_cockpit.png'),
    ('ВОЗДУХОЗАБОРНИК', 'detail_intake.png'),
    ('СОПЛО', 'detail_nozzle.png'),
    ('ЛУЧ / ЗАКОНЦОВКА', 'detail_boom.png'),
    ('ШАССИ', 'detail_gear.png'),
    ('ДНИЩЕ', 'detail_underside.png'),
]
dx0, dy0 = 24, HEADER + 1150
dw, dh = 555, 500
for i, (label, name) in enumerate(details):
    x = dx0 + i * (dw + 8)
    draw.rectangle([x, dy0, x + dw, dy0 + dh], fill='#0d1720', outline='#22303c', width=2)
    img = fit(trim(Image.open(R / name).convert('RGB'), 14), (dw - 18, dh - 66))
    canvas.paste(img, (x + (dw - img.width) // 2, dy0 + 10))
    draw.text((x + 12, dy0 + dh - 46), label, font=f_label, fill='#e9eef5')

draw.text((40, dy0 + dh + 34), 'Модель: FBX, 563 556 треугольников, сабдив-оболочки, 9 PBR-материалов, base/normal/roughness 4K.', font=f_note, fill='#6f8294')
draw.text((W - 780, dy0 + dh + 34), 'Ship + LandingGear · текстуры в .fbm и textures/', font=f_note, fill='#4fd1e0')

OUT = ROOT / 'assets' / 'ship_model' / 'preview_highpoly.png'
canvas.save(OUT, 'PNG')
print(OUT, canvas.size)
