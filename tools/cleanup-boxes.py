import io
import re

# 1. Удалить неиспользуемую triangleDistance из редактора модели
path = 'public/js/editor/model-editor.js'
src = io.open(path, encoding='utf-8', newline='').read()
start = src.find('/** Точное расстояние от точки до треугольника')
end = src.find('async function fitColliderAsync() {')
if start < 0 or end < 0 or end <= start:
    raise SystemExit('triangleDistance block not found')
src = src[:start] + src[end:]
io.open(path, 'w', encoding='utf-8', newline='').write(src)
print('triangleDistance removed')

# 2. Подписи в HTML
html_path = 'public/model-editor.html'
html = io.open(html_path, encoding='utf-8', newline='').read()

old_hint = ('Строится по треугольникам меша: набор сфер покрывает корпус, даже сложный. '
            'Точность — ползунком. Настройки хранятся в')
new_hint = ('Строится по треугольникам меша: объём модели раскладывается на боксы, '
            'они не выходят за корпус. Точность — ползунком. Настройки хранятся в')

if old_hint not in html:
    raise SystemExit('hint not found')

html = html.replace(old_hint, new_hint)

old_view = ('Зелёным показан коллайдер, который сохранится.')
new_view = ('Зелёным показан коллайдер — боксы, которые сохранятся.')

if old_view in html:
    html = html.replace(old_view, new_view)

io.open(html_path, 'w', encoding='utf-8', newline='').write(html)
print('html updated')
