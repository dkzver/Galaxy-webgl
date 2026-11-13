import re
from pathlib import Path

p = Path('tools/build_ship_fbx.py')
s = p.read_text(encoding='utf-8')

new_nacelle = '''NAC_CX = 3.15


def nacelle(side):
    cx = NAC_CX * side
    S = 32
    add_cylinder_y(f'Nacelle_{side}', cx, -0.02,
                   [(0.72, 0.58), (0.95, 0.80), (1.18, 0.90), (1.5, 0.945), (2.1, 0.965),
                    (3.0, 0.975), (4.2, 0.985), (5.4, 0.975), (6.2, 0.945), (6.8, 0.88),
                    (7.15, 0.76), (7.32, 0.62)],
                   S, MAT_HULL)
    add_cylinder_y(f'Nacelle_Gold_{side}', cx, -0.02,
                   [(2.55, 0.978), (3.55, 0.978)], S, MAT_GOLD)
    add_ring_y(f'Intake_Rim_{side}', cx, -0.02, 0.70, 0.86, 0.66, 0.50, S, MAT_INTAKE)
    add_ring_y(f'Intake_Lip_{side}', cx, -0.02, 0.68, 0.88, 0.72, 0.60, S, MAT_GOLD_LIGHT)
    add_cylinder_y(f'Intake_Back_{side}', cx, -0.02,
                   [(0.90, 0.54), (0.95, 0.52)], S, MAT_INTAKE)
    add_ring_y(f'Nozzle_{side}', cx, -0.02, 7.10, 7.30, 0.70, 0.50, S, MAT_METAL)
    add_ring_y(f'Nozzle_Glow_{side}', cx, -0.02, 7.27, 7.31, 0.50, 0.34, S, MAT_GLOW)
    add_cylinder_y(f'Nozzle_Core_{side}', cx, -0.02,
                   [(7.30, 0.34), (7.40, 0.25)], S, MAT_METAL)
    # petal segments on the nozzle
    for k in range(16):
        a = 2 * math.pi * k / 16
        x0 = cx + math.cos(a) * 0.52
        z0 = -0.02 + math.sin(a) * 0.52
        x1 = cx + math.cos(a) * 0.67
        z1 = -0.02 + math.sin(a) * 0.67
        dx, dz = x1 - x0, z1 - z0
        ln = math.hypot(dx, dz) or 1
        nx, nz = -dz / ln * 0.035, dx / ln * 0.035
        verts = [
            (x0 - nx, 7.11, z0 - nz), (x0 + nx, 7.11, z0 + nz),
            (x1 + nx, 7.26, z1 + nz), (x1 - nx, 7.26, z1 - nz)
        ]
        add_mesh(f'Nozzle_Petal_{side}_{k}', verts, [(0, 1, 2, 3)], [MAT_METAL])
    # pylon fairing linking pod to the wing
    add_box(f'Pod_Pylon_{side}', (cx, 3.2, -0.72), (0.30, 1.7, 0.22), MAT_HULL2)


nacelle(-1)
nacelle(1)
'''

start = s.index('def nacelle(side):')
end = s.index('nacelle(-1)')
# find the two trailing lines "nacelle(-1)\nnacelle(1)\n"
tail_marker = 'nacelle(-1)\nnacelle(1)\n'
end2 = s.index(tail_marker) + len(tail_marker)
s = s[:start] + new_nacelle + s[end2:]

# thinner rear booms + second pair
old_boom_call = None
p.write_text(s, encoding='utf-8')
print('nacelle replaced')
