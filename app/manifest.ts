import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: '/',
    name: 'Will Do It',
    short_name: 'Will Do It',
    description: 'A calm, visual to-do app with streams, cards, and smart recurring tasks.',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    background_color: '#eeeeef',
    theme_color: '#eeeeef',
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
