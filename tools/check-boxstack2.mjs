import { PhysicsWorld, boxShape } from '../public/js/physics.js';

const w = new PhysicsWorld({ gravity: [0, -20, 0], iterations: 8, positionIterations: 4, fixedStep: 1 / 120, maxSubSteps: 1 });
const platform = w.addBody({ type: 'static', position: [0, 0, 0], restitution: 0, friction: 0.6, shape: boxShape([3, 1, 3]) });
const cube = w.addBody({ mass: 2, position: [0, 6, 0], restitution: 0, friction: 0.6, shape: boxShape([1, 1, 1]) });

for (let i = 1; i <= 90; i++) {
  w.step(w.fixedStep);

  if (i >= 74 && i <= 82) {
    const m = w._collide(platform, cube);
    console.log(
      String(i).padStart(3),
      'y=' + cube.position[1].toFixed(4),
      'vy=' + cube.velocity[1].toFixed(3),
      'q=[' + cube.quaternion.map((v) => v.toFixed(3)).join(',') + ']',
      'pairs=' + w._pairs.length,
      'built=' + w.contacts.length,
      'direct=' + (m ? m.contacts.length + ' pen=' + m.contacts[0].penetration.toFixed(4) : 'null')
    );
  }
}

console.log('--- после шага 90 ---');
console.log('cube', cube.position.map((v) => v.toFixed(3)), 'platform', platform.position);
const m = w._collide(platform, cube);
console.log('direct', m ? `contacts=${m.contacts.length} pen=${m.contacts[0].penetration.toFixed(3)}` : 'null');
