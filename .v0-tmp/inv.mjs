import postcss from 'postcss';import {readFileSync} from 'node:fs';
const css=readFileSync('integrations/dsh/dsh-commerce-network/src/styles.css','utf8');
const root=postcss.parse(css);const names=new Map();let n=0;
root.walkRules(r=>{if(r.parent.type==='atrule'&&/keyframes/.test(r.parent.name))return;n++;for(const s of r.selectors){const m=[...s.matchAll(/\.(cn-[a-z0-9_-]+)/g)].map(x=>x[1]);const k=m[0]||s.slice(0,40);names.set(k,(names.get(k)||0)+1);}});
root.walkAtRules(a=>{if(!/keyframes/.test(a.name))console.log('@'+a.name,a.params)});
console.log('rules',n,'classes',names.size);console.log([...names.keys()].join(' '));
