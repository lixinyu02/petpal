const finite = value => Number.isFinite(value) ? value : 0;
const clamp = (value, low = -1, high = 1) => Math.min(high, Math.max(low, finite(value)));
const unit = value => clamp(value, 0, 1);

/** Renderer-independent intent. This is parameter control, not a fabricated MOC. */
export function cubismParameterTargets(pose = {}, follow = {}, { sleeping = false, hidden = false, reducedMotion = false, nativeMotion = '', nativeParameters, nativeReactionParameters, supportedParameters, deformationProfile = 'standard' } = {}) {
  const still = sleeping || hidden || reducedMotion;
  const own = new Set(nativeParameters || []);
  // Non-idle authored angles include outgoing motions until their fade ends.
  // Pointer follow must not add a second turn to those same joints.
  const exclusive = new Set(nativeReactionParameters || []);
  const reactionOwns = name => nativeMotion !== '' && nativeMotion !== 'Idle' && own.has(name);
  const blinkL = sleeping ? 1 : unit(pose.blinkLeft);
  const blinkR = sleeping ? 1 : unit(pose.blinkRight);
  const smile = unit(pose.smileAmount), sad = unit(Math.max(finite(pose.sadAmount), finite(pose.downcastAmount)));
  const warm = unit(pose.warmAmount), pout = unit(pose.poutAmount);
  const referenceLayered = deformationProfile === 'reference-layered';
  const referenceFeatures = deformationProfile === 'reference-features';
  const referencePortrait = referenceLayered || referenceFeatures;
  // Only explicitly discovered, real channels enable the newer portrait's
  // expression artwork. Older portraits keep their original three-patch map;
  // similarly named parameters on imported models retain authored ownership.
  const hasPortraitPatch = name => referenceLayered && supportedParameters?.includes(name) === true;
  const shyPatch = hasPortraitPatch('ParamShy'), surprisePatch = hasPortraitPatch('ParamSurprise'), relaxedPatch = hasPortraitPatch('ParamRelaxed');
  const discreteFace = shyPatch || surprisePatch || relaxedPatch;
  const patchWarm = referenceLayered ? Math.max(warm, relaxedPatch ? 0 : unit(pose.reliefAmount) * .45, relaxedPatch ? 0 : unit(pose.tenderAmount) * .5, shyPatch ? 0 : unit(pose.shyAmount) * .28, smile * .3, unit(pose.smugAmount) * .2) : warm;
  const patchSad = referenceLayered ? Math.max(sad, unit(pose.concernAmount) * .24, unit(pose.aggrievedAmount) * .42, unit(pose.hesitantAmount) * .14) : sad;
  const patchIntents = {
    ParamWarm: patchWarm, ParamSad: patchSad, ParamPout: pout,
    ParamShy: shyPatch ? unit(pose.shyAmount) : 0,
    ParamSurprise: surprisePatch ? unit(pose.surpriseAmount) : 0,
    ParamRelaxed: relaxedPatch ? Math.max(unit(pose.reliefAmount), unit(pose.tenderAmount), unit(pose.sleepyAmount)) : 0,
  };
  let dominantPatch = '', dominantAmount = 0;
  for (const [name, amount] of Object.entries(patchIntents)) {
    if (supportedParameters && !supportedParameters.includes(name) || amount <= dominantAmount) continue;
    dominantPatch = name; dominantAmount = amount;
  }
  const faceAmount = name => {
    // The split-feature portrait has no whole-face emotion artwork. Its
    // expression is carried by the real brow, lid and iris geometry below.
    if (referenceFeatures) return 0;
    if (sleeping || hidden) return 0;
    if (!referenceLayered) return patchIntents[name];
    if (dominantPatch !== name) return 0;
    // Swapping opaque local face art at partial alpha duplicates the neutral
    // pupils/brows beneath it. Intents remain smoothed, but V10 displays one
    // complete face once it is deliberate; tiny residuals return to neutral.
    return discreteFace ? dominantAmount > .08 ? 1 : 0 : dominantAmount;
  };
  const quiet = sleeping || hidden || !pose.speaking;
  // Reuse already energy-gated, smoothed articulation. Reference-layered rigs
  // gate the A base patch fully on; O then covers A in its authored draw order.
  // The separate OpenY parameter controls only the authored local lip geometry.
  // Raw voiceEnergy must never reopen a quiet mouth or leave a ghosted base lip.
  const mouthOpen = unit(pose.mouthOpen);
  const patchMouth = quiet || mouthOpen <= .04 || pose.mouthShape === 'M' || pose.mouthShape === 'rest' ? 0 : mouthOpen;
  const patchAmount = referencePortrait ? patchMouth > 0 ? 1 : 0 : patchMouth;
  const mouthForm = quiet ? smile * .7 - sad * .35 : pose.mouthShape === 'O' ? -.65 : pose.mouthShape === 'E' ? .25 : 0;
  // V10's relaxed/other faces already paint their own eyelid shapes. There is
  // no continuous lid geometry: narrowing Open would instead fade the old
  // neutral blink bitmap over those eyes. Only an actual blink closes them.
  const eyelid = referenceFeatures
    ? clamp(1 - unit(pose.eyeSmile) * .2 - unit(pose.sleepyAmount) * .42 - sad * .12
      - unit(pose.shyAmount) * .07 - unit(pose.concernAmount) * .04
      - unit(pose.tenderAmount) * .06 - unit(pose.reliefAmount) * .08, .26, 1)
    : discreteFace ? 1 : 1 - unit(pose.eyeSmile) * .15 - unit(pose.sleepyAmount) * .38 - sad * .12;
  // The bundled rig has eyebrow height, but no eyebrow angle. A small height
  // difference keeps its asymmetric cues visible without a virtual parameter.
  const browDifference = supportedParameters && !supportedParameters.includes('ParamBrowLAngle') && !supportedParameters.includes('ParamBrowRAngle') ? clamp(pose.browTilt) * .12 : 0;
  return {
    ParamAngleX: still || exclusive.has('ParamAngleX') ? 0 : clamp(follow.headX) * 12 + (nativeMotion === 'Shake' || reactionOwns('ParamAngleX') ? 0 : clamp(pose.headShake) * 3),
    ParamAngleY: still || exclusive.has('ParamAngleY') ? 0 : clamp(follow.headY) * 9 - (nativeMotion === 'Nod' || reactionOwns('ParamAngleY') ? 0 : clamp(pose.headNod) * 5),
    ParamAngleZ: sleeping ? -5 : still || exclusive.has('ParamAngleZ') || reactionOwns('ParamAngleZ') ? 0 : clamp(follow.headTilt) * 8,
    ParamEyeBallX: still ? 0 : clamp(follow.gazeX),
    ParamEyeBallY: still ? 0 : clamp(follow.gazeY),
    ParamBodyAngleX: still || exclusive.has('ParamBodyAngleX') ? 0 : clamp(follow.bodyXPercent) * 4 + (reactionOwns('ParamBodyAngleX') ? 0 : clamp(pose.bodyTurn) * 3),
    ParamBodyAngleY: still || exclusive.has('ParamBodyAngleY') || reactionOwns('ParamBodyAngleY') ? 0 : clamp(pose.bodyLean) * 3,
    ParamBodyAngleZ: still || exclusive.has('ParamBodyAngleZ') || reactionOwns('ParamBodyAngleZ') ? 0 : -clamp(follow.bodyRotationDegrees) * 3,
    ParamEyeLOpen: hidden ? 1 : (1 - blinkL) * eyelid,
    ParamEyeROpen: hidden ? 1 : (1 - blinkR) * eyelid,
    ParamEyeLSmile: sleeping || hidden ? 0 : unit(pose.eyeSmile),
    ParamEyeRSmile: sleeping || hidden ? 0 : unit(pose.eyeSmile),
    // EyeBallForm is iris squash/stretch, not the smile eyelid parameter.
    // Keep an independent authored/physics value through the bridge below.
    ParamEyeBallForm: 0,
    ParamBrowLY: hidden || referenceFeatures && sleeping ? 0 : clamp(pose.browRaise) * .7 + browDifference,
    ParamBrowRY: hidden || referenceFeatures && sleeping ? 0 : clamp(pose.browRaise) * .7 - browDifference,
    ParamBrowLAngle: hidden || referenceFeatures && sleeping ? 0 : clamp(pose.browTilt) * .7,
    ParamBrowRAngle: hidden || referenceFeatures && sleeping ? 0 : -clamp(pose.browTilt) * .7,
    // A trace of the reference's warm cheeks keeps the bundled portrait from
    // looking pale at rest; imported models retain their authored neutral.
    ParamCheek: sleeping || hidden ? 0 : deformationProfile === 'akari-stable' ? .16 + unit(pose.blush) * .84 : unit(pose.blush),
    ParamBreath: still ? 0 : .35 + clamp(follow.breath) * .25 * unit(follow.breathScale / 1.12),
    ParamShoulderY: still ? 0 : unit(pose.shoulderLift),
    // Optional, real V8 joints. Authored motions own these local hand/sleeve
    // deformations; the neutral target clears them after the queue fades out.
    ParamHandsLift: 0,
    ParamHandsSway: 0,
    ParamSleeveEase: 0,
    ParamTear: sleeping || hidden ? 0 : unit(pose.tearAmount),
    ParamExcited: sleeping || hidden ? 0 : unit(pose.excitedAmount),
    ParamWarm: faceAmount('ParamWarm'),
    ParamSad: faceAmount('ParamSad'),
    ParamPout: faceAmount('ParamPout'),
    ParamShy: referenceLayered ? faceAmount('ParamShy') : undefined,
    ParamSurprise: referenceLayered ? faceAmount('ParamSurprise') : undefined,
    ParamRelaxed: referenceLayered ? faceAmount('ParamRelaxed') : undefined,
    ParamMouthForm: hidden || sleeping ? 0 : clamp(mouthForm),
    // Absolute application after motion/expression/physics guarantees immediate closure.
    // This limit is only for our reviewed automatic rig. Imported Cubism
    // models retain their full authored opening range.
    ParamMouthOpenY: quiet ? 0 : Math.min(deformationProfile === 'akari-stable' ? .6 : 1, mouthOpen),
    ParamMouthA: !referencePortrait && pose.mouthShape === 'O' ? 0 : patchAmount,
    ParamMouthO: pose.mouthShape === 'O' ? patchAmount : 0,
  };
}

