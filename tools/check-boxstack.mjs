import { PhysicsWorld, boxShape, compoundShape } from '../public/js/physics.js';

const w = new PhysicsWorld({ gravity: [0, -20, 0], iterations: 8, positionIterations: 4, fixedStep: 1 / 120, maxSubSteps: 1 });
w.addBody({ type: 'static', position: [0, 0, 0], restitution: 0, friction: 0.6, shape: boxShape([3, 1, 3]) });
const cube = w.addBody({ mass: 2, position: [0, 6, 0], restitution: 0, friction: 0.6, shape: boxShape([1, 1, 1]) });

for (let i = 1; i <= 400; i++) {
  w.step(w.fixedStep);

  if (i % 20 === 0 || (i > 60 && i <= 90)) {
    console.log(
      String(i).padStart(3),
      'y=' + cube.position[1].toFixed(3),
      'vy=' + cube.velocity[1].toFixed(2),
      'contacts=' + w.contacts.length,
      'manifolds=' + w.manifolds.length,
      'pen=' + (w.contacts[0] ? w.contacts[0].penetration.toFixed(3) : '—')
    );
  }
}
