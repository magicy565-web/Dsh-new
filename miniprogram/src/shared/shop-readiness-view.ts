/** Client presentation only. These are local labels, not an invented API DTO.
 * The fixed backend contract adapter will supply this from a validated read.
 * Enterprise/Shopify web login and token presence never imply readiness. */
export type ShopReadinessKind='not_checked'|'unconfigured'|'insufficient_permissions'|'store_mismatch'|'authorization_expired'|'readable_ready';
export type ShopReadinessMessage={kind:ShopReadinessKind;readConfirmed?:boolean;shopDomain?:string|null;checkedAt?:string|null;detail?:string;missingPermissions?:string[]};
export type ShopReadinessView={kind:ShopReadinessKind;ready:boolean;title:string;summary:string;detail:string;shopLabel:string};
export function presentShopReadiness(input:ShopReadinessMessage):ShopReadinessView{
 const domain=typeof input.shopDomain==='string'&&input.shopDomain.includes('.')&&/^[a-z0-9][a-z0-9.-]{0,251}[a-z0-9]$/.test(input.shopDomain)?input.shopDomain:null;
 const ready=input.kind==='readable_ready'&&input.readConfirmed===true&&!!domain;
 const kind=input.kind==='readable_ready'&&!ready?'not_checked':input.kind;
 const titles:Record<ShopReadinessKind,string>={not_checked:'Shopify 接入尚未核验',unconfigured:'Shopify 尚未连接',insufficient_permissions:'Shopify 原权限不足',store_mismatch:'Shopify 店铺不匹配',authorization_expired:'Shopify 授权已失效',readable_ready:'Shopify 服务端只读就绪'};
 const summaries:Record<ShopReadinessKind,string>={not_checked:'企业或商店网页登录不代表服务端授权完成',unconfigured:'由负责人配置原服务端接入，再读取核验',insufficient_permissions:'需核对原服务端权限；客户端不申请或扩大权限',store_mismatch:'先核对原绑定店铺，不能向另一店铺执行',authorization_expired:'由负责人恢复原授权，再重新读取核验',readable_ready:'外部写入、通知仍需各自准确审批和执行'};
 return{kind,ready,title:titles[kind],summary:summaries[kind],shopLabel:domain||'店铺身份未核验',detail:`${titles[kind]}\n${domain?'原店铺 '+domain:'尚无已核验店铺域名；不从用户handle猜域名'}\n${input.checkedAt?'读取时间 '+input.checkedAt:'尚无核验时间'}\n${(input.missingPermissions||[]).length?'缺少原权限 '+input.missingPermissions!.join('、'):''}\n${input.detail||''}\n${summaries[kind]}`};
}
