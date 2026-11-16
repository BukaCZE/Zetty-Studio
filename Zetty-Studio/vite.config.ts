import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({
  plugins: [
    react(),
    {
      name: 'development-csp',
      transformIndexHtml: {
        order: 'pre',
        handler(html, context) {
          return context.server
            ? html.replace("script-src 'self';", "script-src 'self' 'unsafe-inline';")
            : html;
        },
      },
    },
  ],
  base: './',
  server: { port: 5173, strictPort: true },
});
