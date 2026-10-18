// No Docker client/daemon, installs, services, accounts or credentials are used.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {spawnSync} from 'node:child_process'
import {config,prepare,INTEGRATION,IMAGES} from '../../scripts/medusa-isolated-acceptance-prepare.mjs'
import {databaseName,secretValue,MIGRATION_MODULES,boot} from '../../acceptance/medusa/isolated-api-boot.mjs'
const value=()=>({integrationSha:INTEGRATION,runId:'medusa-live-synthetic-20261018',artifactHost:'/synthetic/artifact',pluginSource:'/synthetic/plugin',secretDirectory:'/synthetic/operator-files'})

test('only the pinned integration and explicit non-secret config are accepted',()=>{
 assert.equal(config(value()).database,'medusa_live_synthetic_20261018')
 for(const mutate of [v=>v.integrationSha='a'.repeat(40),v=>v.runId='production',v=>v.adminToken='forbidden',v=>v.secretDirectory='/tmp/x/../elsewhere',v=>v.artifactHost='/tmp/space or,comma',v=>delete v.pluginSource]){
  const v=value();mutate(v);assert.throws(()=>config(v))
 }
 assert.equal(INTEGRATION,'1b788561a6f8e63da9ffecf6f81d0c311d20c721')
 for(const image of Object.values(IMAGES))assert.match(image,/^docker\.io\/library\/(?:postgres|redis|node):[^@]+@sha256:[a-f0-9]{64}$/)
})
test('bad config is rejected before creating the synthetic output directory',async t=>{
 const directory=await fs.mkdtemp(path.join(await fs.realpath(os.tmpdir()),'medusa-preparation-contract-'))
 t.after(()=>fs.rm(directory,{recursive:true,force:true}))
 const v=value();v.integrationSha='wrong'
 await assert.rejects(prepare(v,path.join(directory,'new')),/PINNED_NON_SECRET/)
 assert.deepEqual(await fs.readdir(directory),[])
})
test('boot fails without approval before assembly, migration or service execution',async()=>{
 const before={db:process.env.MEDUSA_TEST_DATABASE,approval:process.env.MEDUSA_TEMP_SERVICE_APPROVAL}
 try{process.env.MEDUSA_TEST_DATABASE='medusa_live_synthetic_20261018';delete process.env.MEDUSA_TEMP_SERVICE_APPROVAL;await assert.rejects(boot(),/OPERATOR_APPROVAL/)}
 finally{for(const [key,v] of [['MEDUSA_TEST_DATABASE',before.db],['MEDUSA_TEMP_SERVICE_APPROVAL',before.approval]])if(v===undefined)delete process.env[key];else process.env[key]=v}
})
test('temporary database and service-file value contracts have no ambient fallback',()=>{
 for(const name of ['medusa_catalog','postgres','medusa_live_short','medusa_live_x;drop database x'])assert.throws(()=>databaseName(name))
 assert.equal(databaseName('medusa_live_synthetic_20261018'),'medusa_live_synthetic_20261018')
 assert.equal(secretValue('a'.repeat(64)+'\n'),'a'.repeat(64))
 for(const text of ['','A'.repeat(64),'a'.repeat(63),'x'.repeat(64)])assert.throws(()=>secretValue(text))
})
test('existing native migration preparation is reused exactly, without service patches',async()=>{
 const audit=JSON.parse(await fs.readFile('docs/validation/omp-medusa-provider-closure-20261017.json'))
 const names=audit.entries.filter(e=>!e.exists&&!e.customMigrations).map(e=>/^node_modules\/@medusajs\/([^/]+)\/dist\/migrations$/.exec(e.migrationDirectory)?.[1]).sort()
 assert.deepEqual([...MIGRATION_MODULES].sort(),names);assert.equal(names.length,11)
 const bootSource=await fs.readFile('acceptance/medusa/isolated-api-boot.mjs','utf8')
 assert.match(bootSource,/127\.0\.0\.1:5432/);assert.match(bootSource,/127\.0\.0\.1:6379/)
 assert.match(bootSource,/\['db:migrate'\]/);assert.match(bootSource,/\['start','--host','127\.0\.0\.1'\]/)
 assert.doesNotMatch(bootSource,/randomBytes|npm install|plugin:build|commands\/user|nativeUpdate/)
})
test('review plan contains complete bounded commands, exact-ID cleanup and no automatic pull',async()=>{
 const source=await fs.readFile('acceptance/medusa/isolated-plan.sh','utf8')
 assert.equal(spawnSync('bash',['-n','acceptance/medusa/isolated-plan.sh']).status,0)
 assert.doesNotMatch(source,/docker run \.\.\.|d pull|docker pull|--publish|--privileged|volume (?:rm|prune)|system prune|container prune|network prune/)
 assert.match(source,/--internal/);assert.match(source,/--network "container:\$PG_ID"/)
 for(const limit of ['--memory=768m','--memory=128m','--memory=3g','--cpus=.75','--cpus=.25','--cpus=1.5','--pids-limit=128','--pids-limit=64','--pids-limit=256'])assert.ok(source.includes(limit),limit)
 assert.match(source,/POSTGRES_PASSWORD_FILE/);assert.match(source,/--pull=never/)
 assert.match(source,/container_match "\$id"; d container rm -f "\$id"/)
 assert.match(source,/label_match network "\$id"; d network rm "\$id"/)
 assert.match(source,/wait-for-http\.mjs http:\/\/127\.0\.0\.1:9000\/health/)
 assert.match(source,/medusa-catalog-live-smoke\.mjs --context-review-only/)
 assert.ok(source.indexOf('node "$PLAN/verify.mjs"')<source.indexOf('d network create'))
})
