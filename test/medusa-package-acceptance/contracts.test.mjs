// Pure lock/provenance contracts; no installs, builds, Docker, network or DB.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import {spawnSync,execFileSync} from 'node:child_process'
import path from 'node:path'
import os from 'node:os'
import {assertLockDelta,cleanEnv,validateWorkDirectory,LOCAL,BASELINE} from '../../scripts/medusa-package-acceptance.mjs'

const name='@magicy565/medusa-enterprise-product-context'
const archive='magicy565-medusa-enterprise-product-context-0.1.0.tgz'
const before=()=>({name:'synthetic-host',lockfileVersion:3,requires:true,packages:{'':{dependencies:{[name]:'file:./'+archive,external:'1.0.0'}},[LOCAL]:{version:'0.1.0',resolved:'file:'+archive,integrity:'sha512-old',engines:{node:'>=20'},peerDependencies:{'@medusajs/framework':'^2.21.2','@medusajs/medusa':'^2.21.2'}},'node_modules/external':{version:'1.0.0',resolved:'https://registry.npmjs.org/external/-/external-1.0.0.tgz',integrity:'sha512-external',optional:true,license:'MIT',dependencies:{child:'1.0.0'}}}})
const after=()=>{const value=before();value.packages[LOCAL].integrity='sha512-new';return value}

test('only actual archive integrity and exact npm file-path canonicalization are allowed',()=>{
 assert.equal(assertLockDelta(before(),after(),'sha512-new').externalEntriesUnchanged,1)
 const normalized=after();normalized.packages[''].dependencies[name]='file:'+archive
 assert.equal(assertLockDelta(before(),normalized,'sha512-new').changedPaths.length,2)
 assert.throws(()=>assertLockDelta(before(),before(),'sha512-old'),/ACTUAL_NEW_ARCHIVE/)
 assert.throws(()=>assertLockDelta(before(),after(),'sha512-unverified'),/ACTUAL_NEW_ARCHIVE/)
})

test('every full external lock entry, path and root dependency remains frozen',()=>{
 for(const mutate of [
  v=>v.packages['node_modules/external'].version='1.0.1',
  v=>v.packages['node_modules/external'].integrity='sha512-drift',
  v=>v.packages['node_modules/external'].resolved='https://other.invalid/package.tgz',
  v=>delete v.packages['node_modules/external'].optional,
  v=>v.packages['node_modules/external'].dependencies.child='2.0.0',
  v=>v.packages['node_modules/extra']={version:'1'},
  v=>delete v.packages['node_modules/external'],
  v=>v.packages[''].dependencies.external='2.0.0',
  v=>v.lockfileVersion=2,v=>v.name='changed',
 ]){const candidate=after();mutate(candidate);assert.throws(()=>assertLockDelta(before(),candidate,'sha512-new'),/LOCK_DRIFT/)}
})

test('local plugin version, peers, engines, resolution and unrelated metadata cannot drift',()=>{
 for(const mutate of [
  v=>v.packages[LOCAL].version='0.2.0',v=>v.packages[LOCAL].engines.node='>=24',
  v=>v.packages[LOCAL].peerDependencies['@medusajs/framework']='*',
  v=>v.packages[LOCAL].resolved='file:different.tgz',v=>v.packages[LOCAL].license='new',
 ]){const candidate=after();mutate(candidate);assert.throws(()=>assertLockDelta(before(),candidate,'sha512-new'),/LOCK_DRIFT/)}
 const candidate=after();candidate.packages[''].dependencies[name]='file:elsewhere.tgz'
 assert.throws(()=>assertLockDelta(before(),candidate,'sha512-new'),/UNEXPECTED_LOCAL_FILE/)
})

test('checked-in host lock is the verified archive update with every external entry preserved',async()=>{
 const original=JSON.parse(execFileSync('git',['show',BASELINE+':apps/medusa-acceptance/package-lock.json'],{encoding:'utf8'}))
 const candidate=JSON.parse(await fs.readFile('apps/medusa-acceptance/package-lock.json'))
 const evidence=JSON.parse(await fs.readFile('docs/medusa/business-package-v1.json'))
 const delta=assertLockDelta(original,candidate,evidence.reproduciblePackage.archiveA.integrity)
 assert.equal(delta.externalEntriesUnchanged,1147);assert.equal(delta.changedPaths.length,2)
 assert.equal(candidate.packages[LOCAL].version,'0.1.0')
 assert.deepEqual(candidate.packages[LOCAL].peerDependencies,original.packages[LOCAL].peerDependencies)
 assert.deepEqual(candidate.packages[LOCAL].engines,original.packages[LOCAL].engines)
})

test('install environment excludes ambient credentials, npm config and service variables',()=>{
 const env=cleanEnv('/synthetic/home','/synthetic/cache')
 assert.equal(env.HOME,'/synthetic/home');assert.equal(env.NPM_CONFIG_CACHE,'/synthetic/cache')
 for(const key of ['GH_TOKEN','DEEPSEEK_API_KEY','DATABASE_URL','NPM_TOKEN','NPM_CONFIG_USERCONFIG','NODE_OPTIONS','JWT_SECRET'])assert.equal(env[key],undefined)
 assert.equal(env.MEDUSA_DISABLE_TELEMETRY,'true')
})

