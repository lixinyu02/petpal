import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import type { PetCommand } from '../pet/PetScene';
import type { PetAction, PetBehaviorState, PetInteraction } from '../pet/behavior';
import { createAvatarPerformance, type PerformanceInput } from './performance.mjs';
import { loadAvatarImage, loadAvatarImages, type AvatarImageName } from './anime-resources.mjs';
import { animeEmotionMix } from './anime-emotion-render.mjs';
import { sampleAnimeHairWeights, createAnimeHairMotion } from './anime-rig.mjs';
import { bindCompanionGestures, portraitCoordinates, portraitContains } from '../pet/interaction.mjs';
import { createCompanionFeedback } from '../pet/gesture-feedback.mjs';
import '../pet/gesture-feedback.css';
import './anime-scene.css';

type Props = { command?: PetCommand; compact?: boolean; onState?: (state: PetBehaviorState) => void; onReady?: () => void; onInteract?: (action: PetInteraction) => void; interactive?: boolean; className?: string; speaking?: boolean; performanceInput?: PerformanceInput };
const vertexShader = `
varying vec2 vUv;
attribute vec2 hairWeights;
uniform vec2 hairLeft, hairRight;
uniform float clockTime, motion, gazeX, gazeY, affection, resting, headTilt, headNod;
void main() {
  vUv = uv;
  vec3 p = position;
  float head = smoothstep(.51, .68, uv.y);
  float awake = 1.0 - resting;
  float breathe = sin(clockTime * mix(1.6, 1.05, resting)) * .004 * motion * mix(1.0, .28, resting);
  p.y += breathe * smoothstep(.08, .55, uv.y);
  p.x *= 1.0 + breathe * (1.0 - head) * .45;
  // Local strands move before the shared head transform; their roots follow the head.
  p.xy += hairLeft * hairWeights.x + hairRight * hairWeights.y;
  float tilt = ((sin(clockTime * .65) * .007 + gazeX * .014 + affection * .018 + headTilt * .055) * awake - resting * .035) * motion;
  vec2 pivot = vec2(0.0, .25);
  vec2 h = p.xy - pivot;
  p.xy += (mat2(cos(tilt), sin(tilt), -sin(tilt), cos(tilt)) * h - h) * head;
  p.x += gazeX * .014 * head * motion;
  p.y += (gazeY * .012 - resting * .025 + headNod * .014 * awake) * head * motion;
  p.y += sin(clockTime * 2.0) * affection * .008 * motion;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}`;
