const url=process.argv[2],deadline=Date.now()+120000
while(Date.now()<deadline){try{if((await fetch(url,{signal:AbortSignal.timeout(2000)})).ok)process.exit(0)}catch{}await new Promise(r=>setTimeout(r,500))}
console.error('Service did not become ready: '+url);process.exit(1)
