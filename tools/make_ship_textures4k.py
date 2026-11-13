from pathlib import Path
import random
from PIL import Image, ImageDraw, ImageFilter

OUT = Path('assets/ship_model/textures')
SIZE = 4096


def panels(name, base, variants, line, cols=8, rows=12, seed=5):
    random.seed(seed)
    img = Image.new('RGB', (SIZE, SIZE), base)
    d = ImageDraw.Draw(img)
    xs = [int(SIZE * i / cols) for i in range(cols + 1)]
    ys = [int(SIZE * i / rows) for i in range(rows + 1)]
    for i in range(cols):
        for j in range(rows):
            x0, x1, y0, y1 = xs[i], xs[i + 1], ys[j], ys[j + 1]
            d.rectangle([x0 + 3, y0 + 3, x1 - 3, y1 - 3], fill=random.choice(variants))
            d.line([x0 + 10, y0 + 10, x1 - 10, y0 + 10], fill=variants[0], width=3)
            d.line([x0 + 10, y0 + 10, x0 + 10, y1 - 10], fill=variants[-1], width=3)
            if random.random() < 0.45:
                mx = random.randint(x0 + 70, max(x0 + 80, x1 - 240))
                my = random.randint(y0 + 60, max(y0 + 70, y1 - 160))
                d.rectangle([mx, my, mx + random.randint(110, 320), my + random.randint(50, 130)],
                            fill=random.choice(variants), outline=line, width=3)
            for rx in range(x0 + 24, x1 - 16, 44):
                d.ellipse([rx, y0 + 12, rx + 5, y0 + 17], fill=line)
    img.save(OUT / f'{name}.png')

    # roughness map: panels vary slightly, lines rougher
    rough = Image.new('L', (SIZE, SIZE), 150)
    rd = ImageDraw.Draw(rough)
    random.seed(seed + 1)
    for i in range(cols):
        for j in range(rows):
            v = random.randint(120, 185)
            rd.rectangle([xs[i] + 3, ys[j] + 3, xs[i + 1] - 3, ys[j + 1] - 3], fill=v)
    rough.filter(ImageFilter.GaussianBlur(1.2)).save(OUT / f'{name}_r.png')
    print(name, SIZE)


panels('panels_black', (20, 25, 32),
       [(20, 25, 32), (17, 22, 28), (23, 29, 37), (18, 23, 30)],
       (9, 12, 16))

panels('panels_dark', (28, 34, 42),
       [(28, 34, 42), (25, 30, 37), (32, 39, 48)],
       (12, 15, 19), cols=7, rows=10, seed=8)

panels('panels_gold', (186, 130, 50),
       [(186, 130, 50), (174, 120, 44), (198, 140, 58), (180, 125, 48)],
       (116, 74, 26), cols=7, rows=11, seed=12)
