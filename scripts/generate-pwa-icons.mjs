import { mkdir, readFile, writeFile } from 'node:fs/promises';
import sharp from 'sharp';

// Derive install icons from the existing vector artwork, preserving the source.
const source = await readFile(new URL('../app/icon.svg', import.meta.url));
await mkdir(new URL('../public/icons/', import.meta.url), { recursive: true });

for (const [path, size, scale] of [
  ['public/icons/icon-192.png', 192, 0.8],
  ['public/icons/icon-512.png', 512, 0.8],
  // Keep the full artwork inside Android's central 80%-diameter safe circle.
  ['public/icons/icon-maskable-512.png', 512, 0.56],
  ['app/apple-icon.png', 180, 0.8],
]) {
  const artwork = await sharp(source).resize(Math.round(size * scale)).png().toBuffer();
  const icon = await sharp({
    create: { width: size, height: size, channels: 4, background: '#ffffff' },
  }).composite([{ input: artwork, gravity: 'centre' }]).removeAlpha().png().toBuffer();
  await writeFile(new URL(`../${path}`, import.meta.url), icon);
}
