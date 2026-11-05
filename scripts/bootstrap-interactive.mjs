import { createInterface } from 'node:readline/promises';
import { Writable } from 'node:stream';
import { spawn } from 'node:child_process';

if (!process.stdin.isTTY)
  throw new Error(
    'Interactive bootstrap requires a terminal; automation must pass JSON to admin:bootstrap over stdin.',
  );
const rl = createInterface({ input: process.stdin, output: process.stdout });
const name = await rl.question('Administrator display name: ');
const email = await rl.question('Administrator email: ');
rl.close();

async function secret(prompt) {
  process.stdout.write(prompt);
  const sink = new Writable({
    write(_chunk, _encoding, callback) {
      callback();
    },
  });
  const hidden = createInterface({ input: process.stdin, output: sink, terminal: true });
  const value = await hidden.question('');
  hidden.close();
  process.stdout.write('\n');
  return value;
}

const password = await secret('Password (hidden; at least 12 characters): ');
const confirm = await secret('Confirm password (hidden): ');
if (password !== confirm) throw new Error('Passwords do not match.');
const child = spawn(process.execPath, ['--import', 'tsx', 'scripts/bootstrap.ts'], {
  env: { ...process.env, BOOTSTRAP_ENABLED: 'true' },
  stdio: ['pipe', 'inherit', 'inherit'],
});
child.stdin.end(JSON.stringify({ name, email, password, accountType: 'STAFF' }));
child.on('exit', (code) => process.exit(code ?? 1));
