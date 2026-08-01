import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// This project's build output is intentionally written to ../ (webapp/),
// so Express's existing `express.static(webapp)` + redirect('/webapp/index.html')
// keep serving the app with zero changes to api-server.
export default defineConfig({
  plugins: [react()],
  base: '/webapp/',
  build: {
    outDir: '../',
    emptyOutDir: false,
  },
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:8080',
        changeOrigin: true,
      },
      '/ws': {
        target: 'ws://localhost:8080',
        ws: true,
      },
    },
  },
});
