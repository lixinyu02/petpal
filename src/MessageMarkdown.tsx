import { lazy, memo, Suspense } from 'react';
import './message-markdown.css';
export { safeMarkdownUrl } from './markdown-url';
const Renderer = lazy(() => import('./MessageMarkdownRenderer'));

function MessageMarkdown({content,compact=false}:{content:string;compact?:boolean}) {
  const fallback = <div className={`message-markdown${compact?' message-markdown-compact':''}`} aria-busy="true"><span style={{whiteSpace:'pre-wrap'}}>{content}</span></div>;
  return <Suspense fallback={fallback}><Renderer content={content} compact={compact}/></Suspense>;
}
export default memo(MessageMarkdown);
