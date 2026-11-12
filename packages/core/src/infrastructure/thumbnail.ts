import sharp from 'sharp';

/** Derivatives are generated only from bytes that already passed the scanner. */
export async function imageThumbnail(bytes: Buffer) {
  return sharp(bytes, { limitInputPixels: 40000000 })
    .rotate()
    .resize(512, 512, { fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 76 })
    .toBuffer();
}
