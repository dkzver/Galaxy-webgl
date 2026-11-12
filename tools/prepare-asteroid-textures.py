"""Текстуры астероидов из asteroid-01.zip и asteroid-with-minerals.zip.

    python tools/prepare-asteroid-textures.py

public/textures/asteroid1|2/{base,rough,metal}.png
"""

import io
import zipfile
from pathlib import Path

from PIL import Image

OUT = Path('public/textures')
SIZE = 1024


def load(zip_path, entry):
    with zipfile.ZipFile(zip_path) as archive:
        return Image.open(io.BytesIO(archive.read(entry)))


def flat(value):
    return Image.new('L', (64, 64), value)


# --- астероид 1: альбедо + плоские rough/metal ---
dst = OUT / 'asteroid1'
dst.mkdir(parents=True, exist_ok=True)
base = load('asteroid-01.zip', 'textures/Asteroid_01_alb.png').convert('RGB')
print('asteroid1 albedo:', base.size)
base.resize((SIZE, SIZE), Image.LANCZOS).save(dst / 'base.png', optimize=True)
flat(205).save(dst / 'rough.png', optimize=True)
flat(35).save(dst / 'metal.png', optimize=True)

# --- астероид 2: альбедо + карта металла ---
dst = OUT / 'asteroid2'
dst.mkdir(parents=True, exist_ok=True)
base = load('asteroid-with-minerals.zip', 'textures/Albedo.jpg').convert('RGB')
print('asteroid2 albedo:', base.size)
base.resize((SIZE, SIZE), Image.LANCZOS).save(dst / 'base.png', optimize=True)

metal = load('asteroid-with-minerals.zip', 'textures/Metalness.jpg').convert('L')
metal.resize((512, 512), Image.LANCZOS).save(dst / 'metal.png', optimize=True)
flat(150).save(dst / 'rough.png', optimize=True)

for name in ('asteroid1', 'asteroid2'):
    total = sum(p.stat().st_size for p in (OUT / name).iterdir()) / 1024 / 1024
    print(f'{name}: {total:.2f} МБ')
