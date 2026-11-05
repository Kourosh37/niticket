import { randomBytes } from 'node:crypto';
import { readFile, writeFile, access } from 'node:fs/promises';

try {
  await access('.env');
  console.error('.env already exists; no changes made.');
  process.exit(1);
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}
let template = await readFile('.env.example', 'utf8');
const replacements = {
  CHANGE_ME_DATABASE_PASSWORD: randomBytes(24).toString('hex'),
  CHANGE_ME_WITH_AT_LEAST_32_RANDOM_BYTES: randomBytes(32).toString('hex'),
  CHANGE_ME_MINIO_ACCESS: randomBytes(12).toString('hex'),
  CHANGE_ME_MINIO_SECRET_AT_LEAST_32_CHARS: randomBytes(32).toString('hex'),
};
for (const [key, value] of Object.entries(replacements)) template = template.replaceAll(key, value);
await writeFile('.env', template, { mode: 0o600, flag: 'wx' });
console.log('Created .env with random local service secrets. No user accounts were created.');
