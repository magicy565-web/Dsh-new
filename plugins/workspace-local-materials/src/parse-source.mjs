import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {looksLikeCredential} from './public-input.mjs';
export const digest = value => createHash('sha256').update(value).digest('hex');
const unavailable = reason => ({status:'unavailable',reason,ocrPerformed:false});
async function csv(text,signal){
  return new Promise(resolve=>{
    const child=spawn('/usr/bin/python3',['-I','-S',fileURLToPath(new URL('./parse-csv.py',import.meta.url))],{
      env:{PATH:'/usr/bin:/bin'},stdio:['pipe','pipe','ignore']});
    let out='',done=false;
    const finish=value=>{if(done)return;done=true;clearTimeout(timer);signal?.removeEventListener('abort',stop);resolve(value);};
    const stop=()=>{child.kill('SIGKILL');finish(null);};
    const timer=setTimeout(stop,5000);signal?.addEventListener('abort',stop,{once:true});
    child.on('error',()=>finish(null));child.stdin.on('error',()=>{});
    child.stdout.on('data',bytes=>{out+=bytes;if(Buffer.byteLength(out)>262144)stop();});
    child.on('close',code=>{try{finish(code===0?JSON.parse(out):null);}catch{finish(null);}});
    if(signal?.aborted)stop();else child.stdin.end(JSON.stringify(text));
  });
}
export async function parseSelectedSource({files,readTool,inputId,documentKey,purpose='',signal}){
  const native=await readTool.execute('archive-native-read',{path:inputId},signal);
  if(native.isError)return unavailable('ORIGINAL_NATIVE_READ_REFUSED');
  const selected=await files.snapshot(inputId,signal),format=path.extname(selected.name).slice(1).toLowerCase();
  let text,table=null,parser,limitations=[],status='available';
  if(format==='pdf'){
    // OMP supplies the underlying extracted text separately from its transient
    // path/hashline rendering. Preserve that native text, never the UI wrapper.
    text=native.details?.displayContent?.text;parser={name:'original-omp-native-read',version:'18.10.4'};
    if(typeof text!=='string')return unavailable('PDF_NATIVE_PARSED_TEXT_UNAVAILABLE_NO_OCR');
    if(!text.trim()||/\[Cannot read |Error reading |Unsupported file/u.test(text))return unavailable('PDF_TEXT_EXTRACTION_UNAVAILABLE_NO_OCR');
    const hints=/Text extraction is incomplete|OCR|scanned page/iu.test(text);
    text=text.split('\n').filter(line=>!/^Text extraction is incomplete for PDF pages [0-9, -]+\. Use the browser prelude to render those pages or OCR them\.$/.test(line)).join('\n');
    if(!text.trim())return unavailable('PDF_TEXT_EXTRACTION_UNAVAILABLE_NO_OCR');
    if(hints||native.details?.truncation?.truncated||native.details?.meta?.truncation){status='partial';limitations.push('PARTIAL_NATIVE_TEXT_EXTRACTION');}
    limitations.push('PDF_TEXT_LAYER_ONLY','OCR_NOT_SUPPORTED','NO_WHOLE_DOCUMENT_COMPLETENESS_CLAIM');
  }else{
    try{text=new TextDecoder('utf-8',{fatal:true}).decode(selected.bytes).replace(/^\uFEFF/,'');}catch{return unavailable('UTF8_REQUIRED');}
    parser={name:'native-utf8-text',version:'1'};
    if(format==='csv'){
      const parsed=await csv(text,signal);if(!parsed)return unavailable('CSV_PARSER_UNAVAILABLE_OR_FORMAT_UNSUPPORTED');
      parser={name:parsed.parser,version:parsed.version};table={headers:parsed.headers,rows:[]};text='';
      for(const [index,cells]of parsed.rows.entries()){
        const start=text.length; text+='Row '+(index+2)+'\n'+cells.map((cell,i)=>parsed.headers[i]+': '+cell).join('\n')+'\n\n';
        table.rows.push({row:index+2,cells,start,end:text.length});
      }
    }
  }
  if(text.length>65536)return unavailable('PARSED_TEXT_LIMIT_EXCEEDED');
  if(looksLikeCredential(text))throw Object.assign(Error('LOCAL_ARCHIVE_CREDENTIAL_TEXT_REFUSED'),{code:'LOCAL_ARCHIVE_CREDENTIAL_TEXT_REFUSED'});
  const parsedHash=digest(text),readRef=digest(JSON.stringify({inputId,documentKey,sha256:selected.sha256,parsedHash,parser}));
  return {status,inputId,documentKey,purpose,name:selected.name,sha256:selected.sha256,bytes:selected.bytes,
    format,parser,text,table,parsedHash,readRef,limitations,ocrPerformed:false};
}
