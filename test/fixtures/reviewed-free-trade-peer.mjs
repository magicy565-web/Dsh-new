// Explicit fixture setup for ERPNext's declared original peer. Offline source
// packaging only; never used by application startup or dependency installation.
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';
export async function supplyReviewedFreeTradePeer(root){
  const source=fileURLToPath(new URL('../../plugins/workspace-free-trade',import.meta.url));
  const target=path.join(root,'node_modules/@workspace-agent/pi-free-trade');
  const env={PATH:process.env.PATH,HOME:root,TMPDIR:root,NO_COLOR:'1'};
  const packed=JSON.parse(execFileSync('npm',['pack','--offline','--ignore-scripts','--json','--pack-destination',root,'--cache',root+'/npm-cache'],{cwd:source,encoding:'utf8',env}))[0];
  await fs.mkdir(path.dirname(target),{recursive:true});await fs.mkdir(target);
  execFileSync('tar',['-xzf',path.join(root,packed.filename),'--strip-components=1','-C',target],{env});
  for(const file of packed.files)assert.ok((await fs.readFile(path.join(target,file.path))).equals(await fs.readFile(path.join(source,file.path))));
  const manifest=JSON.parse(await fs.readFile(path.join(target,'package.json'),'utf8'));
  assert.equal(manifest.name,'@workspace-agent/pi-free-trade');assert.equal(manifest.version,'0.1.2');
}
