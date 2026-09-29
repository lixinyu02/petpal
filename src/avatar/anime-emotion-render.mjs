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
  const negative = Math.max(sad, downcast,pout,determined*.85);
  const smug=(sleeping?0:clamp(pose.smugAmount))*(1-negative),relief=(sleeping?0:clamp(pose.reliefAmount))*(1-negative);
  // Touch happiness peaks at .62, so it too must reach the opaque smiling lids.
  // Keep shy eyeSmile (.18) below the onset to preserve its open-eye expression.
  const smilingLids = sleeping ? 0 : smooth(clamp(pose.eyeSmile), .24, .58) * (1-negative);
  const blinkLeft = sleeping ? 1 : Math.max(clamp(pose.blinkLeft), smilingLids);
  const blinkRight = sleeping ? 1 : Math.max(clamp(pose.blinkRight), smilingLids);
  const eyesOpen = 1-Math.max(blinkLeft, blinkRight);
  return {
    sadness: clamp(sad + downcast*.57), downcast,
    smug,pout,relief,determined,
    // Slightly narrowed drawn eyes remain opaque, avoiding ghosted eyelid overlays.
    eyeSquintLeft:smug*.23+determined*.13+relief*.10,
    eyeSquintRight:smug*.08+determined*.13+relief*.10,
    browLeftLift:smug*.65-determined*.2,
    browRightLift:0-smug*.12-determined*.2,
    browFocus:determined*.5,
    blinkLeft, blinkRight,
    smile: sleeping ? 0 : clamp(clamp(pose.smileAmount)+relief*.3)*(1-negative),
    blush: sleeping ? 0 : clamp(clamp(pose.blush)+clamp(pose.shyAmount)*.2),
    shy: sleeping ? 0 : clamp(pose.shyAmount),
    tears: sleeping ? 0 : clamp(pose.tearAmount)*(1-.75*Math.max(blinkLeft,blinkRight)),
    sparkle: sleeping ? 0 : clamp(pose.excitedAmount)*(.55+.45*clamp(pose.voiceEnergy))*eyesOpen,
  };
}
