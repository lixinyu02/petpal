const clamp = value => Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
const smooth = (value, start, end) => { const t = clamp((value-start)/(end-start)); return t*t*(3-2*t); };

/** One bounded visual mix for both renderers. Never changes articulation channels. */
export function animeEmotionMix(pose, { sleeping = false } = {}) {
  const sad = sleeping ? 0 : clamp(pose.sadAmount), downcast = sleeping ? 0 : clamp(pose.downcastAmount);
  const negative = Math.max(sad, downcast);
  // Crossfade all the way into the drawn smiling eyelids instead of keeping two
  // translucent eye drawings visible throughout a happy sentence.
  const smilingLids = sleeping ? 0 : smooth(clamp(pose.eyeSmile), .24, .78) * (1-negative);
  const blinkLeft = sleeping ? 1 : Math.max(clamp(pose.blinkLeft), smilingLids);
  const blinkRight = sleeping ? 1 : Math.max(clamp(pose.blinkRight), smilingLids);
  const eyesOpen = 1-Math.max(blinkLeft, blinkRight);
  return {
    sadness: clamp(sad + downcast*.57), downcast,
    blinkLeft, blinkRight,
    smile: sleeping ? 0 : clamp(pose.smileAmount)*(1-negative),
    blush: sleeping ? 0 : clamp(clamp(pose.blush)+clamp(pose.shyAmount)*.2),
    shy: sleeping ? 0 : clamp(pose.shyAmount),
    tears: sleeping ? 0 : clamp(pose.tearAmount)*(1-.75*Math.max(blinkLeft,blinkRight)),
    sparkle: sleeping ? 0 : clamp(pose.excitedAmount)*(.55+.45*clamp(pose.voiceEnergy))*eyesOpen,
  };
}
