"""Текстуры второго корабля из space-ship.zip.

    python tools/prepare-spaceship-textures.py

colour.jpg -> base.png, плюс нейтральные rough/metal (в архиве их нет).
"""

import io
import zipfile
from pathlib import Path

from PIL import Image

ZIP = Path('space-ship.zip')
DST = Path('public/textures/spaceship')
SIZE = 1024

DST.mkdir(parents=True, exist_ok=True)

with zipfile.ZipFile(ZIP) as archive:
    data = archive.read('textures/colour.jpg')
    base = Image.open(io.BytesIO(data)).convert('RGB')
    print('colour.jpg:', base.size)
    base = base.resize((SIZE, SIZE), Image.LANCZOS)
    base.save(DST / 'base.png', optimize=True)

# В архиве только цвет и нормали — шероховатость и металл задаём ровными
Image.new('L', (64, 64), 140).save(DST / 'rough.png', optimize=True)
Image.new('L', (64, 64), 150).save(DST / 'metal.png', optimize=True)

total = sum(p.stat().st_size for p in DST.iterdir()) / 1024 / 1024
print(f'spaceship: {total:.2f} МБ')
