import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const port = process.env.PORT || '3000';

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        // Split the ~140KB React runtime into its own content-hashed chunk.
        // It survives every app-code deploy in the browser's immutable cache,
        // so repeat visits only download the (small) app chunk.
        manualChunks: {
          vendor: ['react', 'react-dom'],
        },
      },
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: `http://localhost:${port}`,
        changeOrigin: true,
      },
    },
  },
});
