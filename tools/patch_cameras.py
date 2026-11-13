from pathlib import Path

p = Path('tools/build_ship_fbx.py')
s = p.read_text(encoding='utf-8')

old = """details = [
    ('detail_cockpit.png', (5.8, -9.5, 5.0), (0, -3.0, 0.9), 60),
    ('detail_intake.png', (6.8, -4.2, 2.6), (3.05, 1.1, 0.8), 55),
    ('detail_nozzle.png', (7.0, 9.4, 2.6), (3.05, 7.1, 0.8), 55),
    ('detail_wingtip.png', (9.5, 4.2, 3.0), (6.55, 3.6, 0.0), 55),
    ('detail_boom.png', (9.5, 13.5, 3.2), (5.1, 8.4, -0.1), 55),
    ('detail_gear.png', (5.5, -7.5, -5.5), (0, -3.5, -1.2), 50),
    ('detail_underside.png', (0.0, -4.0, -19.0), (0.0, -0.5, 0.0), 55),
]"""

new = """details = [
    ('detail_cockpit.png', (2.9, -8.6, 3.4), (0.0, -2.4, 1.15), 58),
    ('detail_intake.png', (6.7, -4.6, 2.8), (3.05, 0.95, 0.85), 55),
    ('detail_nozzle.png', (7.2, 10.2, 2.8), (3.05, 7.15, 0.80), 55),
    ('detail_wingtip.png', (9.8, 3.4, 3.2), (6.55, 3.9, 0.15), 55),
    ('detail_boom.png', (9.8, 13.6, 3.4), (5.1, 8.4, -0.15), 55),
    ('detail_gear.png', (5.5, -7.8, -5.6), (0, -3.2, -1.3), 50),
    ('detail_underside.png', (0.0, -4.0, -19.0), (0.0, -0.5, 0.0), 55),
]"""

if old in s:
    s = s.replace(old, new, 1)
    p.write_text(s, encoding='utf-8')
    print('cameras updated')
else:
    print('MISS cameras')
