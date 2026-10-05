import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';

const bundle=await build({entryPoints:[fileURLToPath(new URL('../src/ConversationHistory.tsx',import.meta.url))],bundle:true,write:false,format:'cjs',platform:'node',loader:{'.css':'empty'},external:['react','react-dom','react/jsx-runtime','react/jsx-dev-runtime']});
const compiled={exports:{}};new Function('require','module','exports',bundle.outputFiles[0].text)(createRequire(import.meta.url),compiled,compiled.exports);
const {default:ConversationHistory,ConversationHistoryRow,sameConversationHistory,filterHistoryConversations,historyProjectCounts}=compiled.exports;
const item=(id,extra={})=>({id,title:`对话 ${id}`,mode:'chat',messages:[{id:'m',role:'assistant',content:'旧内容'}],...extra});
const projects=[{id:'work',name:'工作',createdAt:'before',updatedAt:'before'},{id:'life',name:'日常',createdAt:'before',updatedAt:'before'}];
const base={conversations:[item('one'),item('two',{mode:'codex'})],projects,projectFilter:'all',archived:false,selectedId:'one',active:true,busy:false,onFilter(){},onSelect(){},onDelete(){},async onOrganize(){},async onCreateProject(){},async onRenameProject(){},async onDeleteProject(){}};

test('voice ticks and streaming content do not invalidate navigation labels',()=>{
  assert.equal(ConversationHistory.$$typeof,Symbol.for('react.memo'));assert.equal(ConversationHistoryRow.$$typeof,Symbol.for('react.memo'));
  const next={...base,conversations:base.conversations.map(conversation=>({...conversation,messages:[{id:'m',role:'assistant',content:'持续增长的流式内容'}],updatedAt:'later',agent:{revision:100}}))};
  assert.equal(sameConversationHistory(base,next),true);
});

test('selection, title, mode, order, deletion and current callback guards remain observable',()=>{
  for(const next of [
    {...base,selectedId:'two'}, {...base,active:false}, {...base,busy:true},
    {...base,onSelect(){}}, {...base,onDelete(){}}, {...base,onFilter(){}}, {...base,onOrganize(){}}, {...base,onCreateProject(){}}, {...base,onRenameProject(){}}, {...base,onDeleteProject(){}},
    {...base,conversations:[item('one',{title:'已重命名'}),base.conversations[1]]},
    {...base,conversations:[item('one',{mode:'codex'}),base.conversations[1]]},
    {...base,conversations:[...base.conversations].reverse()},
    {...base,conversations:[base.conversations[0]]},
    {...base,conversations:[item('replacement'),base.conversations[1]]},
  ])assert.equal(sameConversationHistory(base,next),false);
});

test('history exposes the selected conversation and escapes labels without rendering message bodies',()=>{
  const html=renderToStaticMarkup(createElement(ConversationHistory,{...base,conversations:[item('one',{title:'<script>标题</script>',messages:[{content:'PRIVATE_MESSAGE_CONTENT'}]}),base.conversations[1]]}));
  assert.equal((html.match(/aria-current="page"/g)||[]).length,1);
  assert.ok(html.includes('&lt;script&gt;标题&lt;/script&gt;'));assert.equal(html.includes('PRIVATE_MESSAGE_CONTENT'),false);
  assert.ok(html.includes('aria-label="对话 &lt;script&gt;标题&lt;/script&gt; 的更多操作"'));
  assert.ok(html.includes('aria-haspopup="dialog"'));
  assert.equal(renderToStaticMarkup(createElement(ConversationHistory,{...base,active:false})).includes('aria-current="page"'),false);
});

test('task activity leaves organization entry points available and empty history retains the welcome cue',()=>{
  const busy=renderToStaticMarkup(createElement(ConversationHistory,{...base,busy:true}));
  assert.equal((busy.match(/class="history-more icon-button"/g)||[]).length,2);
  assert.equal((busy.match(/disabled=""/g)||[]).length,0);
  const empty=renderToStaticMarkup(createElement(ConversationHistory,{...base,conversations:[]}));assert.ok(empty.includes('我们的故事，从一句你好开始。'));assert.equal(empty.includes('history-item'),false);
});

