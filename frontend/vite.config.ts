import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  // Tailwind is compiled here, at build time.
  //
  // It used to be pulled into index.html as
  // <script src="https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4">,
  // which is the browser JIT build. That is documented as development-only,
  // and it had two consequences worth avoiding in a shipped product:
  // every page load compiled the stylesheet in the browser, and if
  // jsdelivr was unreachable — an offline device, a restricted network, a
  // CDN incident — every Tailwind class in the app silently stopped
  // applying and the UI fell apart. The Capacitor build made that worse,
  // since a mobile app has no business requiring a CDN to render.
  plugins: [react(), tailwindcss()],

  // Development only. The dev server forwards the API, uploaded media and
  // WebSockets to Django, so a phone can use SoulLog through this one
  // address — on the same Wi-Fi, or through a temporary tunnel (see
  // scripts/dev-phone.sh). The Host header is kept (no changeOrigin) so the
  // media links Django builds point back at the address the phone used.
  server: {
    proxy: {
      '/api': { target: 'http://127.0.0.1:8000' },
      '/media': { target: 'http://127.0.0.1:8000' },
      '/ws': { target: 'ws://127.0.0.1:8000', ws: true },
    },
    // Tunnel addresses from `cloudflared tunnel --url` (trycloudflare.com).
    allowedHosts: ['.trycloudflare.com'],
  },
})
