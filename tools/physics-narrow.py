import io

path = 'public/js/physics.js'
raw = io.open(path, encoding='utf-8', newline='').read()
crlf = '\r\n' in raw
src = raw.replace('\r\n', '\n')

def cut(text, start_marker, end_marker, replacement, label):
    i = text.find(start_marker)
    if i < 0:
        raise SystemExit(f'{label}: start not found')
    j = text.find(end_marker, i)
    if j < 0:
        raise SystemExit(f'{label}: end not found')
    return text[:i] + replacement + text[j:]

narrow = '''  // Narrow phase: сферы ↔ сферы, боксы ↔ сферы, боксы ↔ боксы.
  // Части compound перебираются попарно, нормаль контакта всегда от A к B.
  _collide(a, b) {
    if (a.ignores?.has(b) || b.ignores?.has(a)) return null;

    const contacts = [];
    const spheresA = localSpheres(a);
    const spheresB = localSpheres(b);
    const boxesA = localBoxes(a);
    const boxesB = localBoxes(b);

    for (const sphereA of spheresA) {
      for (const sphereB of spheresB) {
        const normal = sphereNormal(a, sphereA, b, sphereB);
        if (!normal) continue;

        const centerA = worldPoint(a, sphereA.offset);
        const penetration = sphereA.radius + sphereB.radius - normal.distance;

        contacts.push(this._makeContact(a, b, {
          normal: normal.direction,
          point: [
            centerA[0] + normal.direction[0] * (sphereA.radius - penetration * 0.5),
            centerA[1] + normal.direction[1] * (sphereA.radius - penetration * 0.5),
            centerA[2] + normal.direction[2] * (sphereA.radius - penetration * 0.5)
          ],
          penetration,
          sphereA,
          sphereB
        }));
      }
    }

    for (const boxPart of boxesA) {
      for (const sphere of spheresB) {
        const geometry = boxSphereContact(a, boxPart, b, sphere);
        if (!geometry) continue;

        contacts.push(this._makeContact(a, b, {
          normal: geometry.outward,
          point: geometry.point,
          penetration: geometry.penetration,
          boxBody: a,
          boxPart,
          sphereBody: b,
          sphere
        }));
      }
    }

    for (const sphere of spheresA) {
      for (const boxPart of boxesB) {
        const geometry = boxSphereContact(b, boxPart, a, sphere);
        if (!geometry) continue;

        contacts.push(this._makeContact(a, b, {
          normal: [-geometry.outward[0], -geometry.outward[1], -geometry.outward[2]],
          point: geometry.point,
          penetration: geometry.penetration,
          boxBody: b,
          boxPart,
          sphereBody: a,
          sphere
        }));
      }
    }

    for (const partA of boxesA) {
      for (const partB of boxesB) {
        const geometry = boxBoxGeometry(a, partA, b, partB);
        if (!geometry) continue;

        for (const point of geometry.points) {
          contacts.push(this._makeContact(a, b, {
            normal: geometry.normal,
            point,
            penetration: geometry.overlap,
            bodyA: a,
            partA,
            bodyB: b,
            partB
          }));
        }
      }
    }

    if (!contacts.length) return null;

    let deepest = contacts[0];
    let approachSpeed = 0;

    for (const contact of contacts) {
      if (contact.penetration > deepest.penetration) deepest = contact;
      if (contact.approachSpeed > approachSpeed) approachSpeed = contact.approachSpeed;
    }

    return {
      a,
      b,
      contacts,
      approachSpeed,
      normal: deepest.normal,
      point: deepest.point
    };
  }

  // Один контакт: геометрия, плечи, материал и упругость в одном месте —
  // чтобы сферы, боксы и их смеси считались одинаково.
  _makeContact(a, b, geometry) {
    const { normal, point, penetration } = geometry;

    const contact = {
      a,
      b,
      normal,
      point,
      rA: [point[0] - a.position[0], point[1] - a.position[1], point[2] - a.position[2]],
      rB: [point[0] - b.position[0], point[1] - b.position[1], point[2] - b.position[2]],
      penetration,
      normalImpulse: 0,
      tangentImpulse: 0,
      restitutionBias: 0,
      approachSpeed: 0,
      friction: Math.sqrt(a.friction * b.friction)
    };

    if (geometry.sphereA) {
      contact.sphereA = geometry.sphereA;
      contact.sphereB = geometry.sphereB;
    }
    if (geometry.boxPart) {
      contact.boxBody = geometry.boxBody;
      contact.boxPart = geometry.boxPart;
      contact.sphereBody = geometry.sphereBody;
      contact.sphere = geometry.sphere;
    }
    if (geometry.partA) {
      contact.bodyA = geometry.bodyA;
      contact.partA = geometry.partA;
      contact.bodyB = geometry.bodyB;
      contact.partB = geometry.partB;
    }

    const relative = relativeVelocity(contact);
    const normalSpeed =
      relative[0] * normal[0] +
      relative[1] * normal[1] +
      relative[2] * normal[2];

    contact.approachSpeed = Math.max(0, -normalSpeed);

    const restitution = Math.max(a.restitution, b.restitution);
    if (-normalSpeed > this.restitutionThreshold) {
      // Целевая скорость после удара: -e * vn. Порог не даёт дрожать
      // на медленном касании.
      contact.restitutionBias = -restitution * normalSpeed;
    }

    contact.normalMass = 1 / effectiveMass(a, b, contact.rA, contact.rB, normal);
    return contact;
  }

'''

