import Markdown, {type Components} from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { safeMarkdownUrl } from './markdown-url';

// Component types must survive content updates. Inline functions here remount
// the existing table/link subtrees on every streamed append, losing focus/scroll.
const components:Components={
      a:({href,children,title})=>href?<a href={href} title={title} target="_blank" rel="noopener noreferrer">{children}</a>:<span>{children}</span>,
      img:({alt})=><span className="markdown-image-label">{alt?`图片：${alt}`:'图片'}</span>,
      table:({children})=><div className="markdown-table-scroll" role="region" aria-label="回复中的表格" tabIndex={0}><table>{children}</table></div>,
      input:({checked})=><input type="checkbox" checked={!!checked} disabled aria-label={checked?'已完成':'未完成'}/>,
};
const remarkPlugins=[remarkGfm];

export default function MessageMarkdownRenderer({content,compact=false}:{content:string;compact?:boolean}) {
  return <div className={`message-markdown${compact?' message-markdown-compact':''}`}>
    <Markdown remarkPlugins={remarkPlugins} skipHtml urlTransform={safeMarkdownUrl} components={components}>{content}</Markdown>
  </div>;
}
