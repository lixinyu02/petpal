/** Pure aggregation. Preserve the original per-sample JSON/gfx/meminfo files. */
export function quantile(items,q){if(!items.length)return null;const ordered=[...items].sort((a,b)=>a-b);return ordered[Math.max(0,Math.ceil(q*ordered.length)-1)];}
export function frameStats(items){return{count:items.length,p50Ms:quantile(items,.5),p95Ms:quantile(items,.95),p99Ms:quantile(items,.99),maxMs:items.length?Math.max(...items):null,over33Ms:items.filter(n=>n>33.34).length,over50Ms:items.filter(n=>n>50).length};}
export function parseMemory(text){const entry=label=>{const match=text.match(new RegExp('^\\s*'+label+'\\s*:\\s*(\\d+)','m'));return match?Number(match[1]):null;};return{totalPssKb:entry('TOTAL PSS'),javaHeapPssKb:entry('Java Heap'),nativeHeapPssKb:entry('Native Heap'),graphicsPssKb:entry('Graphics'),rendererProcessMemoryMeasured:false};}
export function parseGfx(text){
 const metric=label=>{const escaped=label.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),match=text.match(new RegExp('^'+escaped+':\\s*(\\d+)(?:\\s*\\(([\\d.]+)%\\))?','m'));return match?{count:Number(match[1]),percent:match[2]?Number(match[2]):null}:null;};
 const durations=[];let columns;
 for(const input of text.split(/\r?\n/)){
  const line=input.trim();
  if(line.startsWith('Flags,')&&line.includes('IntendedVsync')&&line.includes('FrameCompleted')){columns=line.split(',');continue;}
  if(!columns||!/^\d+,/.test(line))continue;
  const row=line.split(','),flag=Number(row[columns.indexOf('Flags')]),start=Number(row[columns.indexOf('IntendedVsync')]),end=Number(row[columns.indexOf('FrameCompleted')]);
  if(flag===0&&Number.isSafeInteger(start)&&start>0&&Number.isSafeInteger(end)&&end>start)durations.push((end-start)/1e6);
 }
 return{total:metric('Total frames rendered'),janky:metric('Janky frames'),legacyJanky:metric('Janky frames (legacy)'),nativeFrameCompletion:frameStats(durations),nativeFramesIncludeWebViewComposition:true,webRendererFramesNotEquivalent:true,frameRowsMayBeBoundedByPlatformRingBuffer:true};
}
export function summarizeSample(result,gfxText,before,after){return{stage:result.stage,iteration:result.iteration,durationMs:result.durationMs,startupToUsableMs:result.nativeStartupToUsableMs??null,raf:frameStats(result.rafIntervalsMs),longTaskSupported:result.longTaskSupported,longTaskCount:result.longTasks.length,longTaskTotalMs:result.longTasks.reduce((sum,item)=>sum+item.duration,0),longTaskOver50Ms:result.longTasks.reduce((sum,item)=>sum+Math.max(0,item.duration-50),0),longTaskMaxMs:result.longTasks.length?Math.max(...result.longTasks.map(item=>item.duration)):0,reactCommitCountSupported:result.reactCommitCountSupported,reactCommits:result.reactCommits,reactCommitDurationsSupported:false,firstTextMs:result.firstTextMs,finalTextMatches:result.finalTextMatches??null,finalCharacters:result.finalCharacters??null,mutationBatches:result.mutationBatches,nodesBefore:result.nodesBefore,nodesAfter:result.nodesAfter,scrollEvents:result.scrollEvents,scrollRange:result.scrollRange,memoryBefore:before?parseMemory(before):null,memoryAfter:parseMemory(after),gfx:parseGfx(gfxText),hiddenObserved:result.hiddenObserved,valid:result.valid,blockedExternalRequests:result.blockedExternalRequests};}
