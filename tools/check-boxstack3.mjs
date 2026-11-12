import { PhysicsWorld, boxShape } from '../public/js/physics.js';

const w = new PhysicsWorld({ gravity: [0, -20, 0], iterations: 8, positionIterations: 4, fixedStep: 1 / 120, maxSubSteps: 1 });
const platform = w.addBody({ type: 'static', position: [0, 0, 0], restitution: 0, friction: 0.6, shape: boxShape([3, 1, 3]) });
const cube = w.addBody({ mass: 2, position: [0, 6, 0], restitution: 0, friction: 0.6, shape: boxShape([1, 1, 1]) });

for (let i = 1; i <= 78; i++) w.step(w.fixedStep);

console.log('platform shape', JSON.stringify(platform.shape));
console.log('cube shape    ', JSON.stringify(cube.shape));
console.log('platform pos', platform.position, 'quat', platform.quaternion);
console.log('cube pos', cube.position, 'quat', cube.quaternion);
console.log('cube aabb', cube.aabb, 'radius', cube.shape.boundingRadius);

const m = w._collide(platform, cube);
console.log('collide', m ? `contacts=${m.contacts.length}` : 'null');

// вручную повторяем SAT
const pA = platform.shape.boxes[0];
const pB = cube.shape.boxes[0];
console.log('partA', pA, 'partB', pB);
console.log('offsetA', pA.offset, 'offsetB', pB.offset);
