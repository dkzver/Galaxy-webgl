## Шаг 5: Стратегия высокопoly моделирования

### Этап 1: Базовая геометрия
1. `Shift+A → Mesh → Plane`
2. `Ctrl+R` - много режетов (20+ сегментов)
3. `W → Subdivide` - многократное подразделение
4. Переключайтесь камерами: `NumPad 0` затем `NumPad 1, 3, 7`

### Этап 2: Блокировка форм (Sculpt Mode)
1. `Tab → Sculpt Mode`
2. Основные кисти:
   - **Clay Strips** - формирование поверхностей
   - **Grab** - растягивание форм
   - **Clay** - построение объема
3. Сопоставляйте с каждым ракурсом reference

### Этап 3: Детализация структуры
1. **Панели и ребра**: `Ctrl+R` для линий, `E` для экструзии, `F` для граней
2. **Решетки**: Сетковые_patternы на hull
3. **Профили**: Нос, борт, корма по reference

### Этап 4: Микро-детали (High-Poly)
1. **Multiresolution Modifier**: 5 уровней подразделения
2. **Dynamic Topology**: `Shift+D` в Sculpt режиме
3. **Реквизит**: Болты, заклепки, порты, люки, масти, антенны

### Этап 5: Beveling и износ краев
1. **Bevel Modifier**: Реалистичное rounding of edges
2. **Edge Scratches**: Ручной рисование микро-канавок
3. **Paint Mode**: Добавление текстуры износа

## Шаг 6: Продвинутые техники

### Multiresolution workflow (Python)
```python
obj = bpy.context.active_object
mod = obj.modifiers.new(name="Multires", type='MULTIRES')
mod.levels = 5
mod.render_levels = 5
```

### Boolean operations (для вырезов)
```python
mod = obj.modifiers.new(name="Boolean", type='BOOLEAN')
mod.operation = 'DIFFERENCE'
mod.object = target_object
```

### Custom alpha textures
- Создавайте alphas для рисования швов, линий патин, текста
- Используйте `Mask` инструменты для защиты областей