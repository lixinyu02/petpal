import { lazy, memo, Suspense, useMemo } from 'react';
import MessageMarkdown from '../MessageMarkdown';
import { isOpenUIMode, splitOpenUI, type OutputRendering } from './protocol.mjs';
import './openui.css';

const OpenUIBlock = lazy(() => import('./OpenUIBlock').catch(() => ({default: ({source}: {source: string}) => <div>
  <p className="openui-notice" role="status">交互组件暂时未能加载，已显示原文。</p>
  <MessageMarkdown content={'```openui\n' + source + '\n```'}/>
</div>})));
type Props = { content: string; mode?: OutputRendering; status?: string; onUseInPrompt?: (text: string) => void };
export default memo(function AssistantOutput({content, mode = 'markdown', status, onUseInPrompt}: Props) {
  const streaming = status === 'streaming';
  const parsed = useMemo(() => isOpenUIMode(mode) && /^ {0,3}(?:`{3,}|~{3,})openui\s*$/m.test(content)
    ? splitOpenUI(content, { streaming }) : null, [content, mode, streaming]);
  if (!parsed || !parsed.parts.some(part => part.type === 'openui')) return <>
    {parsed?.error && <p className="openui-notice" role="status">{parsed.error}</p>}
    <MessageMarkdown content={content}/>
  </>;
  return <div className="assistant-output" data-output-renderer="openui">{parsed.parts.map((part, index) => part.type === 'markdown'
    ? <MessageMarkdown key={`prose-${index}`} content={part.text}/>
    : <Suspense key={`ui-${index}`} fallback={<div className="openui-loading" role="status">正在准备交互界面…</div>}>
      <OpenUIBlock source={part.text} streaming={streaming} complete={status === 'complete'} onUseInPrompt={onUseInPrompt}/>
    </Suspense>)}</div>;
});
