from pathlib import Path
p = Path('tools/build_ship_fbx.py')
s = p.read_text(encoding='utf-8')
if 'import mathutils' not in s.split('\n\n')[0]:
    s = s.replace("from mathutils import Vector\n", "from mathutils import Vector\nimport mathutils\n", 1)
    p.write_text(s, encoding='utf-8')
    print('import added')
else:
    print('already')
