import test from 'node:test';
import assert from 'node:assert/strict';
import { MusicController, validateMusicCommand, parseMprisNames } from '../server/music.mjs';

test('music command accepts fixed players/actions and rejects arbitrary executables or fields', () => {
  assert.deepEqual(validateMusicCommand({player:'qqmusic',action:'pause'}),{player:'qqmusic',action:'pause'});
  for(const value of [{player:'spotify',action:'pause'},{player:'netease',action:'shell'},{player:'qqmusic',action:'open',path:'cmd.exe'},null,[]]) assert.throws(()=>validateMusicCommand(value));
});
test('MPRIS names are deduplicated without accepting arbitrary destinations',()=>{
  assert.deepEqual(parseMprisNames("(['org.mpris.MediaPlayer2.qqmusic', 'org.mpris.MediaPlayer2.qqmusic', 'org.freedesktop.DBus'],)"),['org.mpris.MediaPlayer2.qqmusic']);
});
function linux(t,{duplicate=false,capable=true}={}) {
  const calls=[];
  const run=async (file,args)=>{
    calls.push({file,args}); assert.equal(file,'gdbus');
    if(args.includes('org.freedesktop.DBus.ListNames')) return `(['org.mpris.MediaPlayer2.qqmusic'${duplicate?", 'org.mpris.MediaPlayer2.qqmusic2'":''}, 'org.mpris.MediaPlayer2.spotify'],)`;
    const dest=args[args.indexOf('--dest')+1];
    if(args.at(-1)==='Identity')return dest.includes('spotify')?"(<'Spotify'>,)":"(<'QQMusic'>,)";
    if(args.at(-1)==='DesktopEntry')return "(<'qqmusic'>,)";
    if(args.at(-1)==='PlaybackStatus')return "(<'Paused'>,)";
    if(args.includes('org.freedesktop.DBus.Properties.Get'))return capable?'(<true>,)':'(<false>,)';
    return '()';
  };
  // Do not let unrelated Spotify match via its DesktopEntry in the fixture.
  const wrapped=async (file,args,opts)=>args[args.indexOf('--dest')+1]?.includes('spotify')&&args.at(-1)==='DesktopEntry'?"(<'spotify'>,)":run(file,args,opts);
  return {controller:new MusicController({platform:'linux',run:wrapped,find:async()=>'/usr/bin/qqmusic'}),calls};
}
test('Linux routes a media action only to the identified music session with capability',async t=>{
  const {controller,calls}=linux(t); const result=await controller.execute({player:'qqmusic',action:'pause'});
  assert.equal(result.ok,true); const action=calls.find(c=>c.args.includes('org.mpris.MediaPlayer2.Player.Pause'));
  assert.equal(action.args[action.args.indexOf('--dest')+1],'org.mpris.MediaPlayer2.qqmusic');
});
test('Linux refuses ambiguous sessions and unsupported capabilities before mutation',async t=>{
  for(const options of [{duplicate:true},{capable:false}]){const {controller,calls}=linux(t,options);await assert.rejects(controller.execute({player:'qqmusic',action:'next'}));assert.equal(calls.some(c=>c.args.includes('org.mpris.MediaPlayer2.Player.Next')),false);}
});
test('status is read-only and unavailable sessions are distinguished from installation',async t=>{
  const controller=new MusicController({platform:'linux',find:async()=>'/usr/bin/qqmusic',run:async()=>{throw new Error('no session');}});
  const state=await controller.status(); assert.equal(state.players[0].installed,true);assert.equal(state.players[0].session,false);assert.match(state.message,/MPRIS/);
});
test('Windows uses fixed helper argv; abort prevents dispatch',async()=>{
  let called=0;const controller=new MusicController({platform:'win32',env:{SystemRoot:'C:\\Windows'},run:async(file,args)=>{called++;assert.ok(file.endsWith('powershell.exe'));assert.ok(args.includes('-File'));assert.deepEqual(args.slice(-4),['-Action','pause','-Player','netease']);return '{"ok":true}';}});
  assert.equal((await controller.execute({player:'netease',action:'pause'})).ok,true);
  await assert.rejects(controller.execute({player:'netease',action:'pause'},{signal:AbortSignal.abort()}),{name:'AbortError'});assert.equal(called,1);
});
test('unrelated NetEase session is not classified as CloudMusic, and cancellation propagates',async()=>{
  const controller=new MusicController({platform:'linux',find:async()=>null,run:async(_file,args)=>args.includes('org.freedesktop.DBus.ListNames')?"(['org.mpris.MediaPlayer2.neteaseother'],)":"(<'NetEase Other App'>,)"});
  assert.deepEqual(await controller.linuxSessions(),[]);
  const cancelled=new MusicController({platform:'linux',run:async(_file,args)=>{if(args.includes('org.freedesktop.DBus.ListNames'))return "(['org.mpris.MediaPlayer2.qqmusic'],)";throw Object.assign(new Error('stop'),{name:'AbortError'});}});
  await assert.rejects(cancelled.linuxSessions(),{name:'AbortError'});
});
