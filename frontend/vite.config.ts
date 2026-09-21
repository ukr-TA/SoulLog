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
})
