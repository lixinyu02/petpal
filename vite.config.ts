import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync } from 'node:fs';
const {version} = JSON.parse(readFileSync(new URL('./package.json',import.meta.url),'utf8'));
const versionJson = JSON.stringify({version});
export default defineConfig({
  define: { __PETPAL_VERSION__: JSON.stringify(version) },
  plugins: [react(), {
    name:'petpal-client-version',
    generateBundle(){this.emitFile({type:'asset',fileName:'version.json',source:versionJson});},
    configureServer(server){server.middlewares.use('/version.json',(_req,res)=>{res.setHeader('Content-Type','application/json');res.setHeader('Cache-Control','no-store');res.end(versionJson);});},
  }],
  server: { port: 5173, strictPort: true, proxy: { '/api': 'http://127.0.0.1:4318' } },
  build: { outDir: 'dist' },
});
