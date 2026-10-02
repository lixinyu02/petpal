import { useEffect, useRef, useState } from 'react';
import AnimeScene from '../AnimeScene';
import type { PetCommand } from '../../pet/PetScene';
import type { PetAction, PetBehaviorState, PetInteraction } from '../../pet/behavior';
import { createAvatarPerformance, type PerformanceInput } from '../performance.mjs';
import { createAvatarPresence } from '../presence.mjs';
import { createVisibleSceneLoop, updateSceneDataset } from '../scene-loop.mjs';
import { bindCompanionGestures, portraitContains, portraitCoordinates } from '../../pet/interaction.mjs';
import { createCompanionFeedback } from '../../pet/gesture-feedback.mjs';
import { animePoseTransform } from '../anime-pose-render.mjs';
import { createCubismAvatar, type CubismAvatar } from './runtime.mjs';
import '../../pet/gesture-feedback.css';
import '../anime-scene.css';
import './cubism-scene.css';

export type CubismSceneProps = {
  modelUrl?: string; command?: PetCommand; compact?: boolean;
  onState?: (state: PetBehaviorState) => void; onReady?: () => void;
  onInteract?: (action: PetInteraction) => void; onFallback?: (reason: string) => void;
  interactive?: boolean; className?: string; speaking?: boolean; performanceInput?: PerformanceInput;
};
const clamp = (value: number) => Math.min(1, Math.max(-1, value));
const development = Boolean((import.meta as ImportMeta & { env?: { DEV?: boolean } }).env?.DEV);

