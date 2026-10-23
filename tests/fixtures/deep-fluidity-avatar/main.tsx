import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import CompanionScene from '../../../src/avatar/CompanionScene';
import '../../../src/styles.css';
import '../../../src/theme.css';
import '../../../src/ui-motion.css';
import '../../../src/ui-polish.css';
import './style.css';

// Only the real character subtree is counted. Controls, report text and the
// workload's own geometry read do not contribute to these instrumentation totals.
const counters = { rafScheduled: 0, rafCallbacks: 0, rectReads: 0, attributeMutations: 0, datasetMutations: 0, styleMutations: 0, pointerEvents: 0, trustedPointerEvents: 0 };
let character: HTMLElement | null = null, readyAt: number | null = null, observer: MutationObserver | undefined;
let instrumentationRead = false, running: Sample | null = null, sampleTimer = 0, pointerTimer = 0;
const attributeNames: Record<string, number> = {}, rectElements: Record<string, number> = {};
const longTasks: { startTime: number; duration: number }[] = [], errors: string[] = [], samples: object[] = [];
const visibility = [{ at: performance.now(), state: document.visibilityState }];
const originalRect = Element.prototype.getBoundingClientRect;
const originalRaf = window.requestAnimationFrame.bind(window);
performance.setResourceTimingBufferSize(2000);
const belongs = (node: Node) => Boolean(character && (node === character || character.contains(node)));
Element.prototype.getBoundingClientRect = function (...args) {
  if (!instrumentationRead && belongs(this)) {
    counters.rectReads++;
    const key = `${this.tagName.toLowerCase()}.${typeof this.className === 'string' ? this.className : ''}`;
    rectElements[key] = (rectElements[key] || 0) + 1;
  }
  return originalRect.apply(this, args);
};
window.requestAnimationFrame = callback => {
  counters.rafScheduled++;
  return originalRaf(now => { counters.rafCallbacks++; callback(now); });
};
const takeMutations = (records: MutationRecord[]) => {
  for (const record of records) {
    if (!belongs(record.target) || !record.attributeName) continue;
    const name = record.attributeName;
    counters.attributeMutations++;
    if (name === 'style') counters.styleMutations++;
    if (name.startsWith('data-')) counters.datasetMutations++;
    attributeNames[name] = (attributeNames[name] || 0) + 1;
  }
};
try { new PerformanceObserver(list => { for (const item of list.getEntries()) if (longTasks.length < 10000) longTasks.push({ startTime: item.startTime, duration: item.duration }); }).observe({ type: 'longtask', buffered: true }); } catch { /* Report support explicitly. */ }
window.addEventListener('error', event => errors.push(String(event.message).slice(0, 500)));
window.addEventListener('unhandledrejection', event => errors.push(String(event.reason?.message || event.reason).slice(0, 500)));
document.addEventListener('visibilitychange', () => {
  visibility.push({ at: performance.now(), state: document.visibilityState });
  if (running && document.hidden) running.hidden = true;
});
const flush = () => { if (observer) takeMutations(observer.takeRecords()); };
const snap = () => { flush(); return { ...counters }; };
const delta = (end: Record<string, number>, start: Record<string, number>) => Object.fromEntries(Object.keys(end).map(name => [name, end[name] - (start[name] || 0)]));
const surface = () => character?.querySelector<HTMLCanvasElement>('canvas[data-avatar-renderer="cubism"]');
const rendererState = () => {
  const canvas = surface();
  return { mode: character?.querySelector<HTMLElement>('.cubism-scene')?.dataset.avatarMode, renderer: canvas?.dataset.avatarRenderer, frames: Number(canvas?.dataset.renderFrames || 0), mocVersion: canvas?.dataset.mocVersion || '', coreVersion: canvas?.dataset.coreVersion || '', width: canvas?.width || 0, height: canvas?.height || 0, expression: canvas?.dataset.expression || '', gesture: canvas?.dataset.gesture || '', region: canvas?.dataset.interactionRegion || '' };
};
const resourceReport = () => performance.getEntriesByType('resource').filter(entry => /\/(?:avatars|vendor\/live2d)\//.test(entry.name)).map(entry => {
  const item = entry as PerformanceResourceTiming;
  return { path: new URL(item.name).pathname, initiatorType: item.initiatorType, startTime: item.startTime, fetchStart: item.fetchStart, requestStart: item.requestStart, responseStart: item.responseStart, responseEnd: item.responseEnd, duration: item.duration, transferSize: item.transferSize, encodedBodySize: item.encodedBodySize, decodedBodySize: item.decodedBodySize };
});
type Sample = { name: string; start: number; counters: typeof counters; attributes: Record<string, number>; rects: Record<string, number>; renderer: ReturnType<typeof rendererState>; hidden: boolean; pointer: boolean; dispatched: number };
const report = () => ({ schemaVersion: 1, fixture: 'real-cubism-isolated', scope: 'Production-built actual CompanionScene/CubismScene/V12/Core, synthetic state, no API/auth/voice backend', at: new Date().toISOString(), readyAt, navigationVisibility: visibility, visibility: document.visibilityState, devicePixelRatio, renderer: rendererState(), counters: snap(), attributeNames: { ...attributeNames }, rectElements: { ...rectElements }, longTaskSupported: PerformanceObserver.supportedEntryTypes?.includes('longtask') === true, longTasks, resources: resourceReport(), samples, errors, pointerMeaning: 'Synthetic sample dispatches PointerEvent at a target 120 Hz over a fixed head/hand/outside path; this is not physical input or CSS:hover verification', metricMeaning: 'renderFrames are completed component render calls, not physical display/GPU FPS; attribute totals are actual MutationObserver records' });
const status = () => {
  const target = document.getElementById('bench-status');
  if (target) target.textContent = `${document.visibilityState} · ${rendererState().mode || 'loading'} · ${rendererState().frames} frames · ${running ? `采样 ${running.name}` : readyAt === null ? '加载中' : '可采样'}`;
  for (const button of document.querySelectorAll<HTMLButtonElement>('[data-bench-start]')) button.disabled = readyAt === null || Boolean(running) || document.hidden;
};
async function saveReport() {
  const body = report();
  const target = document.getElementById('bench-report'); if (target) target.textContent = JSON.stringify(body, null, 2);
  const response = await fetch('/__bench/report', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!response.ok) throw new Error(`Report persistence failed (${response.status})`);
  const saved = await response.json();
  const output = document.getElementById('bench-saved'); if (output) output.textContent = `已保存 ${saved.file}`;
  return body;
}
function finishSample() {
  if (!running) return null;
  clearTimeout(sampleTimer); clearTimeout(pointerTimer);
  const sample = running; running = null;
  const end = performance.now(), current = rendererState(), endCounters = snap();
  const reasons = [];
  if (sample.hidden || document.hidden) reasons.push('document-hidden');
  if (current.mode !== 'cubism' || current.renderer !== 'cubism') reasons.push('not-real-cubism');
  if (current.width < 1 || current.height < 1 || current.frames <= sample.renderer.frames) reasons.push('no-render-progress');
  if (end - sample.start < 9900) reasons.push('shorter-than-10-seconds');
  const output = { name: sample.name, start: sample.start, end, durationMs: end - sample.start, valid: reasons.length === 0, invalidReasons: reasons, syntheticPointer: sample.pointer, dispatchedPointerEvents: sample.dispatched, startRenderer: sample.renderer, endRenderer: current, renderedFrameCounterDelta: current.frames - sample.renderer.frames, appRenderRateHz: (current.frames - sample.renderer.frames) * 1000 / (end - sample.start), counters: delta(endCounters, sample.counters), attributes: delta(attributeNames, sample.attributes), rectElements: delta(rectElements, sample.rects), longTasks: longTasks.filter(task => task.startTime >= sample.start && task.startTime < end) };
  samples.push(output); status(); void saveReport().catch(error => errors.push(String(error.message)));
  return output;
}
function startSample(name = 'idle-10s', pointer = false) {
  if (running || readyAt === null || document.hidden || rendererState().mode !== 'cubism') throw new Error('A visible ready Cubism scene is required');
  const sample: Sample = { name, start: performance.now(), counters: snap(), attributes: { ...attributeNames }, rects: { ...rectElements }, renderer: rendererState(), hidden: document.hidden, pointer, dispatched: 0 };
  running = sample; status();
  sampleTimer = window.setTimeout(finishSample, 10000);
  if (pointer) {
    const canvas = surface()!;
    instrumentationRead = true; const rect = canvas.getBoundingClientRect(); instrumentationRead = false;
    const portraitWidth = Math.min(rect.width * .92, rect.height / 1.5 * .96);
    const begin = performance.now(); let next = begin;
    const tick = () => {
      if (running !== sample) return;
      const elapsed = performance.now() - begin, t = Math.min(9.999, elapsed / 1000);
      const hand = t >= 3 && t < 6, outside = t >= 9;
      const x = outside ? .99 : .5 + Math.sin(t * Math.PI * 2) * (hand ? .025 : .055), y = outside ? .5 : hand ? .889 : .25;
      canvas.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, pointerId: 37, pointerType: 'mouse', isPrimary: true, buttons: 0, clientX: rect.left + rect.width / 2 + (x - .5) * portraitWidth, clientY: rect.top + rect.height / 2 + (y - .5) * portraitWidth * 1.5 }));
      sample.dispatched++; next += 1000 / 120;
      if (next < performance.now() - 1000 / 120) next = performance.now();
      pointerTimer = window.setTimeout(tick, Math.max(0, next - performance.now()));
    };
    tick();
  }
  return { name, targetDurationMs: 10000, syntheticPointer: pointer };
}
Object.assign(window, { __avatarBench: { startSample, finishSample, report, saveReport, rendererState } });
function App() {
  const [ready, setReady] = useState(false);
  return <>
    <header className="bench-toolbar"><strong>真实 Cubism · 隔离性能夹具</strong><span id="bench-status" role="status">加载中</span><div>
      <button data-testid="idle-sample" data-bench-start disabled={!ready} onClick={() => startSample('idle-10s')}>静置采样 10 秒</button>
      <button data-testid="pointer-sample" data-bench-start disabled={!ready} onClick={() => startSample('synthetic-pointer-120hz-10s', true)}>固定指针负载 10 秒</button>
      <button data-testid="manual-sample" data-bench-start disabled={!ready} onClick={() => startSample('manual-pointer-10s')}>真实鼠标采样 10 秒</button>
      <button data-testid="save-report" onClick={() => void saveReport()}>保存报告</button><button onClick={finishSample}>提前结束（无效样本）</button>
      <label>主题 <select aria-label="夹具主题" onChange={event => { document.documentElement.dataset.theme = event.target.value; }}><option value="day">浅色</option><option value="night">深色</option></select></label>
    </div></header>
    <main className="companion-world companion-anime bench-world"><section className="companion-space"><div className="companion-stage"><div className="bench-character" ref={node => {
      if (!node || character === node) return; character = node;
      observer?.disconnect(); observer = new MutationObserver(takeMutations); observer.observe(node, { attributes: true, subtree: true });
      node.addEventListener('pointermove', event => { counters.pointerEvents++; if (event.isTrusted) counters.trustedPointerEvents++; }, { capture: true, passive: true });
    }}><CompanionScene onReady={() => { if (rendererState().mode === 'cubism' && readyAt === null) readyAt = performance.now(); setReady(true); queueMicrotask(status); }}/></div></div></section></main>
    <footer className="bench-footer"><span id="bench-saved">不连接账号、后端或上游服务；切到后台的样本无效。</span><details><summary>查看当前报告</summary><pre id="bench-report"/></details></footer>
  </>;
}
createRoot(document.getElementById('root')!).render(<React.StrictMode><App/></React.StrictMode>);
window.setInterval(status, 1000);
