import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { createCatModel } from './CatModel';
import { createPetBehavior } from './behavior';
import type { PetAction, PetBehaviorState as PetSnapshot, PetInteraction } from './behavior';
import { bindCompanionGestures } from './interaction.mjs';
import { createCompanionFeedback } from './gesture-feedback.mjs';
import './gesture-feedback.css';

export type PetCommand = { action: PetInteraction; id: number };
type Props = { command?: PetCommand; compact?: boolean; onState?: (state: PetSnapshot) => void; onReady?: () => void; onInteract?: (action: PetInteraction) => void; interactive?: boolean; className?: string };

export default function PetScene({ command, compact = false, onState, onReady, onInteract, interactive = true, className = '' }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const behavior = useRef<ReturnType<typeof createPetBehavior> | null>(null);
  const callbacks = useRef({ onState, onReady, onInteract });
  callbacks.current = { onState, onReady, onInteract };
  const requested = useRef(command); requested.current = command;
  const [failure, setFailure] = useState('');
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const container = host.current;
    if (!container) return;
    let renderer: THREE.WebGLRenderer;
    try { renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: 'low-power' }); }
    catch { setFailure('当前设备未能开启 3D 渲染。请启用浏览器硬件加速后重试。'); return; }
    setFailure('');
    const canvas = renderer.domElement;
    canvas.dataset.renderer = 'webgl'; canvas.dataset.petCount = '1'; canvas.dataset.renderFrames = '0';
    canvas.setAttribute('aria-label', interactive ? '橘白小猫。轻触回应，双击打招呼，长按休息；Enter 或空格也可操作。' : '橘白 3D 小猫');
    canvas.setAttribute('role', interactive ? 'button' : 'img'); canvas.tabIndex = interactive ? 0 : -1;
    canvas.style.touchAction = 'pan-y pinch-zoom';
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, compact ? 1.5 : 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.98;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.setClearColor(0x000000, 0);
    container.appendChild(canvas);
    const scene = new THREE.Scene();
    const camera = new THREE.OrthographicCamera(-2, 2, 2, -2, 0.1, 50);
    camera.position.set(0.35, 2.6, 8);
    camera.lookAt(0, 1.35, 0);
    scene.add(new THREE.HemisphereLight(0xfff7e8, 0xa4a695, 1.9));
    const key = new THREE.DirectionalLight(0xffebd8, 2.7);
    key.position.set(-3, 8, 5); key.castShadow = true;
    key.shadow.mapSize.set(compact ? 512 : 1024, compact ? 512 : 1024);
    Object.assign(key.shadow.camera, { left: -4, right: 4, top: 4, bottom: -4, near: 0.1, far: 15 });
    key.shadow.normalBias = 0.035; key.shadow.bias = -0.0002; key.shadow.radius = 3;
    scene.add(key);
    const rim = new THREE.DirectionalLight(0xffffff, 1.3); rim.position.set(3, 3.5, -3); scene.add(rim);
    const cat = createCatModel(); scene.add(cat.group);
    const floorGeometry = new THREE.PlaneGeometry(12, 12);
    const floorMaterial = new THREE.ShadowMaterial({ color: 0x716a58, opacity: 0.12 });
    const floor = new THREE.Mesh(floorGeometry, floorMaterial);
    floor.rotation.x = -Math.PI / 2; floor.position.y = -0.015; floor.receiveShadow = true; scene.add(floor);
    const bowl = new THREE.Group();
    const bowlMaterial = new THREE.MeshStandardMaterial({ color: 0x78968b, roughness: 0.4 });
    const bowlGeometry = new THREE.CylinderGeometry(0.3, 0.24, 0.15, 32);
    const dish = new THREE.Mesh(bowlGeometry, bowlMaterial); dish.position.y = 0.08; bowl.add(dish);
    const foodGeometry = new THREE.SphereGeometry(0.05, 8, 6);
    const foodMaterial = new THREE.MeshStandardMaterial({ color: 0x9a6445, roughness: 0.9 });
    for (let n = 0; n < 9; n++) { const food = new THREE.Mesh(foodGeometry, foodMaterial); const a = n * 2.4; food.position.set(Math.cos(a) * (n / 45), 0.16, Math.sin(a) * (n / 45)); bowl.add(food); }
    bowl.visible = false; scene.add(bowl);
    const media = matchMedia('(prefers-reduced-motion: reduce)');
    const controller = createPetBehavior({ bounds: compact ? [-0.15, 0.15] : [-0.35, 0.35], reducedMotion: media.matches, visible: !document.hidden });
    behavior.current = controller;
    let inView = true, disposed = false, raf = 0, frames = 0, last = 0, time = 0, sentAt = -1, previousAction: PetAction | undefined, lastId = -1;
    const resize = () => {
      const width = Math.max(container.clientWidth, 1), height = Math.max(container.clientHeight, 1);
      const aspect = width / height, halfHeight = Math.max(1.87, 1.62 / aspect);
      camera.left = -halfHeight * aspect; camera.right = halfHeight * aspect; camera.top = halfHeight; camera.bottom = -halfHeight;
      camera.updateProjectionMatrix(); renderer.setSize(width, height, false);
    };
    const resizeObserver = new ResizeObserver(resize); resizeObserver.observe(container); resize();
    const visibility = () => { controller.setVisible(!document.hidden && inView); last = 0; };
    const observer = new IntersectionObserver(entries => { inView = entries[0]?.isIntersecting !== false; visibility(); }); observer.observe(container);
    const reduced = () => controller.setReducedMotion(media.matches);
    media.addEventListener('change', reduced); document.addEventListener('visibilitychange', visibility);
    const pointerPosition = (x: number, y: number) => { const rect = canvas.getBoundingClientRect(); return new THREE.Vector2((x - rect.left) / Math.max(1,rect.width) * 2 - 1, 1 - (y - rect.top) / Math.max(1,rect.height) * 2); };
    const raycaster = new THREE.Raycaster();
    const feedback = createCompanionFeedback(container, { motionQuery: media });
    const unbindGestures = bindCompanionGestures(canvas, {
      enabled: () => interactive && !disposed,
      hitTest: (x, y) => {
        const point = pointerPosition(x, y); if (Math.abs(point.x) > 1 || Math.abs(point.y) > 1) return false;
        cat.group.updateMatrixWorld(true); camera.updateMatrixWorld(true); raycaster.setFromCamera(point, camera);
        return raycaster.intersectObject(cat.group, true).some(hit => { let current: THREE.Object3D | null = hit.object; while (current) { if (!current.visible) return false; current = current.parent; } return true; });
      },
      getAction: () => controller.snapshot().action,
      emit: next => {
        if (controller.snapshot().action === 'sleep' && next !== 'wake') return;
        const state = controller.interact(next); callbacks.current.onState?.(state); callbacks.current.onInteract?.(next);
      },
      onPointer: (x,y) => { const point = pointerPosition(x,y); controller.setPointer(point.x,point.y); },
      onLeave: () => controller.clearPointer(),
      onFeedback: value => feedback.update(value, canvas),
    });
    const lost = (event: Event) => { event.preventDefault(); unbindGestures(); setFailure('3D 画面暂时中断，点击重试即可重新唤起小猫。'); cancelAnimationFrame(raf); };
    canvas.addEventListener('webglcontextlost', lost);
    const tick = (now: number) => {
      if (disposed) return;
      raf = requestAnimationFrame(tick);
      if (document.hidden || !inView) { last = 0; return; }
      if (last && now - last < 1000 / 30) return;
      const dt = last ? Math.min((now - last) / 1000, 0.1) : 1 / 30; last = now; time += dt;
      const pending = requested.current;
      if (pending && pending.id !== lastId) { lastId = pending.id; controller.interact(pending.action); }
      const state = controller.step(dt);
      cat.update(time, { action: state.action, actionProgress: state.actionProgress, jumpHeight: state.jumpHeight, lookX: state.lookX, lookY: state.lookY, speed: state.speed, reducedMotion: media.matches });
      cat.group.position.x = state.x;
      const yaw = state.action === 'walk' ? state.facing * 1.1 : state.lookX * 0.07;
      cat.group.rotation.y = THREE.MathUtils.damp(cat.group.rotation.y, yaw, 5, dt);
      bowl.visible = state.action === 'eat'; bowl.position.set(state.x, 0, 0.85);
      renderer.render(scene, camera); frames++;
      unbindGestures.refresh();
      if (frames < 4 || frames % 15 === 0) { canvas.dataset.renderFrames = String(frames); canvas.dataset.petAction = state.action; canvas.dataset.petX = state.x.toFixed(3); }
      if (frames === 2) callbacks.current.onReady?.();
      if (state.action !== previousAction || time - sentAt > 0.5) { previousAction = state.action; sentAt = time; callbacks.current.onState?.(state); }
    };
    raf = requestAnimationFrame(tick);
    return () => {
      disposed = true; cancelAnimationFrame(raf); observer.disconnect(); resizeObserver.disconnect();
      document.removeEventListener('visibilitychange', visibility); media.removeEventListener('change', reduced);
      unbindGestures(); feedback.dispose(); canvas.removeEventListener('webglcontextlost', lost);
      cat.dispose(); floorGeometry.dispose(); floorMaterial.dispose(); bowlGeometry.dispose(); bowlMaterial.dispose(); foodGeometry.dispose(); foodMaterial.dispose(); key.shadow.map?.dispose();
      renderer.dispose(); renderer.forceContextLoss(); canvas.remove(); behavior.current = null;
    };
  }, [compact, attempt, interactive]);
  return <div className={`pet-three-scene ${className}`} ref={host}>
    {failure && <div className="pet-render-error" role="alert"><span>{failure}</span><button onClick={() => setAttempt(value => value + 1)}>重试 3D 画面</button></div>}
  </div>;
}
