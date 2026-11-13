from pathlib import Path

p = Path('tools/build_ship_fbx.py')
s = p.read_text(encoding='utf-8')

# remove fixed-z wing greebles block
start = s.index("for side in (-1, 1):\n    poly = wing_plan(side)")
end = s.index("# nacelle clamps and cooling pipes")
new_block = """for side in (-1, 1):
    # trailing edge flaps
    add_box(f'WingFlap_{side}', (4.25 * side, 4.86, 0.10), (1.15, 0.24, 0.035), MAT_GOLD, rot_z=0.08 * side)
    add_box(f'WingFlap2_{side}', (2.55 * side, 5.14, 0.09), (0.60, 0.18, 0.03), MAT_HULL2, rot_z=0.08 * side)
    # navigation light
    add_box(f'NavLight_{side}', (6.62 * side, 2.32, 0.20), (0.035, 0.03, 0.012), MAT_GLOW_WARM)

"""
s = s[:start] + new_block + s[end:]

# remove fixed-z access hatches from the max-detail pass
h_start = s.index("# access hatches with hinges along the wing")
h_end = s.index("# hull fasteners along frame stations")
s = s[:h_start] + s[h_end:]

# add raycast surface vents on wings instead of hatches
anchor = "# hull fasteners along frame stations"
vents = """# flush vents and louvres on the wing skin (raycast placed)
for side in (-1, 1):
    obj = wing_objs[side]
    for row, frac in enumerate((0.30, 0.52, 0.74)):
        for i in range(9):
            t = 0.22 + i * 0.075
            x = (1.35 + t * 5.15) * side
            le_y = -2.40 + 3.70 * t
            te_y = 5.40 - 0.85 * t
            y = le_y + (te_y - le_y) * frac
            z = surface_hit(obj, x, y)
            if z is None:
                continue
            add_box(f'WingLouvre_{side}_{row}_{i}', (x, y, z + 0.004), (0.035, 0.085, 0.006), MAT_INTAKE)

"""
s = s.replace(anchor, vents + anchor, 1)

p.write_text(s, encoding='utf-8')
print('wing details cleaned')
