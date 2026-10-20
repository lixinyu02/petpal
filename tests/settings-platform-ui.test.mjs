import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';

const source=ts.transpileModule(await readFile(new URL('../src/App.tsx',import.meta.url),'utf8'),{fileName:'App.tsx',compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText+'\nexports.fixtureSettingsView=SettingsView;';
const nodes=tree=>Array.isArray(tree)?tree.flatMap(nodes):!tree||typeof tree!=='object'?[]:[tree,...nodes(tree.props?.children)];
const text=tree=>Array.isArray(tree)?tree.map(text).join(''):tree==null||typeof tree==='boolean'?'':typeof tree!=='object'?String(tree):text(tree.props?.children);

/** Call the actual SettingsView function, keeping child UIs lazy. No native or
 * network mutation is allowed; the resulting child slots are the behaviour. */
function settings({platform='android',native=platform==='android',desktop=false,tab='desktop',admin=true,official=false}={}){
 let index=0;const hooks=[],effects=[];
 const react={useState(value){const at=index++;hooks[at]??={value:typeof value==='function'?value():value};return [hooks[at].value,next=>{hooks[at].value=typeof next==='function'?next(hooks[at].value):next;}];},useRef:()=>({current:null}),useEffect(effect){effects.push(effect);},useCallback:value=>value,useMemo:fn=>fn(),useSyncExternalStore:(_subscribe,snapshot)=>snapshot(),lazy:loader=>({fixtureLazy:true,loader}),Suspense:Symbol('Suspense')};
 const calls=[],window=new EventTarget();window.navigator={userAgent:'Android HONOR Magic7'};if(desktop)window.petpal={runtime:{platform:'win32'},officialAccount:{}};
 const api={getIdentity:()=>({instanceId:'settings-server',userId:'settings-user'}),getConnection:()=>({url:'https://fixture.invalid'}),getSessionEpoch:()=>1,api:()=>{calls.push('api');throw Error('No network calls permitted');}};
 const modules={react,'react/jsx-runtime':{jsx:(type,props)=>({type,props}),jsxs:(type,props)=>({type,props})},'lucide-react':new Proxy({},{get:(_target,name)=>Symbol.for(name)}),'@capacitor/core':{Capacitor:{isNativePlatform:()=>native,getPlatform:()=>platform,isPluginAvailable:name=>official&&name==='PetOfficialAccount'}},'./api':api,'./platform/music-mcp':{nativeMusicMcp:()=>undefined},'./platform/computer-use':{nativeComputerUse:()=>undefined},'./platform/ui-motion.ts':{useUiEntrance:()=>({current:null})}};
 const module={exports:{}};vm.runInNewContext(source,{module,exports:module.exports,window,URLSearchParams,Intl,require:name=>{if(name.endsWith('.css'))return {};return modules[name]||{__esModule:true,default:Symbol(name)};}});
 const state={instanceId:'settings-server',user:{id:'settings-user',isAdmin:admin,isOwner:false,canUseCodex:true,agentAccess:'full'},settings:{petName:'小伴',persona:'保持陪伴',defaultProviderId:'official'},providers:[{id:'official',name:'ChatGPT',model:'official',source:'official-account',supportsImages:true}]};
 const tree=module.exports.fixtureSettingsView({state,connected:true,refresh:async()=>state,notice(){},connect(){},initialTab:tab,hasDraft:false,onDownload(){},onPrepareBrowser(){},prepareBrowserDisabled:false});
 const containsLazy=name=>nodes(tree).some(node=>node.type?.fixtureLazy&&node.type.loader.toString().includes(`./${name}`));
 return {tree,text:()=>text(tree),containsLazy,calls};
}

test('Android device settings hide local PC central-server controls and preserve Android proxy plus client settings',()=>{
 const f=settings();assert.equal(f.containsLazy('CentralServerSettings'),false);assert.equal(f.containsLazy('AndroidAppProxySettings'),true);assert.equal(f.containsLazy('AppProxySettings'),false);assert.equal(f.containsLazy('ServerProxyProfilesSettings'),true);assert.equal(f.containsLazy('ClientBehaviorSettings'),true);assert.match(f.text(),/Android 客户端/);assert.match(f.text(),/远程执行电脑/);assert.doesNotMatch(f.text(),/Windows|Ubuntu|让这台电脑保存/);assert.equal(f.calls.length,0);
});

test('Android keeps official account login and administrator remote Agent and MCP management',()=>{
 const models=settings({tab:'models',official:true});assert.equal(models.containsLazy('OfficialAccountSettings'),true);assert.match(models.text(),/此手机上的 ChatGPT 官方账号/);
 const assistant=settings({tab:'assistant'});for(const name of ['DesktopAssistantSettings','MusicMcpSettings','ComputerUseSettings','OpenCliSettings'])assert.equal(assistant.containsLazy(name),true,name);assert.equal(assistant.calls.length,0);
});

test('a browser user-agent cannot impersonate native Android device settings',()=>{
 const f=settings({platform:'web',native:false});assert.equal(f.containsLazy('AndroidAppProxySettings'),false);assert.equal(f.containsLazy('AppProxySettings'),true);assert.equal(f.containsLazy('CentralServerSettings'),true);assert.match(f.text(),/Web 浏览器/);assert.doesNotMatch(f.text(),/Android 客户端|Magic7|PTP-AN00/);
});

test('desktop settings retain their native central-server and desktop proxy entry points',()=>{
 for(const platform of ['win32','linux']){const f=settings({platform,native:false,desktop:true});assert.equal(f.containsLazy('CentralServerSettings'),true);assert.equal(f.containsLazy('AppProxySettings'),true);assert.equal(f.containsLazy('AndroidAppProxySettings'),false);assert.match(f.text(),/桌面客户端/);}
});
