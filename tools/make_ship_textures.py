from pathlib import Path
import random
from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'assets' / 'ship_model' / 'textures'
OUT.mkdir(parents=True, exist_ok=True)


def panel_texture(name, base, panel_variants, line, rivet, size=2048, seed=7):
    random.seed(seed)
    img = Image.new('RGB', (size, size), base)
    draw = ImageDraw.Draw(img)

    # irregular panel grid
    xs = [0]
    while xs[-1] < size:
        xs.append(min(size, xs[-1] + random.randint(110, 260)))
    ys = [0]
    while ys[-1] < size:
        ys.append(min(size, ys[-1] + random.randint(90, 220)))

    for i in range(len(xs) - 1):
        for j in range(len(ys) - 1):
            x0, x1 = xs[i], xs[i + 1]
            y0, y1 = ys[j], ys[j + 1]
            inset = random.randint(1, 4)
            color = random.choice(panel_variants)
            draw.rectangle([x0 + inset, y0 + inset, x1 - inset, y1 - inset], fill=color, outline=line, width=random.randint(2, 4))
            # small sub-panel
            if random.random() < 0.55:
                mx = random.randint(x0 + 18, max(x0 + 20, x1 - 18))
                my = random.randint(y0 + 16, max(y0 + 18, y1 - 16))
                draw.rectangle([mx, my, min(x1 - 8, mx + random.randint(30, 90)), min(y1 - 8, my + random.randint(16, 44))], fill=random.choice(panel_variants), outline=line, width=1)
            # rivets along top edge
            for rx in range(x0 + 12, x1 - 8, random.randint(18, 28)):
                draw.ellipse([rx, y0 + 5, rx + 3, y0 + 8], fill=rivet)
            for ry in range(y0 + 16, y1 - 10, random.randint(22, 34)):
                draw.ellipse([x0 + 5, ry, x0 + 8, ry + 3], fill=rivet)

    # scratches
    for _ in range(140):
        x0 = random.randint(0, size - 20)
        y0 = random.randint(0, size - 20)
        length = random.randint(10, 90)
        angle = random.uniform(-0.4, 0.4)
        x1 = x0 + int(length * random.choice([1, -1]))
        y1 = y0 + int(length * angle)
        draw.line([x0, y0, x1, y1], fill=random.choice(panel_variants), width=1)
    # grime blotches
    for _ in range(70):
        r = random.randint(8, 36)
        x = random.randint(r, size - r)
        y = random.randint(r, size - r)
        shade = tuple(max(0, c - random.randint(2, 10)) for c in base)
        draw.ellipse([x - r, y - r, x + r, y + r], fill=shade)
    img = img.filter(ImageFilter.GaussianBlur(0.4))
    path = OUT / f'{name}.png'
    img.save(path)
    print(path, img.size)


panel_texture(
    'panels_black',
    (17, 21, 27),
    [(21, 26, 33), (24, 29, 37), (14, 18, 24), (28, 33, 41)],
    (8, 10, 13),
    (78, 84, 92),
)

panel_texture(
    'panels_gold',
    (176, 118, 46),
    [(196, 138, 58), (160, 104, 38), (184, 126, 50), (205, 148, 64)],
    (96, 60, 22),
    (238, 205, 140),
)

panel_texture(
    'panels_dark',
    (30, 36, 44),
    [(36, 43, 52), (26, 31, 38), (42, 50, 60)],
    (12, 15, 19),
    (96, 104, 114),
)
