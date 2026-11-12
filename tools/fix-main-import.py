import io

path = 'public/js/main.js'
src = io.open(path, encoding='utf-8', newline='').read()
old = "import { PhysicsWorld, boxShape, compoundShape, sphereShape, getWorldSpheres } from './physics.js';"
new = "import { PhysicsWorld, boxShape, compoundShape, sphereShape, getWorldBoxes, getWorldSpheres } from './physics.js';"

if old not in src:
    raise SystemExit('import line not found')

src = src.replace(old, new)
io.open(path, 'w', encoding='utf-8', newline='').write(src)
print('import ok')
