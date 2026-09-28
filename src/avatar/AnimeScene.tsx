import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import type { PetCommand } from '../pet/PetScene';
import type { PetAction, PetBehaviorState } from '../pet/behavior';
import { createAvatarPerformance, type PerformanceInput } from './performance.mjs';

type Props = { command?: PetCommand; compact?: boolean; onState?: (state: PetBehaviorState) => void; onReady?: () => void; className?: string; speaking?: boolean; performanceInput?: PerformanceInput };
const vertexShader = `
varying vec2 vUv;
uniform float clockTime, motion, gazeX, gazeY, affection, resting, headTilt, headNod;
void main() {
  vUv = uv;
  vec3 p = position;
  float head = smoothstep(.51, .68, uv.y);
  float breathe = sin(clockTime * 1.6) * .007 * motion;
  p.y += breathe * smoothstep(.08, .55, uv.y);
  p.x *= 1.0 + breathe * (1.0 - head) * .45;
  float tilt = (sin(clockTime * .65) * .013 + gazeX * .027 + affection * .035 - resting * .05 + headTilt * .09) * motion;
  vec2 pivot = vec2(0.0, .25);
  vec2 h = p.xy - pivot;
  p.xy += (mat2(cos(tilt), sin(tilt), -sin(tilt), cos(tilt)) * h - h) * head;
  p.x += gazeX * .025 * head * motion;
  p.y += (gazeY * .018 - resting * .035 + headNod * .028) * head * motion;
  float hair = smoothstep(.12, .29, abs(uv.x - .5)) * smoothstep(.48, .65, uv.y);
  p.x += sin(clockTime * 1.8 + uv.y * 5.0) * .012 * hair * motion;
  p.y += sin(clockTime * 2.0) * affection * .014 * motion;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}`;
const fragmentShader = `
varying vec2 vUv;
uniform sampler2D baseMap, blinkMap, talkMap, roundMap, curiousMap, warmMap;
uniform float blinkLeft, blinkRight, mouth, mouthRound, mouthWide, warm, curious, surprised, browRaise, blush;
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
  samplePoint.y = mix(point.y, eyeCenter.y + (point.y-eyeCenter.y)/(1.0+surprised*.14), eyeMask);
  float brows = max(region(vec2(.410,.207),vec2(.061,.018)),region(vec2(.576,.190),vec2(.063,.018)));
  samplePoint.y += browRaise*.0035*brows;
  vec2 sampleUv = vec2(samplePoint.x,1.0-samplePoint.y);
  vec4 color = texture2D(baseMap, sampleUv);
  float face = region(vec2(.496,.270),vec2(.166,.106));
  color.rgb = mix(color.rgb, texture2D(warmMap,sampleUv).rgb, face*warm);
  float upperFace = max(eyeMask,brows);
  color.rgb = mix(color.rgb, texture2D(curiousMap,sampleUv).rgb, upperFace*curious);
  color.rgb = mix(color.rgb, texture2D(blinkMap,vUv).rgb, max(left*blinkLeft,right*blinkRight));
  float lips = region(vec2(.503,.321),vec2(.065,.031));
  vec2 mouthCenter = vec2(.503,.321);
  vec2 mouthScale = vec2(mix(1.0,1.12,mouthWide),mix(.46,1.0,mouth));
  vec2 mouthPoint = mouthCenter + (point-mouthCenter)/mouthScale;
  vec2 mouthUv = vec2(mouthPoint.x,1.0-mouthPoint.y);
  vec3 speechColor = mix(texture2D(talkMap,mouthUv).rgb,texture2D(roundMap,mouthUv).rgb,mouthRound);
  color.rgb = mix(color.rgb,speechColor,lips*smoothstep(.025,.16,mouth));
  float cheeks = max(region(vec2(.382,.288),vec2(.04,.023)),region(vec2(.600,.281),vec2(.039,.023)));
  color.rgb = mix(color.rgb, vec3(1.0,.36,.31),cheeks*blush*.12);
  // Reject nearly transparent texels before the 8-bit desktop compositor unpremultiplies them.
  color.a *= smoothstep(.035, .15, color.a);
  if (color.a < .02) discard;
  gl_FragColor = color;
  #include <colorspace_fragment>
  #include <premultiplied_alpha_fragment>
}`;