const fragmentShader = `
varying vec2 vUv;
uniform sampler2D baseMap, blinkMap, talkMap, roundMap, curiousMap, warmMap, sadMap;
uniform float blinkLeft, blinkRight, mouth, mouthRound, mouthWide, warm, curious, surprised, browRaise, browTilt, blush, smile;
uniform float sadness, downcast, tears, sparkle, shy;
uniform float gazeX, gazeY, affection;
float regionAt(vec2 point, vec2 center, vec2 radius) {
  float d = length((point - center) / radius);
  return 1.0 - smoothstep(.78, 1.0, d);
}
float region(vec2 center, vec2 radius) { return regionAt(vec2(vUv.x,1.0-vUv.y),center,radius); }
void main() {
  vec2 point = vec2(vUv.x, 1.0-vUv.y);
  float left = region(vec2(.406,.247),vec2(.067,.039));
  float right = region(vec2(.581,.239),vec2(.069,.039));
  vec2 eyeCenter = point.x < .495 ? vec2(.406,.247) : vec2(.581,.239);
  float eyeMask = max(left,right);
  vec2 samplePoint = point;
  samplePoint.y = mix(point.y, eyeCenter.y + (point.y-eyeCenter.y)/(1.0+surprised*.14-downcast*.13), eyeMask);
  float brows = max(region(vec2(.410,.207),vec2(.061,.018)),region(vec2(.576,.190),vec2(.063,.018)));
  samplePoint.y += browRaise*.0035*brows;
  samplePoint.y += (point.x-eyeCenter.x)*(point.x < .495 ? 1.0 : -1.0)*browTilt*.16*brows;
  float iris = max(region(vec2(.414,.251),vec2(.027,.024)),region(vec2(.578,.244),vec2(.027,.024)));
  samplePoint += vec2(-gazeX*.003, gazeY*.002)*iris;
  vec2 sampleUv = vec2(samplePoint.x,1.0-samplePoint.y);
  vec4 color = texture2D(baseMap, sampleUv);
  float face = region(vec2(.496,.270),vec2(.166,.106));
  color.rgb = mix(color.rgb, texture2D(warmMap,sampleUv).rgb, face*warm);
  float upperFace = max(eyeMask,brows);
  color.rgb = mix(color.rgb, texture2D(curiousMap,sampleUv).rgb, upperFace*curious);
  // The seventh expression sampler changes only eyes/brows and the closed lips.
  // Hair roots, nose, jaw, costume and alpha always come from the base portrait.
  color.rgb = mix(color.rgb, texture2D(sadMap,sampleUv).rgb, upperFace*sadness);
  color.rgb = mix(color.rgb, texture2D(blinkMap,vUv).rgb, max(left*blinkLeft,right*blinkRight));
  float lips = region(vec2(.503,.321),vec2(.065,.031));
  color.rgb = mix(color.rgb,texture2D(sadMap,sampleUv).rgb,lips*sadness);
  // A closed smile can warm the face, but articulation always owns the final lips.
  color.rgb = mix(color.rgb,texture2D(blinkMap,vUv).rgb,lips*smile);
  vec2 mouthCenter = vec2(.503,.321);
  vec2 mouthScale = vec2(mix(1.0,1.12,mouthWide),mix(.46,1.0,mouth));
  vec2 mouthPoint = mouthCenter + (point-mouthCenter)/mouthScale;
  vec2 mouthUv = vec2(mouthPoint.x,1.0-mouthPoint.y);
  vec3 speechColor = mix(texture2D(talkMap,mouthUv).rgb,texture2D(roundMap,mouthUv).rgb,mouthRound);
  float cheeks = max(region(vec2(.382,.288),vec2(.04,.023)),region(vec2(.600,.281),vec2(.039,.023)));
  color.rgb = mix(color.rgb, vec3(1.0,.36,.31),cheeks*(blush*.12+shy*.11+affection*.025));
  // Stationary, local glints: neither tears nor excitement move the whole face.
  float water = max(region(vec2(.416,.268),vec2(.023,.004)),region(vec2(.580,.260),vec2(.023,.004)));
  float drop = max(region(vec2(.436,.276),vec2(.004,.007)),region(vec2(.600,.268),vec2(.004,.007)));
  color.rgb = mix(color.rgb,vec3(.75,.91,1.0),max(water*.30,drop*.15)*tears);
  float shine = max(region(vec2(.420,.246),vec2(.0025,.008)),region(vec2(.583,.238),vec2(.0025,.008)));
  shine = max(shine,max(region(vec2(.420,.246),vec2(.009,.002)),region(vec2(.583,.238),vec2(.009,.002))));
  color.rgb = mix(color.rgb,vec3(1.0,.97,.86),shine*sparkle*.78);
  // Articulation is the final color layer, including over the downturned mouth.
  color.rgb = mix(color.rgb,speechColor,lips*smoothstep(.025,.16,mouth));
  // Reject nearly transparent texels before the 8-bit desktop compositor unpremultiplies them.
  color.a *= smoothstep(.035, .15, color.a);
  if (color.a < .02) discard;
  gl_FragColor = color;
  #include <colorspace_fragment>
  #include <premultiplied_alpha_fragment>
}`;

