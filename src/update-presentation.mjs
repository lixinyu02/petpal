export function validVersion(value) {return typeof value==='string' && /^(0|[1-9]\d{0,8})\.(0|[1-9]\d{0,8})\.(0|[1-9]\d{0,8})$/.test(value);}
export function webUpdateState(current, deployed, release) {
  if(validVersion(current)&&validVersion(deployed)&&current!==deployed)return 'reload';
  if(release)return 'waiting-deploy';
  return 'current';
}
export function updateProgress(progress) {
  if(!progress||!Number.isFinite(progress.received)||!Number.isFinite(progress.total)||progress.total<=0)return null;
  return Math.max(0,Math.min(100,Math.floor(progress.received/progress.total*100)));
}
