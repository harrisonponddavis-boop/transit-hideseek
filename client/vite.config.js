import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/socket.io': { target: 'http://localhost:3001', ws: true },
      '/network': { target: 'http://localhost:3001' },
      '/cities': { target: 'http://localhost:3001' },
      '/config': { target: 'http://localhost:3001' },
    },
  },
});
