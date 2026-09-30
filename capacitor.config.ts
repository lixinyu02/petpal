import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.petpal.app',
  appName: '小伴 PetPal',
  webDir: process.env.PETPAL_ANDROID_WEB_DIR || 'dist',
  server: { androidScheme: 'https' },
  android: { allowMixedContent: false },
};

export default config;
