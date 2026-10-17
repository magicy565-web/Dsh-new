import { defineConfig, loadEnv } from '@medusajs/framework/utils'
loadEnv(process.env.NODE_ENV || 'development', process.cwd())
module.exports = defineConfig({
 projectConfig: {
  databaseUrl: process.env.DATABASE_URL,
  redisUrl: process.env.REDIS_URL,
  workerMode: 'shared',
  databaseDriverOptions: { connection: { ssl: false } },
  http: {
   storeCors: 'http://127.0.0.1:4173', adminCors: 'http://127.0.0.1:4173,http://localhost:4173,http://127.0.0.1:9000', authCors: 'http://127.0.0.1:4173,http://localhost:4173,http://127.0.0.1:9000',
   jwtSecret: process.env.JWT_SECRET!, cookieSecret: process.env.COOKIE_SECRET!,
  },
 },
 admin: { disable: true },
 modules: [
  {resolve:'@medusajs/medusa/caching',options:{providers:[{resolve:'@medusajs/caching-redis',id:'redis',is_default:true,options:{redisUrl:process.env.REDIS_URL}}]}},
  {resolve:'@medusajs/medusa/event-bus-redis',options:{redisUrl:process.env.REDIS_URL}},
  {resolve:'@medusajs/medusa/workflow-engine-redis',options:{redis:{redisUrl:process.env.REDIS_URL}}},
  {resolve:'@medusajs/medusa/locking',options:{providers:[{resolve:'@medusajs/medusa/locking-redis',id:'redis',is_default:true,options:{redisUrl:process.env.REDIS_URL}}]}},
  {resolve:'@medusajs/medusa/file',options:{providers:[{resolve:'@medusajs/medusa/file-local',id:'local',options:{upload_dir:'/app/static',backend_url:(process.env.MEDUSA_BACKEND_URL||'http://127.0.0.1:9000')+'/static'}}]}},
 ],
 plugins: [{resolve:'@magicy565/medusa-enterprise-product-context',options:{}}],
})
