import net from 'node:net';
import { config } from './config';
import { fileTypeFromBuffer } from 'file-type';
import { createHash } from 'node:crypto';

export async function detectFile(bytes: Buffer, declared: string) {
  const type = await fileTypeFromBuffer(bytes);
  let mime = type?.mime;
  if (!mime && declared === 'text/plain') {
    try {
      new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      if (!bytes.includes(0)) mime = 'text/plain';
    } catch {
      /* Invalid UTF-8 is rejected. */
    }
  }
  if (mime === 'video/webm' && declared === 'audio/webm') mime = 'audio/webm';
  if (mime === 'video/mp4' && declared === 'audio/mp4') mime = 'audio/mp4';
  if (mime === 'application/ogg' && declared === 'audio/ogg') mime = 'audio/ogg';
  if (mime !== declared) throw new Error('File signature mismatch');
  return { mime, checksum: createHash('sha256').update(bytes).digest('hex') };
}

export async function scanBytes(bytes: Buffer): Promise<void> {
  const c = config();
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: c.CLAMAV_HOST, port: c.CLAMAV_PORT });
    let response = '';
    socket.setTimeout(30000, () => socket.destroy(new Error('Scanner timeout')));
    socket.on('error', reject);
    socket.on('data', (chunk) => (response += chunk.toString()));
    socket.on('end', () => {
      if (response.includes('stream: OK')) resolve();
      else reject(new Error(response.includes('FOUND') ? 'MALWARE_FOUND' : 'Scanner unavailable'));
    });
    socket.on('connect', () => {
      socket.write('zINSTREAM\0');
      for (let offset = 0; offset < bytes.length; offset += 65536) {
        const chunk = bytes.subarray(offset, offset + 65536);
        const size = Buffer.alloc(4);
        size.writeUInt32BE(chunk.length);
        socket.write(size);
        socket.write(chunk);
      }
      socket.write(Buffer.alloc(4));
    });
  });
}