/** A real Cubism surface, with the stable original character while loading or unsupported. */
export default function CubismScene(props: CubismSceneProps) {
  const { modelUrl = '/avatars/akari-cubism-v9/akari.model3.json', command, compact = false, interactive = true, className = '' } = props;
  const host = useRef<HTMLDivElement>(null);
  const callbacks = useRef(props); callbacks.current = props;
  const requested = useRef(command); requested.current = command;
  const quietInput = useRef<((input: PerformanceInput) => void) | undefined>(undefined);
  const readyCallbackSent = useRef(false);
  const [mode, setMode] = useState<'loading' | 'cubism' | 'fallback'>('loading');
  const ready = () => { if (!readyCallbackSent.current) { readyCallbackSent.current = true; callbacks.current.onReady?.(); } };

  useEffect(() => {
    const container = host.current;
    if (!container) return;
    // Each effect owns a distinct canvas/context. StrictMode or changing props
    // may cancel one asynchronous load while starting another on the same host.
    const surface = document.createElement('canvas'); container.appendChild(surface);
    surface.style.visibility = 'hidden'; surface.setAttribute('aria-hidden', 'true'); surface.tabIndex = -1;
    let disposed = false, inView = true, runtime: CubismAvatar | undefined;
    let action: PetAction = 'idle', time = 0, actionStart = 0, lastId = -1, last = 0, frames = 0, sequence = 0;
    let pointerX = 0, pointerY = 0, gazeX = 0, gazeY = 0;
    const abort = new AbortController(), performance = createAvatarPerformance(), presence = createAvatarPresence();
    const media = matchMedia('(prefers-reduced-motion: reduce)');
    const smallScreen = compact || matchMedia('(pointer: coarse)').matches;
    let localInput: PerformanceInput = { utteranceId: 'idle', text: '', phase: 'idle' };
    const loop = createVisibleSceneLoop(now => frame(now));
    setMode('loading'); readyCallbackSent.current = false;
    container.dataset.avatarMode = 'loading'; delete container.dataset.cubismFallbackReason;
    surface.dataset.renderer = 'webgl'; surface.dataset.avatarRenderer = 'cubism'; surface.dataset.petCount = '1';
    surface.setAttribute('role', interactive ? 'button' : 'img');
    surface.setAttribute('aria-label', interactive ? '二次元伙伴小伴。轻触回应，双击打招呼，长按休息；Enter 或空格也可操作。' : '二次元伙伴小伴');
    const emitState = () => callbacks.current.onState?.({ action, x: 0, facing: 1, lookX: gazeX, lookY: gazeY, actionTime: time - actionStart, actionProgress: 0, jumpHeight: 0, speed: 0, autonomous: false, paused: document.hidden || !inView, autonomyPaused: media.matches });
    const fail = (reason: string) => {
      if (disposed) return;
      loop.dispose(); surface.removeEventListener('webglcontextlost', lost);
      runtime?.release(); runtime = undefined; performance.reset(); presence.reset();
      container.dataset.avatarMode = 'fallback'; container.dataset.cubismFallbackReason = reason;
      surface.style.visibility = 'hidden'; surface.setAttribute('aria-hidden', 'true'); surface.tabIndex = -1;
      abort.abort(); setMode('fallback'); callbacks.current.onFallback?.(reason);
    };
    const resize = () => {
      const { width, height } = container.getBoundingClientRect();
      const ratio = Math.min(devicePixelRatio || 1, smallScreen ? 1.5 : 2);
      const nextWidth = Math.max(1, Math.min(2048, Math.round(width * ratio)));
      const nextHeight = Math.max(1, Math.min(2048, Math.round(height * ratio)));
      if (surface.width !== nextWidth) surface.width = nextWidth;
      if (surface.height !== nextHeight) surface.height = nextHeight;
    };
    const resizeObserver = typeof ResizeObserver === 'function' ? new ResizeObserver(resize) : undefined;
    resizeObserver?.observe(container); window.addEventListener('resize', resize); resize();
    const visibility = () => {
      const visible = !document.hidden && inView;
      last = 0;
      if (!visible) {
        performance.setInput(callbacks.current.performanceInput || localInput);
        const pose = performance.step(0, { hidden: true }); presence.reset();
        pointerX = pointerY = gazeX = gazeY = 0;
        runtime?.update(0, pose, presence.step(0, { hidden: true }), { hidden: true });
        updateSceneDataset(surface.dataset, { mouthOpen: '0.000', motionEnabled: 'false' });
      }
      loop.setActive(visible && Boolean(runtime));
    };
    quietInput.current = input => {
      if (!document.hidden && inView) return;
      performance.setInput(input); performance.step(0, { hidden: true });
    };
    const intersection = typeof IntersectionObserver === 'function' ? new IntersectionObserver(entries => { inView = entries[0]?.isIntersecting !== false; visibility(); }) : undefined;
    intersection?.observe(container); document.addEventListener('visibilitychange', visibility);
    const interact = (next: PetInteraction, userGesture = false) => {
      if (action === 'sleep' && next !== 'wake' && next !== 'sleep') return;
      action = next === 'wake' ? 'idle' : next as PetAction; actionStart = time;
      localInput = { utteranceId: `cubism-interaction-${++sequence}`, text: '', phase: 'idle' };
      if (next === 'sleep') performance.reset();
      else if (next === 'pet' || next === 'jump' || next === 'wake' && userGesture) {
        const kind = next === 'pet' ? 'pet' : next === 'jump' ? 'greet' : 'wake';
        performance.react({ id: String(sequence), kind }); runtime?.react(kind);
      }
      emitState(); if (userGesture) callbacks.current.onInteract?.(next);
    };
    const feedback = createCompanionFeedback(container, { motionQuery: media });
    const unbind = bindCompanionGestures(surface, {
      enabled: () => interactive && Boolean(runtime) && !disposed && surface.getAttribute('aria-hidden') !== 'true',
      hitTest: (x, y) => portraitContains(portraitCoordinates(container.getBoundingClientRect(), x, y)),
      getAction: () => action, emit: next => interact(next, true),
      onPointer: (x, y) => { const rect = container.getBoundingClientRect(); pointerX = clamp((x - rect.left) / Math.max(1, rect.width) * 2 - 1); pointerY = clamp(1 - (y - rect.top) / Math.max(1, rect.height) * 2); },
      onLeave: () => { pointerX = pointerY = 0; }, onFeedback: value => feedback.update(value, surface),
    });
    const lost = (event: Event) => { event.preventDefault(); fail('webgl-context-lost'); };
    surface.addEventListener('webglcontextlost', lost);
    const frame = (now: number) => {
      if (disposed || !runtime || document.hidden || !inView) return;
      if (last && now - last < 1000 / 30) return;
      const elapsed = last ? Math.max(0, (now - last) / 1000) : 0; last = now; time += elapsed;
      const next = requested.current;
      if (next && next.id !== lastId) { lastId = next.id; interact(next.action); }
      if (action !== 'sleep' && action !== 'idle' && time - actionStart > (action === 'eat' ? 4 : 2.7)) interact('wake');
      const sleeping = action === 'sleep', supplied = callbacks.current.performanceInput;
      const input = sleeping ? supplied || { utteranceId: 'sleep', text: '', phase: 'idle' as const } : supplied && (supplied.phase !== 'idle' || action === 'idle') ? supplied : localInput;
      performance.setInput(input);
      const pose = performance.step(elapsed, { reducedMotion: media.matches, sleeping });
      const follow = presence.step(elapsed, { gazeX: clamp(pointerX + pose.gazeOffsetX), gazeY: clamp(pointerY + pose.gazeOffsetY), headTilt: pose.headTilt, headNod: pose.headNod, voiceEnergy: pose.voiceEnergy, phase: input.phase, reducedMotion: media.matches, sleeping });
      const body = animePoseTransform(pose, { sleeping, reducedMotion: media.matches });
      // Head/eye/body rotation and gaze follow belong to the actual MOC rig.
      // Only rigid lift/approach remain outside it; never apply the same pose twice.
      surface.style.transform = `translateY(${body.yPercent}%) scale(${body.scale})`;
      gazeX = follow.gazeX; gazeY = follow.gazeY;
      try {
        runtime.update(elapsed, pose, follow, {
          sleeping, reducedMotion: media.matches, utteranceId: input.utteranceId, phase: input.phase,
          speechActive: input.speech ? input.speech.active && !input.speech.ended : undefined,
        });
        runtime.render();
      }
      catch (error) { if (development) console.error('PetPal Cubism frame failed:', error); fail(error instanceof Error ? error.message : 'render-failed'); return; }
      updateSceneDataset(surface.dataset, {
        renderFrames: String(++frames), phase: input.phase, petAction: action, petReady: 'true', expression: pose.expression,
        mouthOpen: (sleeping ? 0 : pose.mouthOpen).toFixed(3), mouthShape: pose.mouthShape,
        blinkLeft: (sleeping ? 1 : pose.blinkLeft).toFixed(3), blinkRight: (sleeping ? 1 : pose.blinkRight).toFixed(3),
        speechSource: input.speech ? 'playback-progress' : 'text-progress', gesture: pose.gesture, gestureCueId: pose.gestureCueId, microExpression: pose.microExpression,
        avatarPresence: 'cubism', gazeX: gazeX.toFixed(3), gazeY: gazeY.toFixed(3), headFollowX: follow.headX.toFixed(3), headFollowY: follow.headY.toFixed(3),
        motionGroup: runtime.motionGroup,
        breath: follow.breath.toFixed(3), motionEnabled: String(!media.matches && !sleeping), mocVersion: String(runtime.mocVersion), coreVersion: String(runtime.coreVersion),
      });
      if (frames === 1) { surface.style.visibility = 'visible'; surface.removeAttribute('aria-hidden'); surface.tabIndex = interactive ? 0 : -1; container.dataset.avatarMode = 'cubism'; setMode('cubism'); ready(); emitState(); }
    };
    void createCubismAvatar({ canvas: surface, modelUrl, signal: abort.signal, compact: smallScreen }).then(avatar => {
      if (disposed || abort.signal.aborted) { surface.removeEventListener('webglcontextlost', lost); avatar.release(); return; }
      runtime = avatar; visibility();
      container.dataset.cubismSupportedParameters = avatar.supportedParameters.join(',');
    }).catch(error => { if (!disposed && !abort.signal.aborted) fail(error instanceof Error ? error.message : 'load-failed'); });
    return () => {
      disposed = true; quietInput.current = undefined; abort.abort(); loop.dispose();
      surface.removeEventListener('webglcontextlost', lost); runtime?.release(); runtime = undefined;
      performance.reset(); presence.reset(); unbind(); feedback.dispose(); resizeObserver?.disconnect(); intersection?.disconnect();
      document.removeEventListener('visibilitychange', visibility); window.removeEventListener('resize', resize);
      surface.remove();
    };
  }, [modelUrl, compact, interactive]);

  useEffect(() => { if (props.performanceInput) quietInput.current?.(props.performanceInput); }, [props.performanceInput]);
  return <div ref={host} className={`pet-three-scene anime-scene cubism-scene ${className}`} data-character-style={['/avatars/akari-cubism-v7/akari.model3.json', '/avatars/akari-cubism-v8/akari.model3.json', '/avatars/akari-cubism-v9/akari.model3.json'].includes(modelUrl) ? 'akari-soft' : undefined}>
    {mode !== 'cubism' && <AnimeScene {...props} className="cubism-fallback" onReady={ready} />}
  </div>;
}
