import test from 'node:test';
import assert from 'node:assert/strict';

import { findNode, indexOfNode, moveNode } from '../public/js/editor/order.js';

function makeTree() {
  return [
    {
      id: 'a',
      type: 'empty',
      children: [
        { id: 'a1', type: 'model' },
        {
          id: 'a2',
          type: 'empty',
          children: [
            { id: 'a2x', type: 'model' },
            { id: 'a2y', type: 'model' }
          ]
        },
        { id: 'a3', type: 'model' }
      ]
    },
    { id: 'b', type: 'model' }
  ];
}

function ids(list) {
  return list.map((node) => node.id);
}

test('объект ставится после соседа в корне', () => {
  const tree = makeTree();
  const moved = moveNode(tree, 'a', 'b', 'after');

  assert.deepEqual(ids(tree), ['b', 'a']);
  assert.equal(moved.toParent, null);
  assert.equal(moved.toIndex, 1);
});

test('объект ставится перед соседом в корне', () => {
  const tree = makeTree();
  moveNode(tree, 'b', 'a', 'before');

  assert.deepEqual(ids(tree), ['b', 'a']);
});

test('объект можно поднять в начало списка группы', () => {
  const tree = makeTree();
  moveNode(tree, 'a3', 'a1', 'before');

  assert.deepEqual(ids(tree[0].children), ['a3', 'a1', 'a2']);
});

test('объект можно опустить в конец списка группы', () => {
  const tree = makeTree();
  moveNode(tree, 'a1', 'a3', 'after');

  assert.deepEqual(ids(tree[0].children), ['a2', 'a3', 'a1']);
});

test('объект переносится внутрь пустой группы в конец', () => {
  const tree = makeTree();
  const moved = moveNode(tree, 'b', 'a2', 'into');

  assert.deepEqual(ids(tree), ['a']);
  assert.deepEqual(ids(tree[0].children[1].children), ['a2x', 'a2y', 'b']);
  assert.equal(moved.toParent.id, 'a2');
});

test('объект переносится из вложенной группы в корень', () => {
  const tree = makeTree();
  moveNode(tree, 'a2x', 'b', 'before');

  assert.deepEqual(ids(tree), ['a', 'a2x', 'b']);
  assert.deepEqual(ids(tree[0].children[1].children), ['a2y']);
});

test('порядок внутри чужой группы сохраняется при переносе', () => {
  const tree = makeTree();
  moveNode(tree, 'b', 'a2x', 'after');

  assert.deepEqual(ids(tree), ['a']);
  assert.deepEqual(ids(tree[0].children[1].children), ['a2x', 'b', 'a2y']);
});

test('нельзя вложить объект в собственное поддерево', () => {
  const tree = makeTree();
  const before = JSON.stringify(tree);

  assert.equal(moveNode(tree, 'a', 'a2', 'into'), null);
  assert.equal(JSON.stringify(tree), before, 'дерево не изменилось');
});

test('нельзя вложить внутрь не-группы', () => {
  const tree = makeTree();
  const before = JSON.stringify(tree);

  assert.equal(moveNode(tree, 'b', 'a1', 'into'), null);
  assert.equal(JSON.stringify(tree), before);
});

test('нельзя переставить объект относительно самого себя', () => {
  const tree = makeTree();
  const before = JSON.stringify(tree);

  assert.equal(moveNode(tree, 'a', 'a', 'after'), null);
  assert.equal(JSON.stringify(tree), before);
});

test('сброс в корень без цели добавляет в конец', () => {
  const tree = makeTree();
  moveNode(tree, 'a1', null, 'after');

  assert.deepEqual(ids(tree), ['a', 'b', 'a1']);
  assert.deepEqual(ids(tree[0].children), ['a2', 'a3']);
});

test('findNode и indexOfNode видят любой уровень вложенности', () => {
  const tree = makeTree();
  const found = findNode(tree, 'a2y');

  assert.equal(found.node.id, 'a2y');
  assert.equal(found.parent.id, 'a2');
  assert.equal(indexOfNode(tree, 'a2x'), 0);
  assert.equal(indexOfNode(tree, 'missing'), -1);
});
