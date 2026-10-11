// Vite config helper.
import { defineConfig } from 'vite';
// React plugin.
import react from '@vitejs/plugin-react';

// Export the config.
export default defineConfig({
  // Enable React.
  plugins: [react()],
  // Dev server settings.
  server: {
    // Listen on localhost only.
    host: '127.0.0.1',
    // Proxy API and auth calls to the Express server on port 3001.
    proxy: { '/api': 'http://127.0.0.1:3001', '/auth': 'http://127.0.0.1:3001' },
  },
});
