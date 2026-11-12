import { copyFile, mkdir, cp, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const directory = path.join(root, 'apps/web/public');
const { version } = JSON.parse(
  await readFile(path.join(root, 'node_modules/pdfjs-dist/package.json'), 'utf8'),
);
const release = path.join(directory, 'pdf-assets', 'releases', version);
await mkdir(release, { recursive: true });
await mkdir(directory, { recursive: true });
await copyFile(
  path.join(root, 'node_modules/pdfjs-dist/build/pdf.worker.min.mjs'),
  path.join(directory, 'pdf.worker.min.mjs'),
);
await copyFile(
  path.join(root, 'node_modules/pdfjs-dist/build/pdf.worker.min.mjs'),
  path.join(release, 'pdf.worker.min.mjs'),
);
for (const name of ['cmaps', 'standard_fonts', 'wasm']) {
  await cp(
    path.join(root, 'node_modules/pdfjs-dist', name),
    path.join(directory, 'pdf-assets', name),
    { recursive: true },
  );
  await cp(path.join(root, 'node_modules/pdfjs-dist', name), path.join(release, name), {
    recursive: true,
  });
}
