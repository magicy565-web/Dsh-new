// Real PostgreSQL only. SQL targets are fixed; values are always parameters.
export async function bounded(operation,ms,label){
 let timer
 try{return await Promise.race([operation,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error(label)),ms)})])}
 finally{clearTimeout(timer)}
}

export function track(start){
 const state={settled:false}
 let operation;try{operation=start()}catch{operation=Promise.reject(Error('HTTP_START_FAILED'))}
 state.promise=Promise.resolve(operation).then(value=>{state.settled=true;return {value}},()=>{state.settled=true;return {error:true}})
 return state
}

const isUpdate=row=>row.wait_event_type==='Lock'&&/^\s*update\s+(?:"?public"?\.)?"?product_context"?\s+set\b/i.test(row.query??'')
export function waitingUpdates(rows,lockerPid){
 const waiting=rows.filter(isUpdate)
 const first=waiting.filter(row=>row.blockers.includes(lockerPid))
 if(waiting.length===1&&first.length===1)return {first:first[0]}
 return null
}

export async function waitForUpdates(observer,{lockerPid,serverRole,firstPid,requests,timeoutMs=6000}){
 const deadline=Date.now()+timeoutMs
 // Each iteration is an awaited real SQL observation, never a sleep/order guess.
 for(let attempts=0;attempts<2000&&Date.now()<deadline;attempts++){
  if(requests.some(request=>request.settled))throw Error('HTTP_FINISHED_BEFORE_LOCK_WITNESS')
  const {rows}=await observer.query(`select pid, query, wait_event_type, pg_blocking_pids(pid) as blockers
   from pg_stat_activity where datname=current_database() and usename=$1 and pid<>pg_backend_pid() and pid<>$2`,[serverRole,lockerPid])
  const waiting=rows.filter(isUpdate)
  if(firstPid===undefined){const witness=waitingUpdates(rows,lockerPid);if(witness)return witness}
  else{
   const first=waiting.find(row=>row.pid===firstPid&&row.blockers.includes(lockerPid))
   const second=waiting.find(row=>row.pid!==firstPid&&row.blockers.includes(firstPid))
   // The second UPDATE must be behind the observed first UPDATE in PG's lock queue.
   if(waiting.length===2&&first&&second)return {first,second}
  }
 }
 throw Error('TWO_REAL_UPDATE_LOCK_WITNESS_TIMEOUT')
}

export async function openPostgres(Client,config){
 const {serverRole,...connection}=config
 const options={...connection,ssl:false,options:'-c search_path=public',application_name:'medusa-live-acceptance-observer',connectionTimeoutMillis:3000,query_timeout:3000,statement_timeout:3000,idle_in_transaction_session_timeout:12000}
 const observer=new Client(options),locker=new Client({...options,application_name:'medusa-live-acceptance-locker'})
 // Idle transaction expiry/network loss must reach bounded query/finally paths,
 // rather than becoming an unhandled EventEmitter error that skips cleanup.
 for(const client of [observer,locker])client.on?.('error',()=>{})
 const close=async()=>{
  for(const client of [locker,observer]){
   try{await bounded(client.end(),3500,'PG_CLOSE_TIMEOUT')}
   catch{client.connection?.stream?.destroy()}
  }
 }
 try{
  await observer.connect();await locker.connect()
  const {rows}=await observer.query('select current_database() as database, current_user as role')
  if(rows[0]?.database!==config.database||rows[0]?.role!==config.user)throw Error('PG_IDENTITY_MISMATCH')
  return {observer,locker,close}
 }catch(error){await close();throw error}
}

export async function raceWithRowLock({observer,locker,serverRole,id,productId,firstBody,secondBody,post,check,name}){
 let first,second,locked=false
 try{
  await locker.query('begin');locked=true
  await locker.query("set local lock_timeout='3000ms'")
  const target=await locker.query('select id from product_context where id=$1 and product_id=$2 and deleted_at is null for update',[id,productId])
  check(name+'-owned-row-lock',target.rowCount===1,{rows:target.rowCount})
  const pid=(await locker.query('select pg_backend_pid() as pid')).rows[0].pid
  first=track(()=>post(firstBody))
  const initial=await waitForUpdates(observer,{lockerPid:pid,serverRole,requests:[first]})
  second=track(()=>post(secondBody))
  const witness=await waitForUpdates(observer,{lockerPid:pid,serverRole,firstPid:initial.first.pid,requests:[first,second]})
  check(name+'-two-real-updates-waiting',true,{locker_pid:pid,first_pid:witness.first.pid,first_blockers:witness.first.blockers,second_pid:witness.second.pid,second_blockers:witness.second.blockers,first_update_observed_before_second_sent:true})
  await locker.query('rollback');locked=false
  const [a,b]=await bounded(Promise.all([first.promise,second.promise]),16000,'HTTP_DRAIN_TIMEOUT')
  check(name+'-exact-winner',!a.error&&!b.error&&a.value.status===200&&b.value.status===409,{first_status:a.value?.status,second_status:b.value?.status})
  return a.value.data.product_context
 }finally{
  // Release even when witnessing, HTTP or an assertion fails. Drain every request.
  if(locked){try{await locker.query('rollback')}catch{locker.connection?.stream?.destroy()}}
  await bounded(Promise.all([first?.promise,second?.promise]),16000,'HTTP_FINALLY_DRAIN_TIMEOUT')
 }
}
