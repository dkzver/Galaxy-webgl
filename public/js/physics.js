/**
 * @fileoverview Публичный фасад физики GalaxyDemo.
 *
 * Реализация разложена по модулям `physics/shapes.js`, `physics/narrowphase.js`
 * и `physics/world.js`. Импорт из `physics.js` остаётся совместимым со старым
 * кодом и тестами.
 */

export { Body, PhysicsWorld } from './physics/world.js';
export {
  sphereShape,
  boxShape,
  compoundShape,
  getWorldSpheres,
  getWorldBoxes
} from './physics/shapes.js';
