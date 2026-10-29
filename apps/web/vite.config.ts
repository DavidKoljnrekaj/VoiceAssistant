// Vite: React, Tailwind 4 and the PWA plugin. The service worker precaches the app shell only and
// answers the API and Supabase origins from the network, never from a cache (.claude/rules/web.md).
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

/** The origin of a URL from the env, or null when unset or malformed (the app validates at boot). */
function originOf(value: string | undefined): string | null {
  if (!value) return null
  try {
    return new URL(value).origin
  } catch {
    return null
  }
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_')
  const networkOnlyOrigins = [originOf(env.VITE_API_URL), originOf(env.VITE_SUPABASE_URL)].filter(
    (o): o is string => o !== null,
  )

  return {
    plugins: [
      react(),
      tailwindcss(),
      VitePWA({
        registerType: 'autoUpdate',
        includeAssets: ['icons/icon-192.png', 'icons/icon-512.png'],
        manifest: {
          name: 'Asistent',
          short_name: 'Asistent',
          description: 'AI asistent tvrtke',
          lang: 'hr',
          display: 'standalone',
          start_url: '/',
          scope: '/',
          theme_color: '#1d4ed8',
          background_color: '#ffffff',
          icons: [
            { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
            { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
            { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          ],
        },
        workbox: {
          // The app shell: built assets and the icons. Nothing else is ever stored.
          globPatterns: ['**/*.{js,css,html,png,svg,ico,webmanifest}'],
          navigateFallback: '/index.html',
          // Streams and auth answers must never come from a cache; NetworkOnly makes that explicit
          // even though these origins are not precached either.
          runtimeCaching: networkOnlyOrigins.map((origin) => ({
            urlPattern: ({ url }: { url: URL }) => url.origin === origin,
            handler: 'NetworkOnly' as const,
          })),
        },
      }),
    ],
    build: {
      rollupOptions: {
        output: {
          // Stable, independently cacheable vendor chunks (ported from Landmark's vite.config.ts).
          manualChunks(id: string) {
            if (id.includes('/locales/')) return 'i18n-locales'
            if (!id.includes('node_modules')) return undefined
            if (/node_modules\/(react|react-dom|react-router|react-router-dom|scheduler)\//.test(id)) {
              return 'vendor-react'
            }
            if (id.includes('@supabase')) return 'vendor-supabase'
            if (id.includes('livekit-client')) return 'vendor-livekit'
            if (id.includes('lucide-react')) return 'vendor-icons'
            if (id.includes('i18next')) return 'vendor-i18n'
            if (
              /(react-markdown|remark|rehype|micromark|mdast|hast|unist|vfile|property-information|decode-named-character-reference|character-entities|comma-separated-tokens|space-separated-tokens|trim-lines|trough|bail|is-plain-obj|zwitch|html-void-elements|ccount|escape-string-regexp|markdown-table|longest-streak|devlop)/.test(
                id,
              )
            ) {
              return 'vendor-markdown'
            }
            return undefined
          },
        },
      },
      chunkSizeWarningLimit: 600,
    },
    server: { port: 5173, strictPort: true },
  }
})
