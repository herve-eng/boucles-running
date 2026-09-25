import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// L'app sera publiée sur https://herve-eng.github.io/boucles-running/
export default defineConfig({
  base: '/boucles-running/',
  server: { host: true, port: 5173 }, // host : accessible depuis le téléphone sur le même wifi
  preview: { host: true, port: 4173 },
  worker: { format: 'es' }, // worker de MapLibre chargé comme module
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'apple-touch-icon-180x180.png'],
      manifest: {
        name: 'Boucles – parcours de course',
        short_name: 'Boucles',
        description: 'Trouve une boucle de course à pied de la distance voulue, par les parcs et les bords de l’eau.',
        lang: 'fr',
        theme_color: '#15201b',
        background_color: '#faf8f3',
        display: 'standalone',
        orientation: 'portrait',
        icons: [
          { src: 'pwa-64x64.png', sizes: '64x64', type: 'image/png' },
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          { src: 'maskable-icon-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // L'interface fonctionne hors connexion ; les données (carte, itinéraires) demandent du réseau.
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
      },
    }),
  ],
  test: { include: ['src/**/*.test.{js,ts}'] },
});
