import Markdown from 'react-markdown';
import { memo } from 'react';
import remarkGfm from 'remark-gfm';
import './message-markdown.css';

/** Links are user initiated; Markdown images remain labels, never tracking requests. */
export function safeMarkdownUrl(value:string):string {
  if (/[\u0000-\u0020\u007f]/u.test(value)) return '';
  try {
    const url=new URL(value,'https://petpal.invalid');
    return ['http:','https:','mailto:'].includes(url.protocol)?value:'';
  } catch { return ''; }
}

function MessageMarkdown({content,compact=false}:{content:string;compact?:boolean}) {
  return <div className={`message-markdown${compact?' message-markdown-compact':''}`}>
    <Markdown remarkPlugins={[remarkGfm]} skipHtml urlTransform={safeMarkdownUrl} components={{
      a:({href,children,title})=>href?<a href={href} title={title} target="_blank" rel="noopener noreferrer">{children}</a>:<span>{children}</span>,
      img:({alt})=><span className="markdown-image-label">{alt?`图片：${alt}`:'图片'}</span>,
      table:({children})=><div className="markdown-table-scroll" role="region" aria-label="回复中的表格" tabIndex={0}><table>{children}</table></div>,
      input:({checked})=><input type="checkbox" checked={!!checked} disabled aria-label={checked?'已完成':'未完成'}/>,
    }}>{content}</Markdown>
  </div>;
}
export default memo(MessageMarkdown);
