import http from 'node:http';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash,randomUUID} from 'node:crypto';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {build} from 'esbuild';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const args=process.argv.slice(2),command=args.shift();
function option(name,fallback){const at=args.indexOf(name);return at<0?fallback:args[at+1];}
const output=path.resolve(root,option('--output','.data/deep-fluidity-20261023/chat-baseline'));
const fixture=path.join(root,'tests/fixtures/deep-fluidity-chat');
const sha=value=>createHash('sha256').update(value).digest('hex');
const relative=value=>path.relative(root,value).replaceAll('\\','/');
if(!['build','serve'].includes(command))throw new Error('Usage: node scripts/benchmark-chat-ui.mjs build|serve [--output .data/.../chat-baseline] [--port 45329] [--label baseline]');
if(command==='build'){
  await mkdir(path.dirname(output),{recursive:true});await mkdir(output);await mkdir(path.join(output,'web'));
  const inputs=new Map(),buildId=randomUUID(),gitHead=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();
  const result=await build({absWorkingDir:root,entryPoints:[path.join(fixture,'fixture.tsx')],outdir:path.join(output,'web'),bundle:true,splitting:true,format:'esm',platform:'browser',target:'es2022',jsx:'automatic',minify:true,metafile:true,entryNames:'assets/fixture-[hash]',chunkNames:'assets/chunk-[hash]',assetNames:'assets/file-[hash]',define:{'process.env.NODE_ENV':'"production"','process.env.OPENUI_RUNTIME_TELEMETRY_ENABLED':'"0"'},plugins:[{name:'capture-frozen-inputs',setup(builder){builder.onLoad({filter:/\.(?:tsx?|jsx?|mjs|cjs|json|css|svg|png|webp|woff2?)$/},async({path:file})=>{
    const contents=await readFile(file),extension=path.extname(file),loader={'.ts':'ts','.tsx':'tsx','.js':'js','.jsx':'jsx','.mjs':'js','.cjs':'js','.json':'json','.css':'css','.svg':'file','.png':'file','.webp':'file','.woff':'file','.woff2':'file'}[extension];inputs.set(relative(file),{bytes:contents.length,sha256:sha(contents)});return{contents,loader};
  });}}]});
  const entry=Object.entries(result.metafile.outputs).find(([,value])=>value.entryPoint===relative(path.join(fixture,'fixture.tsx')));
  if(!entry)throw new Error('Fixture entry was not emitted');
  const publicName=value=>path.relative(path.join(output,'web'),path.resolve(root,value)).replaceAll('\\','/');
  const htmlSource=await readFile(path.join(fixture,'index.html'),'utf8');
  const html=htmlSource.replace('<!-- BENCH_STYLES -->',entry[1].cssBundle?`<link rel="stylesheet" href="/${publicName(entry[1].cssBundle)}">`:'').replace('<!-- BENCH_SCRIPT -->',`<script type="module" src="/${publicName(entry[0])}"></script>`);
  await writeFile(path.join(output,'web/index.html'),html);
  inputs.set(relative(path.join(fixture,'index.html')),{bytes:Buffer.byteLength(htmlSource),sha256:sha(htmlSource)});
  const sorted=Object.fromEntries([...inputs].sort(([a],[b])=>a.localeCompare(b))),sourceDigest=sha(JSON.stringify(sorted));
  const files={};for(const filename of Object.keys(result.metafile.outputs)){const absolute=path.resolve(root,filename),contents=await readFile(absolute);files[publicName(filename)]={bytes:contents.length,sha256:sha(contents)};}
  files['index.html']={bytes:Buffer.byteLength(html),sha256:sha(html)};
  const receipt={kind:'synthetic-real-react-chat-benchmark',buildId,label:option('--label',path.basename(output)),builtAt:new Date().toISOString(),gitHead,sourceDigest,dirtyPaths:execFileSync('git',['status','--short'],{cwd:root,encoding:'utf8'}).trim().split('\n').filter(Boolean),inputs:sorted,files,entry:publicName(entry[0]),renderer:'react-dom/profiling, production',output,syntheticOnly:true};
  await writeFile(path.join(output,'build-result.json'),JSON.stringify(receipt,null,2)+'\n');
  console.log(JSON.stringify({output,buildId,sourceDigest,entry:receipt.entry,sourceInputs:inputs.size,files:Object.keys(files).length,serve:`node scripts/benchmark-chat-ui.mjs serve --output "${relative(output)}" --port 45329`},null,2));
}else{
  const receipt=JSON.parse(await readFile(path.join(output,'build-result.json'),'utf8')),web=path.join(output,'web'),port=Number(option('--port','45329'));
  if(!Number.isInteger(port)||port<1024||port>65535)throw new Error('Invalid loopback port');
  for(const [filename,expected]of Object.entries(receipt.files)){const actual=await readFile(path.join(web,filename));if(actual.length!==expected.bytes||sha(actual)!==expected.sha256)throw new Error(`Frozen asset changed: ${filename}`);}
  const type={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.webp':'image/webp','.woff2':'font/woff2'};
  const server=http.createServer(async(req,res)=>{
    res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Content-Security-Policy',"default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'");
    try{
      const request=new URL(req.url,'http://127.0.0.1');
      if(req.method==='POST'&&request.pathname==='/report'){
        if(req.headers.origin!==`http://127.0.0.1:${port}`)return res.writeHead(403).end();
        let raw='';for await(const part of req){raw+=part;if(Buffer.byteLength(raw)>512000)throw new Error('Report too large');}
        const value=JSON.parse(raw);if(value.syntheticOnly!==true||typeof value.valid!=='boolean'||value.build?.buildId!==receipt.buildId)throw new Error('Not this frozen synthetic report');
        await mkdir(path.join(output,'runs'),{recursive:true});const filename=`run-${Date.now()}-${randomUUID()}.json`;await writeFile(path.join(output,'runs',filename),JSON.stringify(value,null,2)+'\n',{flag:'wx'});res.writeHead(201,{'Content-Type':type['.json']});return res.end(JSON.stringify({filename:`runs/${filename}`}));
      }
      if(req.method!=='GET'&&req.method!=='HEAD')return res.writeHead(405).end();
      const name=request.pathname==='/'?'index.html':decodeURIComponent(request.pathname.slice(1));
      let body;if(name==='build-result.json')body=Buffer.from(JSON.stringify({buildId:receipt.buildId,gitHead:receipt.gitHead,sourceDigest:receipt.sourceDigest,label:receipt.label,builtAt:receipt.builtAt}));
      else{if(!Object.hasOwn(receipt.files,name))return res.writeHead(404).end();body=await readFile(path.join(web,name));}
      res.writeHead(200,{'Content-Type':type[path.extname(name)]||'application/octet-stream','Content-Length':body.length});res.end(req.method==='HEAD'?undefined:body);
    }catch(error){if(!res.headersSent)res.writeHead(400,{'Content-Type':type['.json']});res.end(JSON.stringify({error:String(error)}));}
  });
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});
  console.log(JSON.stringify({port,url:`http://127.0.0.1:${port}/`,buildId:receipt.buildId,output,stop:'close followed by newline on this foreground stdin'}));
  let closing=false,input='';const close=()=>{if(closing)return;closing=true;server.closeAllConnections();server.close(()=>process.exit(0));};
  process.stdin.setEncoding('utf8');process.stdin.on('data',value=>{input+=value;for(let at;(at=input.indexOf('\n'))>=0;){const line=input.slice(0,at).trim();input=input.slice(at+1);if(line==='close')close();}});process.stdin.on('end',close);process.stdin.resume();process.once('SIGINT',close);process.once('SIGTERM',close);
}
