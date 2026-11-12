"""Готовит текстуры для игры: читает 4K-атласы прямо из архива и уменьшает их.

    python tools/prepare-textures.py

Исходник: corinth-cargo-transporter.zip (textures/*.png)
Результат: public/textures/<set>/{base,rough,metal}.png
"""

import io
import zipfile
from pathlib import Path

from PIL import Image

ZIP = Path('corinth-cargo-transporter.zip')
DST = Path('public/textures')

SETS = {
    'hull': 'T_Hull',
    'cockpit': 'T_Cockpit',
    'container': 'T_Container',
    'thrusters': 'T_R_Thrusters',
}

BASE_SIZE = 1024
SCALAR_SIZE = 512

DST.mkdir(parents=True, exist_ok=True)

with zipfile.ZipFile(ZIP) as archive:
    for name, prefix in SETS.items():
        out = DST / name
        out.mkdir(parents=True, exist_ok=True)

        def load(suffix):
            data = archive.read(f'textures/{prefix}_{suffix}.png')
            return Image.open(io.BytesIO(data))

        base = load('Base_color').convert('RGB').resize((BASE_SIZE, BASE_SIZE), Image.LANCZOS)
        base.save(out / 'base.png', optimize=True)

        for key, suffix in (('rough', 'Roughness'), ('metal', 'Metallic')):
            try:
                im = load(suffix).convert('L').resize((SCALAR_SIZE, SCALAR_SIZE), Image.LANCZOS)
                im.save(out / f'{key}.png', optimize=True)
            except KeyError:
                pass

        size = sum(p.stat().st_size for p in out.iterdir()) / 1024 / 1024
        print(f'{name:10s} {prefix:16s} {size:.2f} МБ')