export default function AnimeScene({ command, compact = false, onState, onReady, onInteract, interactive = true, className = '', speaking = false, performanceInput }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const callbacks = useRef({ onState, onReady, onInteract, speaking, performanceInput }); callbacks.current = { onState, onReady, onInteract, speaking, performanceInput };
  const requested = useRef(command); requested.current = command;
  const [failure, setFailure] = useState('');
  const [loading, setLoading] = useState(true);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const container = host.current;
    if (!container) return;
    let renderer: THREE.WebGLRenderer | undefined;
    let disposed = false, gpuFailed = false, raf = 0, inView = true, loaded = false, last = 0, time = 0, frames = 0, ready = false, action: PetAction = 'idle', actionStart = 0, lastId = -1;
    const abort = new AbortController();
    setFailure(''); setLoading(true); container.dataset.avatarMode = 'loading'; delete container.dataset.optionalEmotionUnavailable;
    const fallback = document.createElement('div'), fallbackModel = document.createElement('div');
    fallback.className = 'anime-fallback'; fallbackModel.className = 'anime-fallback-model'; fallback.appendChild(fallbackModel); container.appendChild(fallback);
    const label = interactive ? '二次元伙伴小伴。轻触回应，双击打招呼，长按休息；Enter 或空格也可操作。' : '二次元伙伴小伴';
    fallback.setAttribute('role', interactive ? 'button' : 'img'); fallback.setAttribute('aria-label', label); fallback.tabIndex = interactive ? 0 : -1;
    fallback.style.touchAction = 'pan-y pinch-zoom';
    fallback.dataset.renderer = 'dom'; fallback.dataset.avatarRenderer = 'layered-image'; fallback.dataset.petCount = '1'; fallback.dataset.renderFrames = '0';
    const layers: Partial<Record<AvatarImageName, HTMLImageElement>> = {};
    let blinkRightLayer: HTMLImageElement | undefined, smileLayer: HTMLImageElement | undefined;
    const browLayers: HTMLImageElement[] = [];
    const browMasks: HTMLDivElement[] = [];
    const browVariants: { warm: HTMLImageElement[]; curious: HTMLImageElement[]; sad: HTMLImageElement[] } = { warm: [], curious: [], sad: [] };
    const cheeks = document.createElement('div'); cheeks.className = 'anime-cheeks'; fallbackModel.appendChild(cheeks);
    const tears = document.createElement('div'); tears.className = 'anime-tears'; fallbackModel.appendChild(tears);
    const sparkle = document.createElement('div'); sparkle.className = 'anime-eye-sparkles'; fallbackModel.appendChild(sparkle);
    const textures: THREE.Texture[] = [];
    let canvas: HTMLCanvasElement | undefined;
    let hitMask: ImageData | undefined;
    const useFallback = (message: string) => {
      if (disposed) return;
      gpuFailed = true; container.dataset.avatarMode = 'fallback';
      if (canvas) { canvas.style.visibility = 'hidden'; canvas.setAttribute('aria-hidden', 'true'); canvas.tabIndex = -1; }
      fallback.style.visibility = 'visible'; fallback.removeAttribute('aria-hidden'); fallback.tabIndex = interactive ? 0 : -1;
      setFailure(message);
    };
    const smallScreen = matchMedia('(pointer: coarse)').matches || compact;
    try {
      renderer = new THREE.WebGLRenderer({ alpha: true, antialias: !smallScreen, powerPreference: 'low-power' });
      renderer.setClearColor(0, 0); renderer.setPixelRatio(Math.min(devicePixelRatio || 1, smallScreen ? 1.5 : 2));
      // Three.js normally logs shader failures without throwing. They must switch the visible renderer too.
      renderer.debug.checkShaderErrors = true;
      renderer.debug.onShaderError = () => useFallback('此设备的网格动画暂不可用，已切换轻量角色。');
      canvas = renderer.domElement;
      canvas.style.visibility = 'hidden'; canvas.tabIndex = -1; canvas.setAttribute('aria-hidden', 'true');
      canvas.dataset.renderer = 'webgl'; canvas.dataset.avatarRenderer = 'mesh2d'; canvas.dataset.petCount = '1'; canvas.dataset.renderFrames = '0';
      canvas.setAttribute('role', interactive ? 'button' : 'img'); canvas.setAttribute('aria-label', label); canvas.style.touchAction = 'pan-y pinch-zoom';
      container.appendChild(canvas);
    } catch { useFallback('此设备未能开启网格动画，正在使用轻量角色。'); }
    const scene = new THREE.Scene(), camera = new THREE.OrthographicCamera(-1, 1, 1.5, -1.5, .1, 10); camera.position.z = 4;
    const geometry = new THREE.PlaneGeometry(2, 3, 40, 60);
    const uv = geometry.getAttribute('uv'), hairWeights = new Float32Array(uv.count * 2);
    for (let index = 0; index < uv.count; index++) {
      const weight = sampleAnimeHairWeights(uv.getX(index), 1-uv.getY(index));
      hairWeights[index*2] = weight.left; hairWeights[index*2+1] = weight.right;
    }
    geometry.setAttribute('hairWeights', new THREE.BufferAttribute(hairWeights, 2));
    const hairMotion = createAnimeHairMotion();
    let pointerX = 0, pointerY = 0, gazeX = 0, gazeY = 0, interactionSequence = 0;
    const performance = createAvatarPerformance();
    let localInput: PerformanceInput = { utteranceId: 'idle', text: '', phase: 'idle' };
    const media = matchMedia('(prefers-reduced-motion: reduce)');
    const uniforms = {
      baseMap: { value: null as THREE.Texture | null }, blinkMap: { value: null as THREE.Texture | null }, talkMap: { value: null as THREE.Texture | null }, roundMap: { value: null as THREE.Texture | null }, curiousMap: { value: null as THREE.Texture | null }, warmMap: { value: null as THREE.Texture | null }, sadMap: { value: null as THREE.Texture | null },
      clockTime: { value: 0 }, motion: { value: 1 }, gazeX: { value: 0 }, gazeY: { value: 0 }, affection: { value: 0 }, resting: { value: 0 }, blinkLeft: { value: 0 }, blinkRight: { value: 0 }, mouth: { value: 0 }, mouthRound: { value: 0 }, mouthWide: { value: 0 }, warm: { value: 0 }, curious: { value: 0 }, surprised: { value: 0 }, browRaise: { value: 0 }, browTilt: { value: 0 }, blush: { value: 0 }, smile: { value: 0 }, headTilt: { value: 0 }, headNod: { value: 0 }, hairLeft: { value: new THREE.Vector2() }, hairRight: { value: new THREE.Vector2() },
      sadness: { value: 0 }, downcast: { value: 0 }, tears: { value: 0 }, sparkle: { value: 0 }, shy: { value: 0 },
    };
    const material = new THREE.ShaderMaterial({ uniforms, vertexShader, fragmentShader, transparent: true, premultipliedAlpha: true, depthWrite: false });
    const model = new THREE.Mesh(geometry, material); scene.add(model);
    const maps = { idle: uniforms.baseMap, blink: uniforms.blinkMap, talk: uniforms.talkMap, round: uniforms.roundMap, curious: uniforms.curiousMap, warm: uniforms.warmMap, sad: uniforms.sadMap };
    const textureFor = (image: HTMLImageElement) => {
      const texture = new THREE.Texture(image); texture.colorSpace = THREE.SRGBColorSpace;
      // Seven samplers fit the WebGL minimum budget of eight; omit mip pyramids.
      texture.generateMipmaps = false; texture.minFilter = THREE.LinearFilter; texture.needsUpdate = true;
      textures.push(texture); return texture;
    };
    void loadAvatarImages({
      load: name => loadAvatarImage(name, { signal: abort.signal }), isStopped: () => disposed,
      onBase: (image, name) => {
        image.alt = ''; image.draggable = false; fallbackModel.appendChild(image); loaded = true; setLoading(false);
        for (const side of ['left','right']) {
          const mask = document.createElement('div'); mask.className = `anime-brow anime-brow-${side}`;
          const brow = image.cloneNode() as HTMLImageElement; mask.appendChild(brow); fallbackModel.appendChild(mask); browLayers.push(brow); browMasks.push(mask);
        }
        try { const mask = document.createElement('canvas'); mask.width = 96; mask.height = 144; const context = mask.getContext('2d'); if (context) { context.drawImage(image,0,0,96,144); hitMask = context.getImageData(0,0,96,144); } } catch { /* A silhouette remains available when pixel reads are unsupported. */ }
        // Every sampler initially uses the valid base, so optional expressions cannot blank the portrait.
        if (!gpuFailed) { const texture = textureFor(image); Object.values(maps).forEach(map => { map.value = texture; }); }
        if (name !== 'idle') useFallback('基础图片加载失败，已使用同角色备用图片；可以重试恢复完整表情。');
      },
      onVariant: (image, name) => {
        image.alt = ''; image.draggable = false; image.className = `anime-layer anime-layer-${name}`;
        // Expressions go below eyelids and lips; loading order must not change compositing order.
        image.style.zIndex = name === 'warm' || name === 'curious' || name === 'sad' ? '1' : name === 'blink' ? '2' : '4';
        fallbackModel.appendChild(image); layers[name] = image;
        if (name === 'warm' || name === 'curious' || name === 'sad') {
          for (const mask of browMasks) {
            const brow = image.cloneNode() as HTMLImageElement; brow.className = ''; brow.style.zIndex = name === 'warm' ? '1' : name === 'curious' ? '2' : '3';
            brow.style.opacity = '0'; mask.appendChild(brow); browVariants[name].push(brow);
          }
        }
        if (name === 'blink') {
          image.classList.add('anime-layer-blink-left');
          blinkRightLayer = image.cloneNode() as HTMLImageElement; blinkRightLayer.className = 'anime-layer anime-layer-blink-right'; fallbackModel.appendChild(blinkRightLayer);
          smileLayer = image.cloneNode() as HTMLImageElement; smileLayer.className = 'anime-layer anime-layer-smile'; fallbackModel.appendChild(smileLayer);
        }
        if (!gpuFailed) maps[name].value = textureFor(image);
      },
      onIssue: name => {
        // Extra emotional artwork is optional. Its fallback sampler already uses
        // the body; retain normal animation and local brow/tear cues if it fails.
        if (name === 'sad') { container.dataset.optionalEmotionUnavailable = 'sad'; return; }
        useFallback('部分角色图片未能加载，正在使用已加载的轻量角色；请检查连接后重试。');
      },
    }).then(() => {
      if (!disposed && !loaded) { setLoading(false); container.dataset.avatarMode = 'unavailable'; setFailure('角色图片暂时无法获取，请检查连接后重新加载。'); }
    });
    const resize = () => {
      const width = Math.max(1, container.clientWidth), height = Math.max(1, container.clientHeight), aspect = width / height;
      const halfHeight = Math.max(1.64, 1.04 / aspect);
      camera.left = -halfHeight * aspect; camera.right = halfHeight * aspect; camera.top = halfHeight; camera.bottom = -halfHeight;
      camera.updateProjectionMatrix();
      fallbackModel.style.width = `${height / halfHeight}px`;
      if (renderer && !gpuFailed) { try { renderer.setSize(width, height, false); } catch { useFallback('网格画面调整失败，已切换轻量角色。'); } }
    };
    const resizeObserver = typeof ResizeObserver === 'function' ? new ResizeObserver(resize) : undefined; resizeObserver?.observe(container); window.addEventListener('resize', resize); resize();
    const observer = typeof IntersectionObserver === 'function' ? new IntersectionObserver(entries => { inView = entries[0]?.isIntersecting !== false; last = 0; if(!inView) performance.step(0,{hidden:true}); }) : undefined; observer?.observe(container);
    const visibility = () => { last = 0; if(document.hidden) performance.step(0,{hidden:true}); }; document.addEventListener('visibilitychange', visibility);
    const emitState = () => callbacks.current.onState?.({ action, x: 0, facing: 1, lookX: gazeX, lookY: gazeY, actionTime: time-actionStart, actionProgress: 0, jumpHeight: 0, speed: 0, autonomous: false, paused: false, autonomyPaused: media.matches });
    const interact = (next: PetInteraction, userGesture = false) => {
      if (action === 'sleep' && next !== 'wake' && next !== 'sleep') return;
      action = next === 'wake' ? 'idle' : next as PetAction; actionStart = time;
      // Touch changes the expression, never invents speech or competes with playback.
      localInput = { utteranceId: `interaction-${++interactionSequence}`, text: '', phase: 'idle' };
      if(action === 'sleep') performance.reset();
      else if (next === 'pet' || next === 'jump' || (next === 'wake' && userGesture)) performance.react({ id: String(interactionSequence), kind: next === 'pet' ? 'pet' : next === 'jump' ? 'greet' : 'wake' });
      emitState();
      if (userGesture) callbacks.current.onInteract?.(next);
    };
    const move = (x: number, y: number) => { const rect = container.getBoundingClientRect(); pointerX = THREE.MathUtils.clamp((x-rect.left)/Math.max(1,rect.width)*2-1,-1,1); pointerY = THREE.MathUtils.clamp(1-(y-rect.top)/Math.max(1,rect.height)*2,-1,1); };
    const leave = () => { pointerX = pointerY = 0; };
    const surfaces: HTMLElement[] = canvas ? [canvas, fallback] : [fallback];
    const feedback = createCompanionFeedback(container, { motionQuery: media });
    const unbindGestures = surfaces.map(surface => bindCompanionGestures(surface, {
      enabled: () => interactive && loaded && !disposed && surface.getAttribute('aria-hidden') !== 'true',
      hitTest: (x,y) => portraitContains(portraitCoordinates(container.getBoundingClientRect(),x,y),hitMask),
      getAction: () => action, emit: next => interact(next,true), onPointer: move, onLeave: leave,
      onFeedback: value => feedback.update(value, surface),
    }));
    const lost = (event: Event) => { event.preventDefault(); useFallback('网格绘图连接已暂停，已切换轻量角色；可以重试恢复。'); }; canvas?.addEventListener('webglcontextlost', lost);
    const releaseGpu = () => {
      if (!renderer) return;
      // Remove the listener before intentionally losing a discarded context.
      canvas?.removeEventListener('webglcontextlost', lost);
      geometry.dispose(); material.dispose(); textures.forEach(texture => texture.dispose()); textures.length = 0;
      renderer.dispose(); renderer.forceContextLoss(); renderer = undefined;
    };
    let fallbackFrames = 0;
    const frame = (now: number) => {
      if (disposed) return; raf = requestAnimationFrame(frame);
      if (gpuFailed) releaseGpu();
      if (!loaded || document.hidden || !inView) {
        performance.setInput(callbacks.current.performanceInput || localInput); performance.step(0,{hidden:true}); last = 0; return;
      }
      if (last && now-last < 1000/30) return;
      const dt = last ? Math.min((now-last)/1000,.1) : 0; last = now; time += dt;
      const command = requested.current;
      if (command && command.id !== lastId) { lastId = command.id; interact(command.action); }
      if (action !== 'sleep' && action !== 'idle' && time-actionStart > (action === 'eat' ? 4 : 2.7)) interact('wake');
      const supplied = callbacks.current.performanceInput;
      const input = action === 'sleep' ? { utteranceId: 'sleep', text: '', phase: 'idle' as const } : supplied && (supplied.phase !== 'idle' || action === 'idle') ? supplied : localInput;
      performance.setInput(input);
      const pose = performance.step(dt,{reducedMotion:media.matches,hidden:false});
      const affection = action === 'pet' || action === 'jump' ? Math.sin(Math.min(1,(time-actionStart)/2.7)*Math.PI) : 0;
      const asleep = action === 'sleep';
      const emotion = animeEmotionMix(pose,{sleeping:asleep});
      const blinkLeft = emotion.blinkLeft;
      const blinkRight = emotion.blinkRight;
      const targetX = asleep || media.matches ? 0 : THREE.MathUtils.clamp(pointerX + pose.gazeOffsetX,-1,1);
      const targetY = asleep || media.matches ? 0 : THREE.MathUtils.clamp(pointerY + pose.gazeOffsetY,-1,1);
      gazeX += (targetX-gazeX)*Math.min(1,dt*6); gazeY += (targetY-gazeY)*Math.min(1,dt*6);
      if (media.matches) gazeX = gazeY = 0;
      uniforms.clockTime.value = time; uniforms.motion.value = media.matches ? 0 : 1;
      uniforms.gazeX.value = gazeX; uniforms.gazeY.value = gazeY;
      uniforms.affection.value += (affection-uniforms.affection.value)*(1-Math.exp(-dt*8));
      uniforms.resting.value += ((action === 'sleep' ? 1 : 0)-uniforms.resting.value)*Math.min(1,dt*5);
      const approach = (uniform: {value:number},value:number,rate=10) => { uniform.value += (value-uniform.value)*(1-Math.exp(-dt*rate)); };
      approach(uniforms.blinkLeft,blinkLeft,35); approach(uniforms.blinkRight,blinkRight,35);
      uniforms.mouth.value = action === 'sleep' ? 0 : pose.mouthOpen;
      approach(uniforms.mouthRound,pose.mouthShape === 'O' ? 1 : 0,32); approach(uniforms.mouthWide,pose.mouthShape === 'E' ? 1 : 0,24);
      uniforms.warm.value = pose.warmAmount; uniforms.curious.value = pose.curiousAmount; uniforms.surprised.value = pose.surpriseAmount;
      uniforms.smile.value = emotion.smile; uniforms.browTilt.value = pose.browTilt;
      uniforms.browRaise.value=pose.browRaise; uniforms.blush.value=emotion.blush; uniforms.headTilt.value=asleep ? 0 : pose.headTilt; uniforms.headNod.value=asleep ? 0 : pose.headNod;
      uniforms.sadness.value=emotion.sadness; uniforms.downcast.value=emotion.downcast; uniforms.tears.value=emotion.tears; uniforms.sparkle.value=emotion.sparkle; uniforms.shy.value=emotion.shy;
      const hair = hairMotion.step(dt,{reducedMotion:media.matches,resting:asleep ? 1 : 0,gazeX,headTilt:uniforms.headTilt.value});
      uniforms.hairLeft.value.set(hair.leftX,hair.leftY); uniforms.hairRight.value.set(hair.rightX,hair.rightY);
      if (renderer && !gpuFailed && canvas) {
        try {
          renderer.render(scene,camera);
          if (!gpuFailed && !renderer.getContext().isContextLost()) {
            canvas.dataset.renderFrames = String(++frames); canvas.style.visibility = 'visible'; canvas.removeAttribute('aria-hidden'); canvas.tabIndex = interactive ? 0 : -1;
            fallback.style.visibility = 'hidden'; fallback.setAttribute('aria-hidden', 'true'); fallback.tabIndex = -1; container.dataset.avatarMode = 'webgl';
          } else if (!gpuFailed) useFallback('网格绘图连接已暂停，已切换轻量角色。');
        } catch { useFallback('网格动画未能完成绘制，已切换轻量角色。'); }
      }
      if (gpuFailed) {
        // Same performance controller drives the fallback; speech cancellation and reduced motion still apply.
        const amount = (name: AvatarImageName, value: number) => { if (layers[name]) layers[name]!.style.opacity = String(value); };
        amount('blink', uniforms.blinkLeft.value);
        if (blinkRightLayer) blinkRightLayer.style.opacity = String(uniforms.blinkRight.value);
        if (smileLayer) smileLayer.style.opacity = String(uniforms.smile.value);
        const mouth = THREE.MathUtils.smoothstep(uniforms.mouth.value, .025, .16);
        amount('talk', mouth * (1-uniforms.mouthRound.value)); amount('round', mouth * uniforms.mouthRound.value);
        amount('warm', uniforms.warm.value); amount('curious', uniforms.curious.value); amount('sad',emotion.sadness);
        browLayers.forEach((brow,index) => {
          const transform = `translateY(${-pose.browRaise*.35}%) rotate(${pose.browTilt*(index ? 1 : -1)*2.6}deg)`;
          brow.style.transform = transform;
          for (const name of ['warm','curious','sad'] as const) if (browVariants[name][index]) { browVariants[name][index].style.transform = transform; browVariants[name][index].style.opacity = String(name==='sad'?emotion.sadness:uniforms[name].value); }
        });
        cheeks.style.opacity = String(Math.min(1,emotion.blush + emotion.shy*.25 + uniforms.affection.value*.2));
        tears.style.opacity=String(emotion.tears); sparkle.style.opacity=String(emotion.sparkle);
        const rest = uniforms.resting.value, awake = 1-rest;
        fallbackModel.style.transform = media.matches ? 'none' : `translate(${gazeX*1.2}px,${Math.sin(time*(1.6-.55*rest))*.8*(1-.72*rest)+pose.headNod*2*awake}px) rotate(${(pose.headTilt*1.2+gazeX*.3)*awake-rest*.6}deg)`;
        fallback.dataset.renderFrames = String(++fallbackFrames);
      }
      const visible = gpuFailed ? fallback : canvas;
      unbindGestures.forEach(binding => binding.refresh());
      if (visible) {
        visible.dataset.petAction = action; visible.dataset.blink = Math.max(uniforms.blinkLeft.value,uniforms.blinkRight.value).toFixed(2); visible.dataset.speaking = String(pose.speaking); visible.dataset.gazeX = gazeX.toFixed(2);
        visible.dataset.expression=pose.expression; visible.dataset.mouthShape=pose.mouthShape; visible.dataset.mouthOpen=uniforms.mouth.value.toFixed(3); visible.dataset.speechSource=input.speech ? 'playback-progress' : 'text'; visible.dataset.phase=input.phase;
        visible.dataset.blinkLeft=uniforms.blinkLeft.value.toFixed(3); visible.dataset.blinkRight=uniforms.blinkRight.value.toFixed(3);
        visible.dataset.hairLeft=(gpuFailed ? 0 : hair.leftX).toFixed(5); visible.dataset.hairRight=(gpuFailed ? 0 : hair.rightX).toFixed(5); visible.dataset.smile=pose.smileAmount.toFixed(3);
        visible.dataset.sadness=emotion.sadness.toFixed(3); visible.dataset.tears=emotion.tears.toFixed(3); visible.dataset.eyeSparkle=emotion.sparkle.toFixed(3); visible.dataset.eyeSmile=Math.max(emotion.blinkLeft-pose.blinkLeft,emotion.blinkRight-pose.blinkRight).toFixed(3);
      }
      // A shader failure never counts as a successful WebGL frame. DOM readiness requires its loaded image.
      if (!ready && (frames > 0 || fallbackFrames > 0)) { ready = true; callbacks.current.onReady?.(); emitState(); }
    }; raf = requestAnimationFrame(frame);
    return () => {
      disposed = true; abort.abort(); performance.reset(); cancelAnimationFrame(raf); resizeObserver?.disconnect(); observer?.disconnect(); window.removeEventListener('resize', resize); document.removeEventListener('visibilitychange', visibility);
      unbindGestures.forEach(unbind => unbind());
      feedback.dispose();
      releaseGpu(); geometry.dispose(); material.dispose(); canvas?.remove(); fallback.remove();
    };
  }, [compact, attempt, interactive]);
  return <div ref={host} className={`pet-three-scene anime-scene ${className}`}>{(failure || loading) && <div className="anime-scene-status" role={failure ? 'alert' : 'status'}><span>{failure || '正在加载角色…'}</span>{failure && <button onClick={() => setAttempt(n=>n+1)}>重新加载</button>}</div>}</div>;
}
