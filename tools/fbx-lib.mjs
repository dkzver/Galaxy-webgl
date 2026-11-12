// Минимальный парсер бинарного FBX (7.x): дерево узлов + свойства.
import fs from 'node:fs';
import zlib from 'node:zlib';

export function parseFBX(buffer) {
  const head = buffer.toString('ascii', 0, 20);
  if (!head.startsWith('Kaydara FBX Binary')) throw new Error('не бинарный FBX');

  const version = buffer.readUInt32LE(23);
  const wide = version >= 7500;

  const readNode = (offset) => {
    const end = wide ? Number(buffer.readBigUInt64LE(offset)) : buffer.readUInt32LE(offset);
    const numProps = wide ? Number(buffer.readBigUInt64LE(offset + 8)) : buffer.readUInt32LE(offset + 4);
    const propLen = wide ? Number(buffer.readBigUInt64LE(offset + 16)) : buffer.readUInt32LE(offset + 8);
    const nameLen = buffer.readUInt8(wide ? offset + 24 : offset + 12);
    const nameStart = wide ? offset + 25 : offset + 13;
    const name = buffer.toString('utf8', nameStart, nameStart + nameLen);

    let p = nameStart + nameLen;
    const props = [];
    for (let i = 0; i < numProps; i++) {
      const type = String.fromCharCode(buffer.readUInt8(p));
      p += 1;
      switch (type) {
        case 'Y': props.push(buffer.readInt16LE(p)); p += 2; break;
        case 'C': props.push(buffer.readUInt8(p) !== 0); p += 1; break;
        case 'I': props.push(buffer.readInt32LE(p)); p += 4; break;
        case 'F': props.push(buffer.readFloatLE(p)); p += 4; break;
        case 'D': props.push(buffer.readDoubleLE(p)); p += 8; break;
        case 'L': props.push(Number(buffer.readBigInt64LE(p))); p += 8; break;
        case 'S': {
          const len = buffer.readUInt32LE(p);
          p += 4;
          props.push(buffer.toString('utf8', p, p + len));
          p += len;
          break;
        }
        case 'R': {
          const len = buffer.readUInt32LE(p);
          p += 4;
          props.push(buffer.subarray(p, p + len));
          p += len;
          break;
        }
        case 'f': case 'd': case 'l': case 'i': case 'b': {
          const len = buffer.readUInt32LE(p);
          const encoding = buffer.readUInt32LE(p + 4);
          const compressed = buffer.readUInt32LE(p + 8);
          p += 12;
          const raw = buffer.subarray(p, p + compressed);
          p += compressed;

          let data = raw;
          if (encoding === 1) data = zlib.inflateSync(raw);

          // Копируем в собственный буфер: смещение внутри Buffer может быть не выровнено под double
          const byteLength = type === 'd' || type === 'l' ? len * 8 : type === 'i' || type === 'f' ? len * 4 : len;
          const copy = new Uint8Array(byteLength);
          copy.set(data.subarray(0, byteLength));
          data = copy.buffer;

          let arr;
          if (type === 'f') arr = new Float32Array(data, 0, len);
          else if (type === 'd') arr = new Float64Array(data, 0, len);
          else if (type === 'i') arr = new Int32Array(data, 0, len);
          else if (type === 'l') arr = new BigInt64Array(data, 0, len);
          else if (type === 'b') arr = new Uint8Array(data, 0, len);
          else arr = new Float32Array(data, 0, len);
          props.push(arr);
          break;
        }
        default:
          throw new Error(`неизвестный тип свойства ${type} на позиции ${p}`);
      }
    }

    const children = [];
    let childOffset = nameStart + nameLen + propLen;
    while (childOffset < end && childOffset + 13 <= buffer.length) {
      const nextEnd = wide ? Number(buffer.readBigUInt64LE(childOffset)) : buffer.readUInt32LE(childOffset);
      if (nextEnd === 0) break;
      const child = readNode(childOffset);
      children.push(child.node);
      childOffset = child.end;
    }

    return { node: { name, props, children }, end };
  };

  const root = { name: 'root', props: [], children: [] };
  let offset = 27;
  while (offset + 13 < buffer.length) {
    const end = wide ? Number(buffer.readBigUInt64LE(offset)) : buffer.readUInt32LE(offset);
    if (end === 0) break;
    const { node, end: next } = readNode(offset);
    root.children.push(node);
    offset = next;
  }
  return { version, root };
}

if (process.argv[1] && process.argv[1].endsWith('fbx-lib.mjs')) {
  const buf = fs.readFileSync(process.argv[2]);
  const { version, root } = parseFBX(buf);
  console.log('FBX version', version, 'root nodes', root.children.length);
}
