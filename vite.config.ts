import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync } from 'node:fs';
const packageVersion = JSON.parse(readFileSync(new URL('./package.json',import.meta.url),'utf8')).version;
const version = process.env.PETPAL_ANDROID_VERSION || packageVersion;
if (!/^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/.test(version)) throw new Error('Invalid client version');
const versionJson = JSON.stringify({version});
export default defineConfig({
  define: { __PETPAL_VERSION__: JSON.stringify(version) },
  plugins: [react(), {
    name:'petpal-client-version',
    generateBundle(){this.emitFile({type:'asset',fileName:'version.json',source:versionJson});},
    configureServer(server){server.middlewares.use('/version.json',(_req,res)=>{res.setHeader('Content-Type','application/json');res.setHeader('Cache-Control','no-store');res.end(versionJson);});},
  }],
  server: { port: 5173, strictPort: true, proxy: { '/api': 'http://127.0.0.1:4318' } },
  // The service keeps published downloads here. A build must never remove them.
  build: { outDir: 'dist', emptyOutDir: false },
});
