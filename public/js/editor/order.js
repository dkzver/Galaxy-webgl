// Перестановка объектов в дереве сцены/префаба.
//
// Модуль не знает про DOM и редактор: работает с массивами сущностей
// (`entities[].children`). Любая вложенность поддерживается рекурсией.
//
// Режимы:
//   before — поставить перед target в его списке;
//   after  — поставить после target в его списке;
//   into   — добавить в конец children у target (только группа).

/** Найти узел и его родителя. */
export function findNode(list, id, parent = null) {
  for (const node of list || []) {
    if (node.id === id) return { node, parent };
    const found = findNode(node.children || [], id, node);
    if (found) return found;
  }
  return null;
}

/** Есть ли id внутри поддерева узла. */
export function containsNode(node, id) {
  return (node?.children || []).some((child) => child.id === id || containsNode(child, id));
}

/** Список, в котором лежит узел. */
export function siblingsOf(roots, found) {
  return found.parent ? (found.parent.children || []) : roots;
}

/**
 * Переставить узел в дереве.
 * @param {Array} roots корневой массив сущностей
 * @param {string} sourceId что переносим
 * @param {string|null} targetId рядом с кем / внутрь кого; null — корень
 * @param {'before'|'after'|'into'} mode
 * @returns {{node:object, fromParent:object|null, toParent:object|null,
 *   fromIndex:number, toIndex:number}|null}
 */
export function moveNode(roots, sourceId, targetId, mode = 'after') {
  if (!Array.isArray(roots) || !sourceId) return null;
  if (sourceId === targetId) return null;
  if (mode !== 'before' && mode !== 'after' && mode !== 'into') return null;

  const source = findNode(roots, sourceId);
  if (!source) return null;

  let target = null;
  if (targetId) {
    target = findNode(roots, targetId);
    if (!target) return null;

    // Внутрь собственного поддерева нельзя: получится цикл.
    if (containsNode(source.node, targetId)) return null;
    if (mode === 'into' && target.node.type !== 'empty') return null;
  } else if (mode !== 'after') {
    return null;
  }

  const fromList = siblingsOf(roots, source);
  const fromIndex = fromList.indexOf(source.node);
  if (fromIndex < 0) return null;

  fromList.splice(fromIndex, 1);

  let toList;
  let toIndex;
  let toParent = null;

  if (mode === 'into') {
    target.node.children = target.node.children || [];
    toList = target.node.children;
    toParent = target.node;
    toIndex = toList.length;
  } else if (target) {
    toList = siblingsOf(roots, target);
    toParent = target.parent;
    toIndex = toList.indexOf(target.node);
    if (toIndex < 0) toIndex = toList.length;
    if (mode === 'after') toIndex += 1;
  } else {
    toList = roots;
    toIndex = roots.length;
  }

  toList.splice(toIndex, 0, source.node);

  return {
    node: source.node,
    fromParent: source.parent,
    toParent,
    fromIndex,
    toIndex
  };
}

/** Индекс узла среди соседей; -1 — не найден. */
export function indexOfNode(roots, id) {
  const found = findNode(roots, id);
  if (!found) return -1;
  return siblingsOf(roots, found).indexOf(found.node);
}
