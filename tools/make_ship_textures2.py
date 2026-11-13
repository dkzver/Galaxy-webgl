from pathlib import Path
import random
from PIL import Image, ImageDraw, ImageFilter

OUT = Path('assets/ship_model/textures')


def clean_panels(name, base, variants, line, size=2048, seed=3, cols=6, rows=9):
    random.seed(seed)
    img = Image.new('RGB', (size, size), base)
    d = ImageDraw.Draw(img)
    xs = [int(size * i / cols) for i in range(cols + 1)]
    ys = [int(size * i / rows) for i in range(rows + 1)]
    for i in range(cols):
        for j in range(rows):
            x0, x1, y0, y1 = xs[i], xs[i + 1], ys[j], ys[j + 1]
            d.rectangle([x0 + 2, y0 + 2, x1 - 2, y1 - 2], fill=random.choice(variants))
            # subtle inner bevel
            d.line([x0 + 6, y0 + 6, x1 - 6, y0 + 6], fill=variants[0], width=2)
            d.line([x0 + 6, y0 + 6, x0 + 6, y1 - 6], fill=variants[-1], width=2)
            # occasional sub panel
            if random.random() < 0.4:
                mx = random.randint(x0 + 40, x1 - 120)
                my = random.randint(y0 + 30, y1 - 90)
                d.rectangle([mx, my, mx + random.randint(60, 180), my + random.randint(28, 70)], fill=random.choice(variants), outline=line, width=2)
            # rivets
            for rx in range(x0 + 14, x1 - 10, 26):
                d.ellipse([rx, y0 + 7, rx + 3, y0 + 10], fill=line)
    img = img.filter(ImageFilter.GaussianBlur(0.3))
    img.save(OUT / f'{name}.png')
    print(OUT / f'{name}.png')


clean_panels('panels_gold', (188, 132, 52),
             [(188, 132, 52), (176, 122, 46), (198, 142, 60), (182, 127, 50)],
             (120, 78, 28))

clean_panels('panels_black', (22, 27, 34),
             [(22, 27, 34), (19, 24, 30), (25, 31, 39), (20, 25, 32)],
             (10, 13, 17), cols=7, rows=10)

clean_panels('panels_dark', (28, 34, 42),
             [(28, 34, 42), (25, 30, 37), (32, 39, 48)],
             (13, 16, 20), cols=6, rows=8)
