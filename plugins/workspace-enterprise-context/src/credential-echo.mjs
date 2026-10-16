// Examine bounded service data in the trusted Node process. Never return a
// match, credential, candidate, body excerpt or upstream exception to a caller.
const fail=()=>{throw Object.assign(Error('OSS_CREDENTIAL_ECHO_REFUSED'),{code:'OSS_CREDENTIAL_ECHO_REFUSED'});};
function unescapeText(text){
 return text.replace(/\\u([a-f0-9]{4})|\\x([a-f0-9]{2})|\\(["\\/bfnrt])/gi,(_all,unicode,hex,escaped)=>
  unicode||hex?String.fromCharCode(parseInt(unicode||hex,16)):({b:'\b',f:'\f',n:'\n',r:'\r',t:'\t'}[escaped]??escaped))
  .replace(/&(?:#x([a-f0-9]{1,6})|#([0-9]{1,7})|(amp|lt|gt|quot|apos));/gi,(all,hex,decimal,name)=>{
   if(name)return {amp:'&',lt:'<',gt:'>',quot:'"',apos:"'"}[name.toLowerCase()];
   const n=parseInt(hex||decimal,hex?16:10);return n<=0x10ffff?String.fromCodePoint(n):all;
  }).replace(/(?:%[a-f0-9]{2})+/gi,encoded=>{try{return decodeURIComponent(encoded);}catch{return encoded;}});
}
export function assertNoKnownCredentialEcho(value,secrets=[]){
 const known=secrets.filter(secret=>typeof secret==='string'&&secret.length);
 if(!known.length)return;
 const variants=new Set();
 for(const secret of known){const bytes=Buffer.from(secret),base64=bytes.toString('base64');
  for(const form of [secret,JSON.stringify(secret).slice(1,-1),encodeURI(secret),encodeURIComponent(secret),base64,base64.replace(/=+$/,''),bytes.toString('base64url'),bytes.toString('hex'),bytes.toString('hex').toUpperCase()])variants.add(form);
 }
 const check=text=>{for(const variant of variants)if(text.includes(variant))fail();};
 let text=typeof value==='string'?value:JSON.stringify(value);
 if(typeof text!=='string')return;
 // Three normalization passes cover common nested JSON/HTML/URI escaping.
 // Base64 tokens also cover an encoded error phrase around the credential.
 for(let layer=0;layer<3;layer++){
  check(text);
  for(const match of text.matchAll(/[A-Za-z0-9+/_-]{16,}={0,2}/g)){
   const decoded=Buffer.from(match[0],'base64').toString('utf8');check(decoded);check(unescapeText(decoded));
  }
  const next=unescapeText(text);if(next===text)break;text=next;
 }
 check(text);
}