src = cut(
    src,
    '  // Развод по типам коллайдеров.',
    '  _solveVelocities() {',
    narrow,
    'narrow phase'
)

# helper for sphere-sphere normal
helper = '''/**
 * Нормаль и расстояние между двумя сферами тел. null — сферы не касаются.
 * @returns {{direction: number[], distance: number}|null}
 */
function sphereNormal(bodyA, sphereA, bodyB, sphereB) {
  const centerA = worldPoint(bodyA, sphereA.offset);
  const centerB = worldPoint(bodyB, sphereB.offset);

  const dx = centerB[0] - centerA[0];
  const dy = centerB[1] - centerA[1];
  const dz = centerB[2] - centerA[2];
  const radiusSum = sphereA.radius + sphereB.radius;
  const distanceSq = dx * dx + dy * dy + dz * dz;

  if (distanceSq >= radiusSum * radiusSum) return null;

  const distance = Math.sqrt(distanceSq);
  if (distance < 1e-6) return { direction: [0, 1, 0], distance: 0 };

  return { direction: [dx / distance, dy / distance, dz / distance], distance };
}

'''
src = cut(
    src,
    '/**\n * Мировые центры и радиусы сфер тела.',
    '/**\n * Мировые центры и радиусы сфер тела.',
    helper,
    'sphereNormal'
)

# positional correction
correction = '''        if (contact.sphereA && contact.sphereB) {
          const normal = sphereNormal(a, contact.sphereA, b, contact.sphereB);
          if (!normal) continue;
          nx = normal.direction[0];
          ny = normal.direction[1];
          nz = normal.direction[2];
          penetration = contact.sphereA.radius + contact.sphereB.radius - normal.distance;
        } else if (contact.boxPart) {
          // Бокс-сфера: пересчитываем на текущей позиции. С застывшим значением
          // из narrow phase каждая итерация выталкивала бы всё глубже.
          const fresh = boxSphereContact(contact.boxBody, contact.boxPart, contact.sphereBody, contact.sphere);
          if (!fresh) continue;

          const sign = a === contact.boxBody ? 1 : -1;
          nx = fresh.outward[0] * sign;
          ny = fresh.outward[1] * sign;
          nz = fresh.outward[2] * sign;
          penetration = fresh.penetration;
        } else if (contact.partA && contact.partB) {
          // Бокс-бокс: свежий SAT, иначе нормаль устаревает за итерации
          const fresh = boxBoxGeometry(contact.bodyA, contact.partA, contact.bodyB, contact.partB);
          if (!fresh) continue;

          const sign = a === contact.bodyA ? 1 : -1;
          nx = fresh.normal[0] * sign;
          ny = fresh.normal[1] * sign;
          nz = fresh.normal[2] * sign;
          penetration = fresh.overlap;
        }
'''

src = cut(
    src,
    '        if (contact.sphereA && contact.sphereB) {\n          const centerA = sphereCenter(a, contact.sphereA);',
    '\n        if (penetration <= this.slop) continue;',
    correction,
    'correction'
)

if crlf:
    src = src.replace('\n', '\r\n')
io.open(path, 'w', encoding='utf-8', newline='').write(src)
print('narrow phase updated')
