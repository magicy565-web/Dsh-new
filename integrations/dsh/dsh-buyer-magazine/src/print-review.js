import {mkdtemp,writeFile,readFile,readdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const run=promisify(execFile);
/** Rasterize only the compiler's bounded PDF; never accept paths or commands. */
export async function printScreenshots(pdf,start,signal){
  if(pdf.length>20*1024*1024)return{status:'blocked',reason:'PDF_TOO_LARGE',screenshots:[]};
  const dir=await mkdtemp(join(tmpdir(),'dsh-magazine-print-'));
  try{
    const path=join(dir,'issue.pdf');await writeFile(path,pdf);
    const {stdout}=await run('pdfinfo',[path],{timeout:15000,signal,maxBuffer:65536});
    const pages=Number(/^Pages:\s+(\d+)/m.exec(stdout)?.[1]);
    if(!Number.isInteger(pages)||pages>24||start>=pages)return{status:'blocked',reason:'PRINT_PAGE_RANGE',screenshots:[]};
    await run('pdftoppm',['-f',String(start+1),'-l',String(Math.min(start+3,pages)),'-scale-to','1400','-png',path,join(dir,'page')],{timeout:30000,signal,maxBuffer:65536});
    const files=(await readdir(dir)).filter(f=>/^page-\d+\.png$/.test(f)).sort((a,b)=>Number(a.match(/\d+/)[0])-Number(b.match(/\d+/)[0]));
    return{status:'observed',pages,nextPrintStart:start+3<pages?start+3:null,screenshots:await Promise.all(files.map(async f=>({label:'print-'+Number(f.match(/\d+/)[0]),data:await readFile(join(dir,f))})))};
  }catch(error){signal?.throwIfAborted();return{status:'blocked',reason:'PDF_RASTERIZER_UNAVAILABLE',screenshots:[]};}
  finally{await rm(dir,{recursive:true,force:true});}
}