async function pathFixture(t){
 const directory=await fs.mkdtemp(path.join(await fs.realpath(os.tmpdir()),'medusa-package-path-contract-'))
 t.after(()=>fs.rm(directory,{recursive:true,force:true})) // Only this test's synthetic directory.
 const repository=path.join(directory,'repo'),outside=path.join(directory,'outside'),sibling=path.join(directory,'repo-sibling')
 await fs.mkdir(path.join(repository,'scripts'),{recursive:true});await fs.mkdir(outside);await fs.mkdir(sibling)
 await fs.copyFile(new URL('../../scripts/medusa-package-acceptance.mjs',import.meta.url),path.join(repository,'scripts/medusa-package-acceptance.mjs'))
 await fs.writeFile(path.join(repository,'SYNTHETIC_SENTINEL'),'unchanged')
 await fs.writeFile(path.join(directory,'not-a-directory'),'unchanged')
 await fs.symlink(repository,path.join(directory,'repo-alias'))
 await fs.symlink(outside,path.join(directory,'outside-alias'))
 return {directory,repository,outside,sibling}
}

test('read-only guard rejects aliases, repository containment and every symlink parent',async t=>{
 const {directory,repository,outside,sibling}=await pathFixture(t)
 const rejected=[repository,path.join(repository,'child'),directory,'relative',
  directory+'/./repo/child',outside+'/../repo/child',repository+'/../outside/new',outside+'//new',outside+'/',
  path.join(directory,'repo-alias'),path.join(directory,'repo-alias/child'),path.join(directory,'outside-alias/new'),
  path.join(directory,'not-a-directory'),path.join(directory,'missing-parent/child')]
 // Reproduce only the old predicate, never the old destructive entry points.
 for(const alias of [directory+'/./repo/child',outside+'/../repo/child',path.join(directory,'repo-alias/child')])assert.equal(path.isAbsolute(alias)&&!alias.startsWith(repository+'/'),true)
 for(const existing of [false,true])for(const work of rejected)await assert.rejects(validateWorkDirectory(work,{repositoryRoot:repository,existing}),/NO_ALIASES_OR_SYMLINKS/)
 assert.equal(await validateWorkDirectory(path.join(outside,'new'),{repositoryRoot:repository}),path.join(outside,'new'))
 assert.equal(await validateWorkDirectory(path.join(sibling,'new'),{repositoryRoot:repository}),path.join(sibling,'new'))
 assert.equal(await validateWorkDirectory(outside,{repositoryRoot:repository,existing:true}),outside)
 assert.deepEqual(await fs.readdir(outside),[]);assert.deepEqual(await fs.readdir(sibling),[])
})

test('both CLI entry points reject synthetic unsafe paths before any mutation or subprocess',async t=>{
 const {directory,repository,outside}=await pathFixture(t)
 const script=path.join(repository,'scripts/medusa-package-acceptance.mjs')
 const preload='import fs from "node:fs/promises";import child from "node:child_process";import{syncBuiltinESMExports}from"node:module";for(const key of ["mkdir","writeFile","copyFile","rm"])fs[key]=()=>{throw Error("CONTRACT_MUTATION_MUST_NOT_RUN")};child.spawn=()=>{throw Error("CONTRACT_SUBPROCESS_MUST_NOT_RUN")};syncBuiltinESMExports()'
 for(const mode of [[],['--complete']])for(const work of [repository,repository+'/child',directory+'/./repo/child',outside+'/../repo/child',repository+'/../outside/new',path.join(directory,'repo-alias/child'),path.join(directory,'outside-alias/new'),directory,'relative']){
  const result=spawnSync(process.execPath,['--import','data:text/javascript,'+encodeURIComponent(preload),script,...mode,work],{encoding:'utf8',timeout:3000,env:{PATH:process.env.PATH},cwd:directory})
  assert.equal(result.status,1,result.stderr);assert.match(result.stderr,/NO_ALIASES_OR_SYMLINKS/)
  assert.doesNotMatch(result.stderr,/CONTRACT_MUTATION|CONTRACT_SUBPROCESS/);assert.equal(result.stdout,'')
 }
 assert.equal(await fs.readFile(path.join(repository,'SYNTHETIC_SENTINEL'),'utf8'),'unchanged')
 assert.deepEqual((await fs.readdir(repository)).sort(),['SYNTHETIC_SENTINEL','scripts'])
 assert.deepEqual(await fs.readdir(outside),[])
})

test('auditor uses real native config/plugin/module export resolution without bootstrap',async()=>{
 const source=await fs.readFile(new URL('./audit-closure.cjs',import.meta.url),'utf8')
 assert.match(source,/getResolvedPlugins/);assert.match(source,/resolveModuleExports/)
 assert.match(source,/medusa-config\.ts/);assert.match(source,/process\.chdir\(host\)/)
 assert.doesNotMatch(source,/connect:false|\.connect\(|new Client|MedusaAppLoader|bootstrap\(/)
 assert.equal(BASELINE,'a819897d9212212afab8f12683d212971c982e8b')
})
