import { expect, it } from 'vitest';
import sharp from 'sharp';
import { imageThumbnail } from '@niticket/core/infrastructure/thumbnail';

it('generates a small oriented WebP without enlarging small source images', async () => {
  const large = await sharp({
    create: { width: 2400, height: 1600, channels: 3, background: '#73847b' },
  })
    .png()
    .toBuffer();
  const preview = await imageThumbnail(large),
    metadata = await sharp(preview).metadata();
  expect(metadata.format).toBe('webp');
  expect(metadata.width).toBe(512);
  expect(metadata.height).toBeLessThanOrEqual(512);
  expect(preview.length).toBeLessThan(large.length);
  const small = await sharp({
    create: { width: 80, height: 60, channels: 3, background: '#73847b' },
  })
    .png()
    .toBuffer();
  expect((await sharp(await imageThumbnail(small)).metadata()).width).toBe(80);
});
