import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = process.argv[2] ? path.resolve(process.argv[2]) : null;

if (!source) {
  console.error('Укажите каталог сборки React: npm run sync:engine-ui -- <client dist>');
  process.exitCode = 1;
} else {
  const manifest = path.join(source, '.vite', 'manifest.json');
  if (!fs.existsSync(manifest)) {
    console.error(`Не найден Vite manifest: ${manifest}. Сначала соберите клиент с build.manifest=true.`);
    process.exitCode = 1;
  } else {
    const uiTarget = path.join(projectRoot, 'public', 'ui');
    fs.mkdirSync(uiTarget, { recursive: true });
    fs.cpSync(source, uiTarget, { recursive: true, force: true });
    console.log(`React UI синхронизирован из ${source} в ${uiTarget}`);
  }
}
