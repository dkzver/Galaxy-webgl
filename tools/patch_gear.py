from pathlib import Path

p = Path('tools/build_ship_fbx.py')
s = p.read_text(encoding='utf-8')

old = """def gear_leg(name, x, y, length, wheel_radius=0.24):
    strut = add_cylinder(f'{name}_Strut', (x, y, -0.75 - length / 2), 0.065, length, vertices=8)
    wheel = add_cylinder(f'{name}_Wheel', (x, y, -0.75 - length), wheel_radius, 0.14, rotation=(0, math.pi / 2, 0), vertices=12)
    GEAR.extend([strut, wheel])


gear_leg('Gear_Nose', 0.0, -5.6, 1.35, 0.22)
gear_leg('Gear_L', -2.9, 2.4, 1.55)
gear_leg('Gear_R', 2.9, 2.4, 1.55)"""

new = """def gear_leg(name, x, y, z_top, z_bottom, wheel_radius=0.24, wheel_width=0.16):
    length = z_top - z_bottom
    strut = add_cylinder(f'{name}_Strut', (x, y, z_top - length / 2), 0.075, length, vertices=10)
    GEAR.append(strut)
    # telescopic inner piston
    piston = add_cylinder(f'{name}_Piston', (x, y, z_bottom + length * 0.30), 0.048, length * 0.42, vertices=8)
    GEAR.append(piston)
    # diagonal brace
    brace = add_pipe(f'{name}_Brace', [(x * 0.82, y + 0.55, z_top + 0.05), (x, y, z_top - length * 0.45)], 0.032, MAT_METAL, 8)
    GEAR.append(brace)
    # axle + wheel + hub
    axle = add_cylinder(f'{name}_Axle', (x, y, z_bottom), 0.045, wheel_width + 0.10, rotation=(0, math.pi / 2, 0), vertices=8)
    GEAR.append(axle)
    wheel = add_cylinder(f'{name}_Wheel', (x, y, z_bottom), wheel_radius, wheel_width, rotation=(0, math.pi / 2, 0), vertices=16)
    GEAR.append(wheel)
    hub = add_cylinder(f'{name}_Hub', (x, y, z_bottom), wheel_radius * 0.42, wheel_width + 0.03, rotation=(0, math.pi / 2, 0), vertices=12, mat=MAT_GOLD_LIGHT)
    GEAR.append(hub)
    # fork plates
    for sx in (-1, 1):
        GEAR.append(add_box(f'{name}_Fork_{sx}', (x + sx * wheel_width * 0.62, y, z_bottom + wheel_radius * 0.55),
                            (0.018, 0.06, wheel_radius * 0.55), MAT_METAL))


gear_leg('Gear_Nose', 0.0, -5.6, -0.62, -1.62, 0.22, 0.13)
gear_leg('Gear_L', -2.9, 2.4, -1.02, -1.86, 0.28, 0.20)
gear_leg('Gear_R', 2.9, 2.4, -1.02, -1.86, 0.28, 0.20)"""

if old in s:
    s = s.replace(old, new, 1)
    p.write_text(s, encoding='utf-8')
    print('gear replaced')
else:
    print('MISS gear')
