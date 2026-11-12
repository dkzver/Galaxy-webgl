import { PhysicsWorld, boxShape } from '../public/js/physics.js';

const w = new PhysicsWorld({ gravity: [0, 0, 0], iterations: 8, positionIterations: 4, fixedStep: 1 / 120, maxSubSteps: 1 });

const a = w.addBody({ type: 'static', position: [0, 0, 0], shape: boxShape([3, 1, 3]) });
const b = w.addBody({ mass: 2, position: [0, 1.5, 0], shape: boxShape([1, 1, 1]) });

for (const y of [3, 2.5, 2.1, 2.05, 2.0, 1.9, 1.5, 1.0, 0.5, 0.2, 0]) {
  b.setPosition([0, y, 0]);
  const m = w._collide(a, b);
  console.log(
    'y=' + y,
    m ? `contacts=${m.contacts.length} n=[${m.normal.map((v) => v.toFixed(2)).join(',')}] pen=${m.contacts[0].penetration.toFixed(3)}` : 'null'
  );
}
