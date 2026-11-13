from pathlib import Path
import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'assets' / 'ship_model' / 'textures'

for name in ('panels_black', 'panels_dark', 'panels_gold'):
    path = OUT / f'{name}.png'
    if not path.exists():
        continue
    gray = np.asarray(Image.open(path).convert('L')).astype(np.float32) / 255.0
    dx = np.roll(gray, -1, axis=1) - np.roll(gray, 1, axis=1)
    dy = np.roll(gray, -1, axis=0) - np.roll(gray, 1, axis=0)
    strength = 2.2
    nx = -dx * strength
    ny = -dy * strength
    nz = np.ones_like(gray)
    length = np.sqrt(nx * nx + ny * ny + nz * nz)
    nx /= length
    ny /= length
    nz /= length
    rgb = np.stack([(nx * 0.5 + 0.5) * 255, (ny * 0.5 + 0.5) * 255, (nz * 0.5 + 0.5) * 255], axis=-1)
    out = OUT / f'{name}_n.png'
    Image.fromarray(rgb.clip(0, 255).astype(np.uint8)).save(out)
    print(out)
