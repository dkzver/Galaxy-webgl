import { PhysicsWorld, boxShape, compoundShape, getWorldBoxes } from '../public/js/physics.js';

const w = new PhysicsWorld({ gravity: [0, 0, 0], iterations: 8, positionIterations: 4, fixedStep: 1 / 120, maxSubSteps: 1 });
const target = w.addBody({ type: 'static', position: [0, 0, 0], restitution: 0.2, friction: 0, shape: boxShape([2, 2, 2]) });

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

let prev = ship.velocity[0];
for (let i = 1; i <= 300; i++) {
  w.step(w.fixedStep);
  if (Math.abs(ship.velocity[0] - prev) > 0.001 || (i % 40 === 0)) {
    console.log(
      String(i).padStart(3),
      'x=' + ship.position[0].toFixed(3),
      'vx=' + ship.velocity[0].toFixed(3),
      'contacts=' + w.contacts.length,
      'manifolds=' + w.manifolds.length,
      w.contacts.length ? 'pen=' + w.contacts.map((c) => c.penetration.toFixed(2)).join('/') : ''
    );
    prev = ship.velocity[0];
  }
  if (i > 120) break;
}

console.log('boxes', JSON.stringify(getWorldBoxes(ship)));
