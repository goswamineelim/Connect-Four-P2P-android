import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // The shared session lazily requires this native-only fallback on mobile.
  // Exclude it from browser dependency scanning and leave it external in builds.
  optimizeDeps: { exclude: ['react-native-webrtc'] },
  build: { rollupOptions: { external: ['react-native-webrtc'] } },
  server: { fs: { allow: ['..'] } },
});
