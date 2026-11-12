import { PhysicsWorld, boxShape, compoundShape, getWorldBoxes } from '../public/js/physics.js';

function world() {
  return new PhysicsWorld({ gravity: [0, 0, 0], iterations: 8, positionIterations: 3 });
}

// 1. Куб летит в статичный куб
{
  const w = world();
  const target = w.addBody({
    type: 'static',
    position: [0, 0, 0],
    restitution: 0,
    friction: 0,
    shape: boxShape([2, 2, 2])
  });
  const cube = w.addBody({
    mass: 1,
    position: [-6, 0, 0],
    velocity: [20, 0, 0],
    restitution: 0,
    friction: 0,
    lockRotation: true,
    shape: boxShape([1, 1, 1])
  });

  for (let i = 0; i < 240; i++) w.step(w.fixedStep);
  console.log('box→box: x =', cube.position[0].toFixed(3), 'v =', cube.velocity[0].toFixed(3),
    'target =', target.position.join(','));
}

// 2. Куб падает на куб сверху (проверка «лежания» на грани)
{
  const w = new PhysicsWorld({ gravity: [0, -20, 0], iterations: 8, positionIterations: 4 });
  w.addBody({ type: 'static', position: [0, 0, 0], restitution: 0, friction: 0.6, shape: boxShape([3, 1, 3]) });
  const cube = w.addBody({
    mass: 2,
    position: [0, 6, 0],
    restitution: 0,
    friction: 0.6,
    shape: boxShape([1, 1, 1])
  });

  for (let i = 0; i < 600; i++) w.step(w.fixedStep);
  console.log('box on box: y =', cube.position[1].toFixed(3), 'vy =', cube.velocity[1].toFixed(3),
    'tilt =', Math.abs(cube.quaternion[0]).toFixed(4), Math.abs(cube.quaternion[2]).toFixed(4));
}

// 3. Compound из боксов врезается в статичный куб
{
  const w = world();
  w.addBody({ type: 'static', position: [0, 0, 0], restitution: 0.2, friction: 0, shape: boxShape([2, 2, 2]) });

  const ship = w.addBody({
    mass: 12,
    position: [-14, 0, 0],
    velocity: [30, 0, 0],
    lockRotation: true,
    restitution: 0.2,
    friction: 0,
    shape: compoundShape([
      { type: 'box', offset: [0, 0, 0], halfExtents: [3, 1, 1] },
      { type: 'box', offset: [-2.5, 0, 0], halfExtents: [1, 1.4, 1.4] }
    ])
  });

  let minGap = Infinity;
  for (let i = 0; i < 300; i++) {
    w.step(w.fixedStep);
    const box = getWorldBoxes(ship)[0];
    minGap = Math.min(minGap, (box.center[0] - box.halfExtents[0]) - 2);
  }

  console.log('compound→box: x =', ship.position[0].toFixed(3), 'v =', ship.velocity[0].toFixed(3),
    'min gap =', minGap.toFixed(3), 'finite =', Number.isFinite(ship.position[0]));
}

// 4. Box ↔ sphere внутри compound (смешанный набор)
{
  const w = world();
  w.addBody({ type: 'static', position: [0, 0, 0], restitution: 0, friction: 0, shape: boxShape([2, 2, 2]) });

  const mixed = w.addBody({
    mass: 5,
    position: [-12, 0, 0],
    velocity: [24, 0, 0],
    restitution: 0,
    friction: 0,
    lockRotation: true,
    shape: compoundShape([
      { type: 'sphere', offset: [0, 0, 0], radius: 1 },
      { type: 'box', offset: [0, 0, 2], halfExtents: [1, 1, 1] }
    ])
  });

  for (let i = 0; i < 240; i++) w.step(w.fixedStep);
  console.log('mixed→box: x =', mixed.position[0].toFixed(3), 'v =', mixed.velocity[0].toFixed(3));
}
