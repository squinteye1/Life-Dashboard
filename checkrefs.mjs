import { readFileSync, readdirSync } from 'node:fs';
const GLOBALS = new Set(['if','for','while','switch','catch','return','typeof','new','function','await','async','Math','JSON','Object','Array','String','Number','Boolean','Date','Error','Promise','parseInt','parseFloat','isNaN','isFinite','setTimeout','clearTimeout','console','require','import','do','else','try','case','void','delete','instanceof','in','of','this','super','throw','undefined','null','true','false','Symbol','Map','Set','RegExp','NaN']);
const blank=(s)=>s.replace(/[^\n]/g,' ');
function analyse(file){
  let src=readFileSync(file,'utf8');
  src=src.replace(/\/\*[\s\S]*?\*\//g,blank).replace(/\/\/[^\n]*/g,blank);
  src=src.replace(/`(?:\\.|[^`\\])*`/g,(t)=>{const E=/\$\{((?:[^{}]|\{[^{}]*\})*)\}/g;let o='',i=0,m;while((m=E.exec(t))){o+=blank(t.slice(i,m.index))+'${'+m[1]+'}';i=m.index+m[0].length;}return o+blank(t.slice(i));});
  src=src.replace(/(?<![A-Za-z0-9_$])'(?:\\.|[^'\\\n])*'/g,blank).replace(/"(?:\\.|[^"\\\n])*"/g,blank);
  const d=new Set();
  for(const m of src.matchAll(/\b(?:export\s+)?(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)/g))d.add(m[1]);
  for(const m of src.matchAll(/\b(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)/g))d.add(m[1]);
  for(const m of src.matchAll(/import\s+([\w$]+)\s*(?:,|from)/g))d.add(m[1]);
  for(const m of src.matchAll(/import\s*\{([^}]*)\}/g))m[1].split(',').forEach(s=>{const n=s.trim().split(/\s+as\s+/).pop().trim();if(n)d.add(n);});
  const bind=(s)=>{const n=s.replace(/[=:].*$/,'').replace(/[{}\[\]]/g,'').trim();if(/^[A-Za-z_$][\w$]*$/.test(n))d.add(n);};
  for(const m of src.matchAll(/\(([^()]*)\)\s*=>/g))m[1].split(',').forEach(bind);
  for(const m of src.matchAll(/\bfunction[^(]*\(([^()]*)\)/g))m[1].split(',').forEach(bind);
  for(const m of src.matchAll(/\b(?:const|let|var)\s*[\[{]([^\]}]*)[\]}]/g))m[1].split(',').forEach(bind);
  const p=[];
  for(const m of src.matchAll(/(^|[^.\w$])([A-Za-z_$][\w$]*)\s*\(/g)){const n=m[2];if(GLOBALS.has(n)||d.has(n))continue;p.push({n,line:src.slice(0,m.index).split('\n').length});}
  return p;
}
let total=0;
for(const f of readdirSync('src').filter(f=>/\.(jsx?|mjs)$/.test(f))){
  const p=analyse(`src/${f}`);
  if(p.length){console.log(`\n${f}:`);for(const x of p)console.log(`  line ${x.line}: ${x.n} is not defined`);total+=p.length;}
}
console.log(total?`\n${total} unresolved`:'\nno unresolved calls in src/');
process.exit(total?1:0);
