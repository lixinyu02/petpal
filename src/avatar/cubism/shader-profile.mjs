/**
 * Compatibility adapter for the pinned official Cubism Web Framework 5-r.5.
 * Its loader builds every extended blend combination even when the official
 * model classifier says the model uses only normal/add/multiply blending.
 * Keep the original standard/masked/inverted/copy programs and their sources;
 * skip only the extended-combination loop on this exclusively owned context.
 * Unknown models or an unfamiliar Framework shape retain the full loader.
 */
export function configureCubismShaderProfile(shader, model, { signal } = {}) {
  let standard = false;
  try { standard = model?.isBlendModeEnabled?.() === false && model?.getOffscreenCount?.() === 0; } catch { return null; }
  if (!standard || !shader || !Object.isExtensible(shader)
    || Object.hasOwn(shader, 'registerShader') || Object.hasOwn(shader, 'registerBlendShader')
    || typeof shader.registerShader !== 'function' || typeof shader.registerBlendShader !== 'function'
    || !Array.isArray(shader._shaderSets) || shader._shaderSets.length !== 0
    || shader._isShaderLoading || shader._isShaderLoaded
    || !Array.isArray(shader._colorBlendValues) || shader._colorBlendValues.length !== 19
    || !Array.isArray(shader._alphaBlendValues) || shader._alphaBlendValues.length !== 6
    || shader._shaderCount !== 251 || !(shader._blendShaderSetMap instanceof Map)
    || shader._blendShaderSetMap.size !== 0) return null;

  const registerStandard = shader.registerShader, registerBlend = shader.registerBlendShader;
  let disposed = false;
  shader.registerShader = function (...args) {
    if (this !== shader) return registerStandard.apply(this, args);
    // Upstream shader fetches are not abortable. Their late Promise callback
    // must never allocate programs after cancellation/context release.
    if (disposed || signal?.aborted) return;
    return registerStandard.apply(this, args);
  };
  shader.registerBlendShader = function (...args) {
    if (this !== shader) return registerBlend.apply(this, args);
    if (disposed || signal?.aborted) return;
    const colors = shader._colorBlendValues;
    shader._colorBlendValues = [];
    try { return registerBlend.apply(shader, args); }
    finally { shader._colorBlendValues = colors; }
  };
  return {
    profile: 'standard',
    // Keep the guards attached to this dead context: restoring the original
    // methods would revive a still-pending upstream callback after release.
    dispose() { disposed = true; },
  };
}
