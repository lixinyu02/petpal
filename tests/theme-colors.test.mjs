import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import postcss from 'postcss';

const sheet=postcss.parse(await readFile(new URL('../src/theme.css',import.meta.url),'utf8'));
const day={},night={};
sheet.walkRules(rule=>{if(rule.selector!==':root'&&rule.selector!=='html[data-theme="night"]')return;for(const declaration of rule.nodes||[])if(declaration.type==='decl'&&declaration.prop.startsWith('--theme-'))(rule.selector===':root'?day:night)[declaration.prop]=declaration.value;});
const palette=theme=>({...day,...(theme==='night'?night:{})});
const luminance=value=>{assert.match(value,/^#[\da-f]{6}$/i,'contrast inputs must be concrete opaque sRGB colours');const [r,g,b]=value.slice(1).match(/../g).map(channel=>{const x=parseInt(channel,16)/255;return x<=.04045?x/12.92:((x+.055)/1.055)**2.4;});return .2126*r+.7152*g+.0722*b;};
const contrast=(a,b)=>{const left=luminance(a),right=luminance(b);return (Math.max(left,right)+.05)/(Math.min(left,right)+.05);};

for(const theme of ['day','night'])test(`${theme} semantic text remains readable on every standard panel and input`,()=>{
 const colors=palette(theme);for(const text of ['ink','muted','accent','danger','warning','success'])for(const surface of ['surface','raised','soft','input'])assert.ok(contrast(colors[`--theme-${text}`],colors[`--theme-${surface}`])>=4.5,`${theme} ${text} on ${surface}: ${contrast(colors[`--theme-${text}`],colors[`--theme-${surface}`]).toFixed(2)}`);
 for(const state of ['danger','warning','success'])assert.ok(contrast(colors[`--theme-${state}`],colors[`--theme-${state}-soft`])>=4.5,`${theme} ${state} status text`);
});

for(const theme of ['day','night'])test(`${theme} field boundaries and focus indicators remain visible`,()=>{
 const colors=palette(theme);for(const surface of ['surface','raised','input']){assert.ok(contrast(colors['--theme-control-border'],colors[`--theme-${surface}`])>=3,`${theme} field boundary on ${surface}`);assert.ok(contrast(colors['--theme-focus'],colors[`--theme-${surface}`])>=3,`${theme} focus on ${surface}`);}
});

test('the pale default and neutral night surface do not alter theme preference state',()=>{
 assert.equal(day['--theme-surface'],'#fafbf8');assert.equal(night['--theme-surface'],'#282828');assert.ok(!Object.hasOwn(day,'--theme-preference'));assert.ok(!Object.hasOwn(night,'--theme-preference'));
});

for(const theme of ['day','night'])test(`${theme} action labels, selected text and navigation remain readable`,()=>{
 const colors=palette(theme);
 for(const fill of ['button','button-hover'])assert.ok(contrast(colors['--theme-button-ink'],colors[`--theme-${fill}`])>=4.5,`${theme} label on ${fill}`);
 assert.ok(contrast(colors['--theme-accent'],colors['--theme-accent-soft'])>=4.5,'selected option and active read-aloud labels');
 assert.ok(contrast(colors['--theme-selected-ink'],colors['--theme-selected'])>=4.5,'neutral selected option');
 assert.ok(contrast(colors['--theme-ink'],colors['--theme-user'])>=4.5,'user message text');
 for(const text of ['ink','muted','accent'])for(const surface of ['navigation','panel','popover'])assert.ok(contrast(colors[`--theme-${text}`],colors[`--theme-${surface}`])>=4.5,`${theme} ${text} on ${surface}`);
});

test('legacy color aliases follow the shared light palette instead of an independent green palette',()=>{
 const root={};sheet.walkRules(rule=>{if(rule.selector===':root')for(const d of rule.nodes||[])if(d.type==='decl')root[d.prop]=d.value;});
 for(const [alias,role] of [['green','accent'],['muted','muted'],['line','border'],['soft','soft'],['cream','panel']])assert.equal(root[`--${alias}`],`var(--theme-${role})`);
 assert.equal(root.color,'var(--theme-ink)');assert.equal(root.background,'var(--theme-surface)');
});