test('project and archive changes invalidate labels while project timestamps remain inexpensive',()=>{
  for(const next of [
    {...base,projectFilter:'work'}, {...base,archived:true},
    {...base,projects:[{...projects[0],name:'新的项目名'},projects[1]]},
    {...base,projects:[...projects].reverse()}, {...base,projects:[projects[0]]},
    {...base,conversations:[item('one',{projectId:'work'}),base.conversations[1]]},
    {...base,conversations:[item('one',{archivedAt:'now'}),base.conversations[1]]},
    {...base,conversations:[item('one',{backgroundParentId:'parent'}),base.conversations[1]]},
  ])assert.equal(sameConversationHistory(base,next),false);
  assert.equal(sameConversationHistory(base,{...base,projects:projects.map(project=>({...project,updatedAt:'later'}))}),true);
  assert.equal(sameConversationHistory(base,{...base,conversations:base.conversations.map(conversation=>({...conversation,projectId:null,archivedAt:null}))}),true);
});

test('archive and project filters exclude private background task conversations',()=>{
  const conversations=[item('unassigned'),item('work',{projectId:'work'}),item('archive-work',{projectId:'work',archivedAt:'today'}),item('archive-life',{projectId:'life',archivedAt:'today'}),item('child',{projectId:'work',backgroundParentId:'work'})];
  const ids=value=>value.map(item=>item.id);
  assert.deepEqual(ids(filterHistoryConversations(conversations,'all',false)),['unassigned','work']);
  assert.deepEqual(ids(filterHistoryConversations(conversations,'unassigned',false)),['unassigned']);
  assert.deepEqual(ids(filterHistoryConversations(conversations,'work',false)),['work']);
  assert.deepEqual(ids(filterHistoryConversations(conversations,'all',true)),['archive-work','archive-life']);
  assert.deepEqual(ids(filterHistoryConversations(conversations,'work',true)),['archive-work']);
  assert.deepEqual(ids(filterHistoryConversations(conversations,'missing',false)),[]);
  assert.deepEqual(historyProjectCounts(conversations,projects,false),{all:2,unassigned:1,work:1,life:0});
  assert.deepEqual(historyProjectCounts(conversations,projects,true),{all:2,unassigned:0,work:1,life:1});
});

test('project selector shows scoped counts and archived view does not expose current labels',()=>{
  const conversations=[item('one',{projectId:'work'}),item('archived',{projectId:'work',archivedAt:'today'}),item('private-child',{backgroundParentId:'one'})];
  const html=renderToStaticMarkup(createElement(ConversationHistory,{...base,conversations,archived:true,projectFilter:'work'}));
  assert.ok(html.includes('aria-label="筛选对话项目"'));
  assert.ok(html.includes('<option value="work" selected="">工作 · 1</option>'));
  assert.ok(html.includes('aria-label="已归档对话"'));
  assert.ok(html.includes('对话 archived'));
  assert.equal(html.includes('对话 one'),false);assert.equal(html.includes('private-child'),false);
  assert.equal((html.match(/aria-pressed="true"/g)||[]).length,1);
});

test('project names are escaped and account project limit disables only creation',()=>{
  const many=Array.from({length:50},(_,index)=>({...projects[0],id:`p${index}`,name:index===0?'<img onerror=secret>':`项目 ${index}`}));
  const html=renderToStaticMarkup(createElement(ConversationHistory,{...base,projects:many}));
  assert.ok(html.includes('&lt;img onerror=secret&gt;'));
  assert.equal((html.match(/disabled=""/g)||[]).length,1);
  assert.ok(html.includes('aria-label="管理项目"'));
  const empty=renderToStaticMarkup(createElement(ConversationHistory,{...base,conversations:[],archived:true}));assert.ok(empty.includes('这里还没有归档的对话。'));
});