export default function AnimeScene({ command, compact = false, onState, onReady, className = '', speaking = false, performanceInput }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const callbacks = useRef({ onState, onReady, speaking, performanceInput }); callbacks.current = { onState, onReady, speaking, performanceInput };
  const requested = useRef(command); requested.current = command;
  const [failure, setFailure] = useState('');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const container = host.current;
    if (!container) return;
    let renderer: THREE.WebGLRenderer;
    try { renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: 'low-power' }); }
    catch { setFailure('当前设备未能开启角色动画，请启用硬件加速后重试。'); return; }
    setFailure('');
    renderer.setClearColor(0, 0); renderer.setPixelRatio(Math.min(devicePixelRatio, compact ? 1.5 : 2));
    const canvas = renderer.domElement;
    canvas.dataset.renderer = 'webgl'; canvas.dataset.avatarRenderer = 'mesh2d'; canvas.dataset.petCount = '1'; canvas.dataset.renderFrames = '0';
    canvas.setAttribute('role', 'img'); canvas.setAttribute('aria-label', '可互动的二次元少女小伴'); canvas.tabIndex = 0;
    container.appendChild(canvas);
    const scene = new THREE.Scene(), camera = new THREE.OrthographicCamera(-1, 1, 1.5, -1.5, .1, 10); camera.position.z = 4;
    const geometry = new THREE.PlaneGeometry(2, 3, 40, 60);
    const loader = new THREE.TextureLoader();
    const textures: THREE.Texture[] = [];
    let disposed = false, failed = false, raf = 0, inView = true, loaded = false, last = 0, time = 0, frames = 0, action: PetAction = 'idle', actionStart = 0, lastId = -1;
    let pointerX = 0, pointerY = 0, gazeX = 0, gazeY = 0, interactionSequence = 0;
    const performance = createAvatarPerformance();
    let localInput: PerformanceInput = { utteranceId: 'idle', text: '', phase: 'idle' };
    const media = matchMedia('(prefers-reduced-motion: reduce)');
    const uniforms = {
      baseMap: { value: null as THREE.Texture | null }, blinkMap: { value: null as THREE.Texture | null }, talkMap: { value: null as THREE.Texture | null }, roundMap: { value: null as THREE.Texture | null }, curiousMap: { value: null as THREE.Texture | null }, warmMap: { value: null as THREE.Texture | null },
      clockTime: { value: 0 }, motion: { value: 1 }, gazeX: { value: 0 }, gazeY: { value: 0 }, affection: { value: 0 }, resting: { value: 0 }, blinkLeft: { value: 0 }, blinkRight: { value: 0 }, mouth: { value: 0 }, mouthRound: { value: 0 }, mouthWide: { value: 0 }, warm: { value: 0 }, curious: { value: 0 }, surprised: { value: 0 }, browRaise: { value: 0 }, blush: { value: 0 }, headTilt: { value: 0 }, headNod: { value: 0 },
    };
    const material = new THREE.ShaderMaterial({ uniforms, vertexShader, fragmentShader, transparent: true, premultipliedAlpha: true, depthWrite: false });
    const model = new THREE.Mesh(geometry, material); scene.add(model);
    const load = (name: string) => new Promise<THREE.Texture>((resolve, reject) => {
      const texture = loader.load(`/avatars/akari/${name}.png`, () => { if (disposed) texture.dispose(); resolve(texture); }, undefined, reject);
      texture.colorSpace = THREE.SRGBColorSpace; textures.push(texture);
    });
    Promise.all([load('idle'), load('blink'), load('talk'),load('round'),load('curious'),load('warm')]).then(([idle, blink, talk,round,curious,warm]) => {
      if (disposed) return;
      uniforms.baseMap.value = idle; uniforms.blinkMap.value = blink; uniforms.talkMap.value = talk; uniforms.roundMap.value=round; uniforms.curiousMap.value=curious; uniforms.warmMap.value=warm; loaded = true;
    }).catch(() => { if (!disposed) { failed = true; cancelAnimationFrame(raf); setFailure('角色资源没有加载完成，请检查连接后重试。'); } });
    const resize = () => {
      const width = Math.max(1, container.clientWidth), height = Math.max(1, container.clientHeight), aspect = width / height;
      const halfHeight = Math.max(1.64, 1.04 / aspect);
      camera.left = -halfHeight * aspect; camera.right = halfHeight * aspect; camera.top = halfHeight; camera.bottom = -halfHeight;
      camera.updateProjectionMatrix(); renderer.setSize(width, height, false);
    };
    const resizeObserver = new ResizeObserver(resize); resizeObserver.observe(container); resize();
    const observer = new IntersectionObserver(entries => { inView = entries[0]?.isIntersecting !== false; last = 0; if(!inView) performance.step(0,{hidden:true}); }); observer.observe(container);
    const visibility = () => { last = 0; if(document.hidden) performance.step(0,{hidden:true}); }; document.addEventListener('visibilitychange', visibility);
    const emitState = () => callbacks.current.onState?.({ action, x: 0, facing: 1, lookX: gazeX, lookY: gazeY, actionTime: time-actionStart, actionProgress: 0, jumpHeight: 0, speed: 0, autonomous: false, paused: false, autonomyPaused: media.matches });
    const interact = (next: string) => {
      if (action === 'sleep' && next !== 'wake' && next !== 'sleep') return;
      action = next === 'wake' ? 'idle' : next as PetAction; actionStart = time;
      const phrase = action === 'pet' ? '谢谢你，有点不好意思，脸红了。' : action === 'eat' ? '谢谢你的点心，今天也很开心！' : action === 'jump' ? '哇！见到你真是惊喜！' : '';
      localInput = { utteranceId: `interaction-${++interactionSequence}`, text: phrase, phase: phrase ? 'speaking' : 'idle' };
      if(action === 'sleep') performance.reset();
      emitState();
    };
    const move = (event: PointerEvent) => { const rect = canvas.getBoundingClientRect(); pointerX = THREE.MathUtils.clamp((event.clientX-rect.left)/rect.width*2-1,-1,1); pointerY = THREE.MathUtils.clamp(1-(event.clientY-rect.top)/rect.height*2,-1,1); };
    const leave = () => { pointerX = pointerY = 0; };
    const click = () => interact(action === 'sleep' ? 'wake' : 'pet');
    const double = () => interact('jump');
    const key = (event: KeyboardEvent) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); click(); } };
    canvas.addEventListener('pointermove', move); canvas.addEventListener('pointerleave', leave); canvas.addEventListener('click', click); canvas.addEventListener('dblclick', double); canvas.addEventListener('keydown', key);
    const lost = (event: Event) => { event.preventDefault(); failed = true; cancelAnimationFrame(raf); setFailure('角色绘图连接已暂停，点击重新加载即可恢复。'); }; canvas.addEventListener('webglcontextlost', lost);
    const frame = (now: number) => {
      if (disposed || failed) return; raf = requestAnimationFrame(frame);
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
      const blinkLeft = action === 'sleep' ? 1 : pose.blinkLeft;
      const blinkRight = action === 'sleep' ? 1 : pose.blinkRight;
      gazeX += (pointerX-gazeX)*Math.min(1,dt*6); gazeY += (pointerY-gazeY)*Math.min(1,dt*6);
      uniforms.clockTime.value = time; uniforms.motion.value = media.matches ? 0 : 1;
      uniforms.gazeX.value = gazeX; uniforms.gazeY.value = gazeY;
      uniforms.affection.value = action === 'pet' || action === 'jump' ? Math.sin(Math.min(1,(time-actionStart)/2.7)*Math.PI) : 0;
      uniforms.resting.value += ((action === 'sleep' ? 1 : 0)-uniforms.resting.value)*Math.min(1,dt*5);
      const approach = (uniform: {value:number},value:number,rate=10) => { uniform.value += (value-uniform.value)*(1-Math.exp(-dt*rate)); };
      approach(uniforms.blinkLeft,blinkLeft,35); approach(uniforms.blinkRight,blinkRight,35);
      uniforms.mouth.value = action === 'sleep' ? 0 : pose.mouthOpen;
      approach(uniforms.mouthRound,pose.mouthShape === 'O' ? 1 : 0,32); approach(uniforms.mouthWide,pose.mouthShape === 'E' ? 1 : 0,24);
      approach(uniforms.warm,pose.expression === 'warm' || pose.expression === 'shy' ? pose.expressionAmount : 0,7);
      approach(uniforms.curious,pose.expression === 'curious' ? pose.expressionAmount : pose.expression === 'thoughtful' ? pose.expressionAmount*.45 : 0,7);
      approach(uniforms.surprised,pose.expression === 'surprised' ? pose.expressionAmount : 0,9);
      uniforms.browRaise.value=pose.browRaise; uniforms.blush.value=pose.blush; uniforms.headTilt.value=pose.headTilt; uniforms.headNod.value=pose.headNod;
      canvas.dataset.petAction = action; canvas.dataset.renderFrames = String(++frames); canvas.dataset.blink = Math.max(uniforms.blinkLeft.value,uniforms.blinkRight.value).toFixed(2); canvas.dataset.speaking = String(pose.speaking); canvas.dataset.gazeX = gazeX.toFixed(2);
      canvas.dataset.expression=pose.expression; canvas.dataset.mouthShape=pose.mouthShape; canvas.dataset.mouthOpen=uniforms.mouth.value.toFixed(3); canvas.dataset.speechSource=input.speech ? 'playback-progress' : 'text'; canvas.dataset.phase=input.phase;
      renderer.render(scene,camera);
      if (frames === 2) { callbacks.current.onReady?.(); emitState(); }
    }; raf = requestAnimationFrame(frame);
    return () => {
      disposed = true; performance.reset(); cancelAnimationFrame(raf); resizeObserver.disconnect(); observer.disconnect(); document.removeEventListener('visibilitychange', visibility);
      canvas.removeEventListener('pointermove', move); canvas.removeEventListener('pointerleave', leave); canvas.removeEventListener('click', click); canvas.removeEventListener('dblclick', double); canvas.removeEventListener('keydown', key); canvas.removeEventListener('webglcontextlost', lost);
      geometry.dispose(); material.dispose(); textures.forEach(texture => texture.dispose()); renderer.dispose(); renderer.forceContextLoss(); canvas.remove();
    };
  }, [compact, attempt]);
  return <div ref={host} className={`pet-three-scene anime-scene ${className}`}>{failure && <div className="pet-render-error" role="alert"><span>{failure}</span><button onClick={() => { setFailure(''); setAttempt(n=>n+1); }}>重新加载</button></div>}</div>;
}
