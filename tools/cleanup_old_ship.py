import os
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'assets' / 'ship_model'

# drop obsolete low-poly artefacts
for name in ('ship_lowpoly.blend', 'ship_lowpoly.blend1', 'ship_lowpoly.fbx',
             'ship_highdetail.fbx', 'ship_high.zip', 'preview.png'):
    path = OUT / name
    if path.exists():
        if path.is_dir():
            shutil.rmtree(path)
        else:
            path.unlink()
        print('removed', name)

fbm = OUT / 'ship_lowpoly.fbm'
if fbm.exists():
    shutil.rmtree(fbm)
    print('removed ship_lowpoly.fbm')

print('cleanup done')
