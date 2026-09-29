const clamp = value => Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
const smooth = (value, start, end) => { const t = clamp((value-start)/(end-start)); return t*t*(3-2*t); };

/** Two source-over DOM mouth layers must retain the requested combined opacity.
 * Independent inverse alphas would expose the closed mouth during a shape blend. */
export function animeMouthLayerMix(opacity,roundness) {
  const amount=clamp(opacity),round=amount*clamp(roundness);
  return {talk:round<1?(amount-round)/(1-round):0,round};
}

/** One bounded visual mix for both renderers. Never changes articulation channels. */
export function animeEmotionMix(pose, { sleeping = false } = {}) {
  const sad = sleeping ? 0 : clamp(pose.sadAmount), downcast = sleeping ? 0 : clamp(pose.downcastAmount);
  const pout=sleeping?0:clamp(pose.poutAmount),determined=sleeping?0:clamp(pose.determinedAmount);
  const hesitant=sleeping?0:clamp(pose.hesitantAmount),sleepy=sleeping?0:clamp(pose.sleepyAmount);
  const expectant=sleeping?0:clamp(pose.expectantAmount),aggrieved=sleeping?0:clamp(pose.aggrievedAmount);
  const negative = Math.max(sad, downcast,pout,determined*.85,aggrieved,hesitant*.35);
  const smug=(sleeping?0:clamp(pose.smugAmount))*(1-negative),relief=(sleeping?0:clamp(pose.reliefAmount))*(1-negative);
  const tender=(sleeping?0:clamp(pose.tenderAmount))*(1-negative);
  // Touch happiness peaks at .62, so it too must reach the opaque smiling lids.
  // Keep shy eyeSmile (.18) below the onset to preserve its open-eye expression.
  const smilingLids = sleeping ? 0 : smooth(clamp(pose.eyeSmile), .24, .58) * (1-negative);
  const blinkLeft = sleeping ? 1 : Math.max(clamp(pose.blinkLeft), smilingLids);
  const blinkRight = sleeping ? 1 : Math.max(clamp(pose.blinkRight), smilingLids);
  const eyesOpen = 1-Math.max(blinkLeft, blinkRight);
  // Compress an opaque eye drawing for drowsiness; never leave the blink image
  // half transparent over the original eyes for a sustained expression.
  const eyeSquintLeft=Math.min(.58,smug*.23+determined*.13+relief*.10+sleepy*.44+tender*.15+hesitant*.10+aggrieved*.07);
  const eyeSquintRight=Math.min(.58,smug*.08+determined*.13+relief*.10+sleepy*.44+tender*.15+hesitant*.035+aggrieved*.07);
  const eyeSize=1+(sleeping?0:clamp(pose.surpriseAmount))*.14+expectant*.10-downcast*.13;
  return {
    sadness: clamp(Math.max(sad+downcast*.57,aggrieved*.72)), downcast,
    smug,pout,relief,determined,
    hesitant,sleepy,expectant,aggrieved,tender,
    eyeSquintLeft,eyeSquintRight,
    eyeScaleLeft:Math.max(.42,Math.min(1.18,eyeSize-eyeSquintLeft)),
    eyeScaleRight:Math.max(.42,Math.min(1.18,eyeSize-eyeSquintRight)),
    upperWarmth:clamp(relief*.7+tender*.55),
    browLeftLift:Math.max(-1,Math.min(1,smug*.65-determined*.2+hesitant*.38-sleepy*.3+expectant*.28+aggrieved*.14+tender*.10)),
    browRightLift:Math.max(-1,Math.min(1,0-smug*.12-determined*.2-hesitant*.10-sleepy*.3+expectant*.28+aggrieved*.14+tender*.10)),
    browFocus:determined*.5-aggrieved*.35-hesitant*.1,
    blinkLeft, blinkRight,
    smile: sleeping ? 0 : clamp(clamp(pose.smileAmount)+relief*.3+tender*.12)*(1-negative),
    blush: sleeping ? 0 : clamp(clamp(pose.blush)+clamp(pose.shyAmount)*.2+tender*.08),
    shy: sleeping ? 0 : clamp(pose.shyAmount),
    tears: sleeping ? 0 : Math.max(clamp(pose.tearAmount),aggrieved*.28)*(1-.75*Math.max(blinkLeft,blinkRight)),
    sparkle: sleeping ? 0 : Math.max(clamp(pose.excitedAmount)*(.55+.45*clamp(pose.voiceEnergy)),expectant*.40)*eyesOpen,
  };
}