/** Framework returns virtual indices for unknown IDs; never treat them as real. */
export function createCubismParameterBridge(model, idManager) {
  const count = model.getParameterCount();
  if (!Number.isSafeInteger(count) || count < 1 || count > 1024) throw new Error('Cubism parameter count is invalid.');
  const bindings = new Map();
  for (const name of Object.keys(cubismParameterTargets())) {
    const index = model.getParameterIndex(idManager.getId(name));
    if (!Number.isInteger(index) || index < 0 || index >= count) continue;
    const low = model.getParameterMinimumValue(index), high = model.getParameterMaximumValue(index);
    if (!Number.isFinite(low) || !Number.isFinite(high) || low > high) continue;
    bindings.set(name, { index, low, high });
  }
  return {
    supported: [...bindings.keys()],
    read(name) {
      const binding = bindings.get(name);
      return binding ? model.getParameterValueByIndex(binding.index) : undefined;
    },
    apply(targets, { mouthOnly = false, additive = [], multiply = [], dominant = [], preserve = [] } = {}) {
      const additiveNames = new Set(additive), multiplyNames = new Set(multiply), dominantNames = new Set(dominant), preserveNames = new Set(preserve);
      for (const [name, binding] of bindings) {
        if (mouthOnly !== name.startsWith('ParamMouth')) continue;
        if (preserveNames.has(name)) continue;
        if (!Number.isFinite(targets[name])) continue;
        let value = targets[name];
        if (additiveNames.has(name)) value += model.getParameterValueByIndex(binding.index);
        if (multiplyNames.has(name)) value *= model.getParameterValueByIndex(binding.index);
        if (dominantNames.has(name)) {
          const authored = model.getParameterValueByIndex(binding.index);
          if (Number.isFinite(authored) && Math.abs(authored) > Math.abs(value)) value = authored;
        }
        model.setParameterValueByIndex(binding.index, clamp(value, binding.low, binding.high));
      }
    },
  };
}
