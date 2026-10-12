/** Labels shared by the validated original commerce readiness projection.
 * Enterprise/Shopify web login and token presence never imply readiness. */
export type ShopReadinessKind='not_checked'|'unconfigured'|'insufficient_permissions'|'store_mismatch'|'authorization_expired'|'unknown'|'readable_ready';
export type ShopReadinessMessage={kind:ShopReadinessKind;readConfirmed?:boolean;shopDomain?:string|null;checkedAt?:string|null;detail?:string;missingPermissions?:string[]};
export type ShopReadinessView={kind:ShopReadinessKind;ready:boolean;title:string;summary:string;detail:string;shopLabel:string};
export function presentShopReadiness(input:ShopReadinessMessage):ShopReadinessView{
 const domain=typeof input.shopDomain==='string'&&input.shopDomain.includes('.')&&/^[a-z0-9][a-z0-9.-]{0,251}[a-z0-9]$/.test(input.shopDomain)?input.shopDomain:null;
 const ready=input.kind==='readable_ready'&&input.readConfirmed===true&&!!domain;
 const kind=input.kind==='readable_ready'&&!ready?'not_checked':input.kind;
 const titles:Record<ShopReadinessKind,string>={not_checked:'Shopify 接入尚未核验',unconfigured:'Shopify 尚未连接',insufficient_permissions:'Shopify 原权限不足',store_mismatch:'Shopify 店铺不匹配',authorization_expired:'Shopify 授权已失效',unknown:'Shopify 接入结果未知',readable_ready:'Shopify 服务端只读就绪'};
 const summaries:Record<ShopReadinessKind,string>={not_checked:'企业或商店网页登录不代表服务端授权完成',unconfigured:'由负责人配置原服务端接入，再读取核验',insufficient_permissions:'需核对原服务端权限；客户端不申请或扩大权限',store_mismatch:'先核对原绑定店铺，不能向另一店铺执行',authorization_expired:'由负责人恢复原授权，再重新读取核验',unknown:'读取失败或核验已过期；不能按已连接继续',readable_ready:'外部写入、通知仍需各自准确审批和执行'};
 return{kind,ready,title:titles[kind],summary:summaries[kind],shopLabel:domain||'店铺身份未核验',detail:`${titles[kind]}\n${domain?'原店铺 '+domain:'尚无已核验店铺域名；不从用户handle猜域名'}\n${input.checkedAt?'读取时间 '+input.checkedAt:'尚无核验时间'}\n${(input.missingPermissions||[]).length?'缺少原权限 '+input.missingPermissions!.join('、'):''}\n${input.detail||''}\n${summaries[kind]}`};
}

/** Public projection from the existing commerce status/verify endpoints. */
export type ShopReadinessContract={schema:'workspace.shopify.readiness.v1';kind:ShopReadinessKind;readConfirmed:boolean;shopDomain:string|null;targetDomain:string|null;checkedAt:string|null;validUntil:string|null;missingPermissions:string[];code:string|null;evidence:'shop_identity_and_access_scopes'|null;readOnly:true;writeAuthorized:false};
export function validShopReadiness(value:unknown):value is ShopReadinessContract{
 const v=value as ShopReadinessContract,domain=(x:unknown)=>x===null||typeof x==='string'&&/^[a-z0-9][a-z0-9-]{0,61}\.myshopify\.com$/.test(x),date=(x:unknown)=>x===null||typeof x==='string'&&Number.isFinite(Date.parse(x));
 return !!v&&v.schema==='workspace.shopify.readiness.v1'&&['not_checked','unconfigured','insufficient_permissions','store_mismatch','authorization_expired','unknown','readable_ready'].includes(v.kind)&&typeof v.readConfirmed==='boolean'&&domain(v.shopDomain)&&domain(v.targetDomain)&&date(v.checkedAt)&&date(v.validUntil)&&Array.isArray(v.missingPermissions)&&v.missingPermissions.length<=200&&v.missingPermissions.every(p=>typeof p==='string'&&/^[a-z_]{1,100}$/.test(p))&&(v.code===null||typeof v.code==='string'&&/^SHOPIFY_[A-Z_]+$/.test(v.code))&&(v.evidence===null||v.evidence==='shop_identity_and_access_scopes')&&v.readOnly===true&&v.writeAuthorized===false&&(v.kind==='readable_ready'?v.readConfirmed===true&&!!v.shopDomain&&v.shopDomain===v.targetDomain&&!!v.checkedAt&&!!v.validUntil&&Date.parse(v.validUntil)>Date.parse(v.checkedAt)&&v.missingPermissions.length===0&&v.code===null&&v.evidence==='shop_identity_and_access_scopes':v.readConfirmed===false);
}
export function presentShopReadinessContract(v:ShopReadinessContract):ShopReadinessView{
 return presentShopReadiness({...v,detail:[v.targetDomain?'原服务配置目标 '+v.targetDomain+'（配置不等于身份核验）':'原服务尚无有效目标域名',v.evidence?'依据：Shopify 返回准确店铺身份及原商品读取授权范围；尚未证明写入、发布或通知成功':'尚无完整读取依据',v.validUntil?'证据有效至 '+v.validUntil:'',v.code?'核验原因 '+v.code:''].filter(Boolean).join('\n')});
}
