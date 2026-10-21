import { mkdir, readFile, writeFile } from 'node:fs/promises';
import sharp from 'sharp';

// Derive install/notification icons from the existing vector paths.
// Preserve the favicon and supplied artwork; installed icons always use dark branding.
const source = await readFile(new URL('../app/icon.svg', import.meta.url));
const darkArtwork = Buffer.from(source.toString().replaceAll('#008751', '#00C177'));
await mkdir(new URL('../public/icons/', import.meta.url), { recursive: true });

for (const [path, size, scale] of [
  ['public/icons/icon-192.png', 192, 0.8],
  ['public/icons/icon-512.png', 512, 0.8],
  // Keep the full artwork inside Android's central 80%-diameter safe circle.
  ['public/icons/icon-maskable-512.png', 512, 0.56],
  ['app/apple-icon.png', 180, 0.8],
]) {
  const artwork = await sharp(darkArtwork).resize(Math.round(size * scale)).png().toBuffer();
  const icon = await sharp({
    create: { width: size, height: size, channels: 4, background: '#17171a' },
  }).composite([{ input: artwork, gravity: 'centre' }]).removeAlpha().png().toBuffer();
  await writeFile(new URL(`../${path}`, import.meta.url), icon);
}

// Android masks the small notification badge to a monochrome silhouette.
// Keep only the checkmarks opaque so the badge never becomes a solid square.
const badgeArtwork = Buffer.from(source.toString().replaceAll('#008751', '#ffffff'));
const badge = await sharp({
  create: { width: 96, height: 96, channels: 4, background: '#00000000' },
}).composite([{
  input: await sharp(badgeArtwork).resize(77, 77).png().toBuffer(),
  gravity: 'centre',
}]).png().toBuffer();
await writeFile(new URL('../public/icons/notification-badge.png', import.meta.url), badge);

// Store PNG frames in the ICO container for the browser fallback as well.
const sizes = [16, 32, 48];
const frames = await Promise.all(sizes.map(size => sharp(source).resize(size, size).png().toBuffer()));
const directory = Buffer.alloc(6 + sizes.length * 16);
directory.writeUInt16LE(1, 2);
directory.writeUInt16LE(sizes.length, 4);
let offset = directory.length;
for (const [index, frame] of frames.entries()) {
  const entry = 6 + index * 16;
  directory[entry] = sizes[index];
  directory[entry + 1] = sizes[index];
  directory.writeUInt16LE(1, entry + 4);
  directory.writeUInt16LE(32, entry + 6);
  directory.writeUInt32LE(frame.length, entry + 8);
  directory.writeUInt32LE(offset, entry + 12);
  offset += frame.length;
}
await writeFile(new URL('../app/favicon.ico', import.meta.url), Buffer.concat([directory, ...frames]));
