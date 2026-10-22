import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';

const parser=unified().use(remarkParse).use(remarkGfm);
const blocks=new Set(['root','blockquote','list','listItem','table','tableRow']);

/** Speak textual Markdown content, never markup, raw HTML or link destinations. */
export function markdownSpeechText(value) {
  if(typeof value!=='string')return '';
  function plain(node) {
    if(node.type==='html'||node.type==='definition'||node.type==='thematicBreak')return '';
    if(node.type==='image'||node.type==='imageReference')return node.alt||'';
    if(node.type==='break')return '\n';
    // The parser already consumes actual Markdown delimiters. Text/code values
    // may legitimately contain operators, identifiers or escaped delimiters.
    if(node.type==='text')return node.value;
    // OpenUI is a presentation program, not spoken prose (also on truncated
    // replies or examples nested in lists/quotes). Other code keeps its meaning.
    if(node.type==='code'&&node.lang?.toLowerCase()==='openui')return '';
    if(node.type==='code'||node.type==='inlineCode')return node.value;
    if(!node.children)return '';
    return node.children.map(plain).join(node.type==='tableRow'?'，':blocks.has(node.type)?'\n':'');
  }
  return plain(parser.parse(value)).replace(/\n{3,}/gu,'\n\n').trim();
}

/** Do not split sentence punctuation or size bounds inside Markdown destinations/code. */
export function markdownSafeCuts(text) {
  const emphasis=new Map(),fences=new Map();
  const remember=node=>{
    const start=node.position?.start.offset,end=node.position?.end.offset;
    if(['emphasis','strong','delete'].includes(node.type))emphasis.set(start,Math.max(end,emphasis.get(start)||0));
    if(node.type==='code') {
      const opening=/^(`{3,}|~{3,})[^\n]*(?:\n|$)/.exec(text.slice(start,end));
      if(opening) {
        // Use the parser's fenced span, not the first matching substring: DSL
        // strings may contain ``` or ~~~ without ending their enclosing block.
        const lineStart=text.lastIndexOf('\n',start-1)+1;
        const prefix=text.slice(lineStart,start);
        const quoteCount=(prefix.match(/>/g)||[]).length;
        const lastLine=text.slice(text.lastIndexOf('\n',end-1)+1,end).replace(/\r$/,'');
        const closing=new RegExp(`^[ \\t]*(?:>[ \\t]*){${quoteCount}}${opening[1][0]}{${opening[1].length},}[ \\t]*$`);
        // Wait for a newline after the closing delimiter. At a chunk boundary,
        // ``` may still become ```not-a-close as the next token arrives.
        const endedLine=text[end]==='\n'||text[end]==='\r'&&text[end+1]==='\n';
        // Keep container prefixes too; cutting off `> ` would turn a quoted
        // closing fence into code content and swallow the following prose.
        fences.set(lineStart,{end,closed:end>start+opening[0].length&&closing.test(lastLine)&&endedLine});
      }
    }
    for(const child of node.children||[])remember(child);
  };
  remember(parser.parse(text));
  const cuts=[];let i=0;
  while(i<text.length) {
    if(fences.has(i)) {const fence=fences.get(i);if(!fence.closed)return cuts;i=fence.end;cuts.push(i);continue;}
    if(text[i]==='\\'&&i+1<text.length){i+=2;cuts.push(i);continue;}
    if(text[i]==='*'||text[i]==='_'||(text[i]==='~'&&text[i+1]==='~')) {
      const marker=text[i];let count=1;while(text[i+count]===marker)count++;
      if(emphasis.has(i)){i=emphasis.get(i);cuts.push(i);continue;}
      const before=text[i-1]||'',after=text[i+count]||'';
      const intraword=marker==='_'&&/[\p{L}\p{N}]/u.test(before)&&/[\p{L}\p{N}]/u.test(after);
      const arithmetic=/\d/u.test(before)&&/\d/u.test(after);
      const opens=!after||(!/^\s$/u.test(after)&&(!/[\p{P}\p{S}]/u.test(after)||!before||/[\s\p{P}\p{S}]/u.test(before)));
      if(!intraword&&!arithmetic&&opens) {
        // Keep an unfinished emphasis span until a later delta closes it. If
        // the reply ends first, parse it as literal text rather than deleting it.
        return cuts;
      }
      i+=count;cuts.push(i);continue;
    }
    if(text[i]==='`'||(text[i]==='~'&&(i===0||text[i-1]==='\n'))) {
      const marker=text[i];let count=1;while(text[i+count]===marker)count++;
      const token=marker.repeat(count),end=text.indexOf(token,i+count);
      if(end<0)return cuts;
      i=end+count;cuts.push(i);continue;
    }
    if(text[i]==='['||(text[i]==='!'&&text[i+1]==='[')) {
      const start=text[i]==='!'?i+1:i;let end=start+1,depth=1;
      for(;end<text.length&&depth;end++){if(text[end]==='\\'){end++;continue;}if(text[end]==='[')depth++;if(text[end]===']')depth--;}
      if(depth||end===text.length)return cuts;
      if(text[end]==='('||text[end]==='[') {
        const opening=text[end],closing=opening==='('?')':']';let level=1;end++;
        for(;end<text.length&&level;end++){if(text[end]==='\\'){end++;continue;}if(text[end]===opening)level++;if(text[end]===closing)level--;}
        if(level)return cuts;
      }
      i=end;cuts.push(i);continue;
    }
    if(text[i]==='<') {const end=text.indexOf('>',i+1);if(end<0)return cuts;i=end+1;cuts.push(i);continue;}
    i++;if(i<text.length&&/^[\uDC00-\uDFFF]$/u.test(text[i]))i++;
    cuts.push(i);
  }
  return cuts;
}
