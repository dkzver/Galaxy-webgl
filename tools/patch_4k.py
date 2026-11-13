from pathlib import Path

p = Path('tools/build_ship_fbx.py')
s = p.read_text(encoding='utf-8')

repls = [
    # roughness maps
    ("            mat.node_tree.links.new(nmap.outputs['Normal'], bsdf.inputs['Normal'])",
     "            mat.node_tree.links.new(nmap.outputs['Normal'], bsdf.inputs['Normal'])\n"
     "\n"
     "    rpath = os.path.join(OUT, 'textures', filename.replace('.png', '_r.png'))\n"
     "    if os.path.exists(rpath):\n"
     "        rtex = mat.node_tree.nodes.new('ShaderNodeTexImage')\n"
     "        rtex.image = bpy.data.images.load(rpath)\n"
     "        rtex.image.colorspace_settings.name = 'Non-Color'\n"
     "        rtex.location = (-420, -360)\n"
     "        mat.node_tree.links.new(mapping.outputs['Vector'], rtex.inputs['Vector'])\n"
     "        mat.node_tree.links.new(rtex.outputs['Color'], bsdf.inputs['Roughness'])"),
    # intake fan ahead of backing plate
    ("        xz_blade(f'Intake_Blade_{side}_{i}', cx, 0.78, 0.88,", "        xz_blade(f'Intake_Blade_{side}_{i}', cx, 0.78, 0.80,"),
    ("    add_cylinder_y(f'Intake_Hub_{side}', cx, 0.78, [(0.86, 0.14), (0.94, 0.10)], 12, MAT_GOLD_LIGHT)",
     "    add_cylinder_y(f'Intake_Hub_{side}', cx, 0.78, [(0.76, 0.15), (0.86, 0.11)], 16, MAT_GOLD_LIGHT)"),
    ("    add_cylinder_y(f'Intake_Back_{side}', cx, cz,\n                   [(0.90, 0.54), (0.95, 0.52)], S, MAT_INTAKE)",
     "    add_cylinder_y(f'Intake_Back_{side}', cx, cz,\n                   [(1.02, 0.56), (1.06, 0.54)], S, MAT_INTAKE)"),
    # softer bottom fill to avoid hot rear cap
    ("add_area('Bottom', (0, -1, -14), 2600, 22, (0.75, 0.84, 1.0))\nadd_area('BottomFront', (0, -10, -9), 1200, 16, (0.7, 0.8, 1.0))",
     "add_area('Bottom', (0, -1, -14), 1400, 22, (0.75, 0.84, 1.0))\nadd_area('BottomFront', (0, -10, -9), 900, 16, (0.7, 0.8, 1.0))"),
]

for old, new in repls:
    if old not in s:
        print('MISS:', old.splitlines()[0][:70])
        continue
    s = s.replace(old, new, 1)

p.write_text(s, encoding='utf-8')
print('ok')
