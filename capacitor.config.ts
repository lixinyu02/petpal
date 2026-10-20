import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.petpal.app',
  appName: '小伴 PetPal',
  webDir: process.env.PETPAL_ANDROID_WEB_DIR || 'dist',
  server: { androidScheme: 'https' },
  // MainActivity owns system-bar, cutout and IME insets together. Do not stack
  // Capacitor's system-bars-only listener on top of the same WebView.
  android: { allowMixedContent: false, adjustMarginsForEdgeToEdge: 'disable' },
};

export default config;
