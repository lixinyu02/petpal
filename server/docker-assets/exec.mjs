import { spawn } from 'node:child_process';
import { writeFileSync, unlinkSync } from 'node:fs';
const [identity, ...args] = process.argv.slice(2);
if (!/^[a-f0-9-]{36}$/.test(identity) || args[0] !== 'app-server') process.exit(2);
const file = `/runtime/petpal-launch-${identity}.pid`;
// Native shell tools can create a new process group. A Linux subreaper retains
// ownership when an interrupted shell exits before its tool descendants.
const supervisor = String.raw`
import ctypes,json,os,signal,subprocess,sys,time
if ctypes.CDLL(None,use_errno=True).prctl(36,1,0,0,0)!=0:sys.exit(70)
stopping=False
def request_stop(*_):
 global stopping
 stopping=True
signal.signal(signal.SIGTERM,request_stop)
signal.signal(signal.SIGINT,request_stop)
identity=sys.argv[1]
child=subprocess.Popen(['codex',*sys.argv[2:]],start_new_session=True)
def descendants():
 parents={}
 for name in os.listdir('/proc'):
  if not name.isdigit():continue
  try:
   value=open('/proc/'+name+'/stat').read();parents[int(name)]=int(value[value.rfind(')')+2:].split()[1])
  except (FileNotFoundError,ProcessLookupError,PermissionError,ValueError):pass
 owned={os.getpid()}
 while True:
  more={pid for pid,parent in parents.items() if parent in owned}
  if more.issubset(owned):return owned-{os.getpid()}
  owned.update(more)
def reap():
 while True:
  try:
   pid,_=os.waitpid(-1,os.WNOHANG)
   if not pid:return
  except ChildProcessError:return
while child.poll() is None and not stopping:time.sleep(.025)
deadline=time.monotonic()+5
while True:
 reap();owned=descendants()
 if not owned:break
 if time.monotonic()>deadline:sys.exit(71)
 for pid in owned:
  try:os.kill(pid,signal.SIGKILL)
  except ProcessLookupError:pass
 time.sleep(.025)
receipt='/runtime/petpal-cleanup-'+identity+'.json'
fd=os.open(receipt,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
with os.fdopen(fd,'w') as out:json.dump({'launchId':identity,'cleanupConfirmed':True},out)
sys.exit(0 if stopping else (child.returncode or 0))
`;
const child = spawn('python3', ['-u', '-c', supervisor, identity, ...args], { detached: true, stdio: ['pipe', 'pipe', 'pipe'] });
let ending = false;
const stop = () => { if (ending) return; ending = true; try { process.kill(child.pid, 'SIGTERM'); } catch {} };
if (child.pid) writeFileSync(file, String(child.pid), { mode: 0o600, flag: 'wx' });
process.stdin.pipe(child.stdin); child.stdout.pipe(process.stdout); child.stderr.pipe(process.stderr);
child.stdin.on('error', stop); process.stdin.on('end', stop); process.on('SIGTERM', stop); process.on('SIGINT', stop);
child.on('error', () => process.exit(1));
child.on('close', code => { try { unlinkSync(file); } catch {} process.exit(code ?? 1); });
