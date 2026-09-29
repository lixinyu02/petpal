const signed=value=>Number.isFinite(value)?Math.max(-1,Math.min(1,value)):0;
const unit=value=>Number.isFinite(value)?Math.max(0,Math.min(1,value)):0;
const gestures=new Set(['none','nod','shake','tilt','shy','bounce','recoil','settle','leanIn','shrug','bow','peek','sway','doze']);
const smooth=(a,b,value)=>{const t=unit((value-a)/(b-a));return t*t*(3-2*t);};

/** Connected upper-sleeve patches. Face, neck, central collar and hands stay
 * fixed; the same continuous mesh carries the cardigan rather than overlays. */
export function sampleAnimeShoulderWeight(x,y) {
  if(!Number.isFinite(x)||!Number.isFinite(y)||x<0||x>1||y<0||y>1)return 0;
  const patch=(cx,cy)=>1-smooth(.25,1,Math.hypot((x-cx)/.19,(y-cy)/.14));
  const side=smooth(.12,.20,Math.abs(x-.51));
  return Math.max(patch(.24,.48),patch(.78,.485))*side*smooth(.40,.445,y);
}

/** Percent of portrait height, positive down. Preserve small voice motion while
 * making the controller's single nod readable at phone portrait sizes. */
export function animeHeadNodOffset(value,{sleeping=false,reducedMotion=false,hidden=false}={}) {
  if(sleeping||reducedMotion||hidden)return 0;
  const nod=signed(value),t=unit((Math.abs(nod)-.12)/.18);
  return nod*(.014/3*100+t*t*(3-2*t)*1.6);
}

/** Rigid portrait motion keeps neck, hair and face together in both renderers.
 * Offsets are percentages of the portrait, positive x right / positive y down.
 */
export function animePoseTransform(pose,{sleeping=false,reducedMotion=false,hidden=false}={}) {
  if(sleeping||reducedMotion||hidden)return {gesture:'none',progress:0,xPercent:0,yPercent:0,rotationDegrees:0,scale:1,shoulderYPercent:0};
  const lean=signed(pose.bodyLean),lift=signed(pose.bodyLift),turn=signed(pose.bodyTurn),shake=signed(pose.headShake);
  return {
    gesture:gestures.has(pose.gesture)?pose.gesture:'none',progress:unit(pose.gestureProgress),
    xPercent:turn*2.8+shake*.65,
    yPercent:-lift*2.4+lean*.65,
    rotationDegrees:turn*1.7+shake*.55,
    scale:1+lean*.028,
    shoulderYPercent:0-unit(pose.shoulderLift)*.9,
  };
}
