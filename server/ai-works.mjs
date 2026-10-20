import { createHash, randomUUID } from 'node:crypto';

/**
 * AI-work products and their development-plan delegations.
 *
 * This is the platform's first general-purpose AI-work: a *published product*
 * (definition + typed inputs + workflow + acceptance) that, given an explicit
 * input (target country + procurement-customer type), produces a reviewable
 * development-plan delegation. The delegation is inert: it never sends email,
 * never calls a model, never invents a contact and never starts external work.
 * Execution (lead discovery) is a later, separately reviewed pipeline.
 *
 * The product registry is the platform's product database. Every published
 * revision is stored durably with a canonical content hash; the catalog only
 * exposes published revisions. Delegations pin the exact product revision and
 * hash so a later product edit cannot silently change an accepted plan.
 */

export const AI_WORKS_VERSION = 1;
export const PRODUCT_ID = /^[a-z][a-z0-9-]{1,63}$/u;
export const DELEGATION_STATUSES = Object.freeze(['draft', 'approved', 'cancelled']);
export const EXECUTION_STATUSES = Object.freeze(['not_started', 'awaiting_source', 'completed', 'failed']);
export const CANDIDATE_STATUSES = Object.freeze(['needs_review', 'qualified', 'rejected']);
export const DRAFT_STATUSES = Object.freeze(['draft', 'approved', 'rejected']);
export const SUPPORTED_PLAYBOOKS = Object.freeze(['lead-discovery']);
const MAX_PRODUCTS = 1000;
const MAX_DELEGATIONS = 2000;
const MAX_EVENTS = 4000;
const MAX_CANDIDATES = 5000;
const MAX_CANDIDATES_PER_DELEGATION = 300;
const MAX_DRAFTS = 5000;
const MAX_IMPORT_ROWS = 100;
const MAX_IMPORT_BYTES = 64 * 1024;
const DRAFT_LANGUAGES = Object.freeze(['en', 'de']);

/**
 * Source adapters are explicit capabilities, never implied availability.
 * Only `authorized_import` is implemented for execution today; search and
 * registry adapters remain unconfigured/unimplemented until a real key and
 * reviewed adapter are supplied (execution refuses to invent leads).
 */
const SOURCE_DEFINITIONS = Object.freeze([
  { id: 'authorized_import', label: '客户授权线索导入（CSV / JSON）', kind: 'import', implemented: true,
    note: '运营导入客户授权的历史询盘、展会名录或客户名单；每条必须带来源 URL、抓取日期与逐字摘录。' },
  { id: 'serper', label: 'Serper 搜索 API', kind: 'search', implemented: true, environmentKey: 'SERPER_API_KEY',
    note: '配置 SERPER_API_KEY 后按计划 query 搜索公开网页；结果必须带来源 URL 与摘要，进入人工审核。' },
  { id: 'companies_house', label: 'UK Companies House API', kind: 'registry', implemented: true, environmentKey: 'COMPANIES_HOUSE_API_KEY',
    note: '配置 COMPANIES_HOUSE_API_KEY 后按 query 检索英国公司登记；主体真实但需人工核验产品匹配。' },
]);


export class AiWorkError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}
const fail = (status, code, message) => { throw new AiWorkError(status, code, message); };
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const identifier = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.:@|/-]{0,127}$/u.test(value);
const iso = value => typeof value === 'string' && Number.isFinite(Date.parse(value));
const control = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u;

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  return value;
}
const digest = value => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');

function text(value, field, max, { required = true } = {}) {
  if (value === undefined || value === null) {
    if (required) fail(400, 'INVALID_INPUT', `${field} 必填。`);
    return '';
  }
  if (typeof value !== 'string' || value.length > max || control.test(value) || (required && !value.trim())) fail(400, 'INVALID_INPUT', `${field} 必须是 ${required ? '1' : '0'}–${max} 字符的纯文本。`);
  return value.trim();
}
function integer(value, field, min, max, fallback) {
  if (value === undefined || value === null) {
    if (fallback !== undefined) return fallback;
    fail(400, 'INVALID_INPUT', `${field} 必填。`);
  }
  if (!Number.isSafeInteger(value) || value < min || value > max) fail(400, 'INVALID_INPUT', `${field} 必须是 ${min}–${max} 之间的整数。`);
  return value;
}
function onlyFields(body, allowed, label) {
  if (!isObject(body)) fail(400, 'INVALID_INPUT', `${label} 必须是 JSON 对象。`);
  for (const key of Object.keys(body)) if (!allowed.includes(key)) fail(400, 'INVALID_INPUT', `不支持的字段：${key}。`);
  return body;
}

/* ------------------------------------------------------------------------- */
/* Country playbooks (localization, market notes and cold-email policy)       */
/* ------------------------------------------------------------------------- */

const COUNTRY_ROWS = [
  // code, nameZh, nameEn, language, languageName, currency, region, tld, coldEmailPolicy, aliases
  ['US', '美国', 'United States', 'en', '英语', 'USD', 'North America', 'com', 'allowed', ['us', 'usa', 'america', 'united states', '美国', '美利坚']],
  ['CA', '加拿大', 'Canada', 'en', '英语/法语', 'CAD', 'North America', 'ca', 'allowed', ['ca', 'canada', '加拿大']],
  ['GB', '英国', 'United Kingdom', 'en', '英语', 'GBP', 'Europe', 'co.uk', 'notice_and_objection', ['gb', 'uk', 'britain', 'england', 'united kingdom', '英国']],
  ['IE', '爱尔兰', 'Ireland', 'en', '英语', 'EUR', 'Europe', 'ie', 'notice_and_objection', ['ie', 'ireland', '爱尔兰']],
  ['DE', '德国', 'Germany', 'de', '德语', 'EUR', 'Europe', 'de', 'consent_required', ['de', 'germany', 'deutschland', '德国']],
  ['AT', '奥地利', 'Austria', 'de', '德语', 'EUR', 'Europe', 'at', 'consent_required', ['at', 'austria', '奥地利']],
  ['CH', '瑞士', 'Switzerland', 'de', '德语/法语/意大利语', 'CHF', 'Europe', 'ch', 'notice_and_objection', ['ch', 'switzerland', '瑞士']],
  ['FR', '法国', 'France', 'fr', '法语', 'EUR', 'Europe', 'fr', 'notice_and_objection', ['fr', 'france', '法国']],
  ['ES', '西班牙', 'Spain', 'es', '西班牙语', 'EUR', 'Europe', 'es', 'notice_and_objection', ['es', 'spain', '西班牙']],
  ['IT', '意大利', 'Italy', 'it', '意大利语', 'EUR', 'Europe', 'it', 'notice_and_objection', ['it', 'italy', '意大利']],
  ['NL', '荷兰', 'Netherlands', 'nl', '荷兰语', 'EUR', 'Europe', 'nl', 'notice_and_objection', ['nl', 'netherlands', 'holland', '荷兰']],
  ['BE', '比利时', 'Belgium', 'nl', '荷兰语/法语', 'EUR', 'Europe', 'be', 'notice_and_objection', ['be', 'belgium', '比利时']],
  ['PL', '波兰', 'Poland', 'pl', '波兰语', 'PLN', 'Europe', 'pl', 'notice_and_objection', ['pl', 'poland', '波兰']],
  ['SE', '瑞典', 'Sweden', 'sv', '瑞典语', 'SEK', 'Europe', 'se', 'notice_and_objection', ['se', 'sweden', '瑞典']],
  ['DK', '丹麦', 'Denmark', 'da', '丹麦语', 'DKK', 'Europe', 'dk', 'notice_and_objection', ['dk', 'denmark', '丹麦']],
  ['NO', '挪威', 'Norway', 'no', '挪威语', 'NOK', 'Europe', 'no', 'notice_and_objection', ['no', 'norway', '挪威']],
  ['FI', '芬兰', 'Finland', 'fi', '芬兰语', 'EUR', 'Europe', 'fi', 'notice_and_objection', ['fi', 'finland', '芬兰']],
  ['PT', '葡萄牙', 'Portugal', 'pt', '葡萄牙语', 'EUR', 'Europe', 'pt', 'notice_and_objection', ['pt', 'portugal', '葡萄牙']],
  ['GR', '希腊', 'Greece', 'el', '希腊语', 'EUR', 'Europe', 'gr', 'notice_and_objection', ['gr', 'greece', '希腊']],
  ['CZ', '捷克', 'Czechia', 'cs', '捷克语', 'CZK', 'Europe', 'cz', 'notice_and_objection', ['cz', 'czech', 'czechia', '捷克']],
  ['RO', '罗马尼亚', 'Romania', 'ro', '罗马尼亚语', 'RON', 'Europe', 'ro', 'notice_and_objection', ['ro', 'romania', '罗马尼亚']],
  ['TR', '土耳其', 'Türkiye', 'tr', '土耳其语', 'TRY', 'Europe/Asia', 'com.tr', 'notice_and_objection', ['tr', 'turkey', 'türkiye', 'türkiye', '土耳其']],
  ['RU', '俄罗斯', 'Russia', 'ru', '俄语', 'RUB', 'Europe/Asia', 'ru', 'notice_and_objection', ['ru', 'russia', '俄罗斯']],
  ['AU', '澳大利亚', 'Australia', 'en', '英语', 'AUD', 'Oceania', 'com.au', 'allowed', ['au', 'australia', '澳大利亚']],
  ['NZ', '新西兰', 'New Zealand', 'en', '英语', 'NZD', 'Oceania', 'co.nz', 'allowed', ['nz', 'new zealand', '新西兰']],
  ['JP', '日本', 'Japan', 'ja', '日语', 'JPY', 'Asia', 'jp', 'notice_and_objection', ['jp', 'japan', '日本']],
  ['KR', '韩国', 'South Korea', 'ko', '韩语', 'KRW', 'Asia', 'kr', 'notice_and_objection', ['kr', 'korea', 'south korea', '韩国']],
  ['CN', '中国', 'China', 'zh', '中文', 'CNY', 'Asia', 'cn', 'notice_and_objection', ['cn', 'china', '中国']],
  ['IN', '印度', 'India', 'en', '英语/印地语', 'INR', 'Asia', 'in', 'notice_and_objection', ['in', 'india', '印度']],
  ['SG', '新加坡', 'Singapore', 'en', '英语', 'SGD', 'Asia', 'sg', 'notice_and_objection', ['sg', 'singapore', '新加坡']],
  ['MY', '马来西亚', 'Malaysia', 'en', '英语/马来语', 'MYR', 'Asia', 'com.my', 'notice_and_objection', ['my', 'malaysia', '马来西亚']],
  ['TH', '泰国', 'Thailand', 'th', '泰语', 'THB', 'Asia', 'co.th', 'notice_and_objection', ['th', 'thailand', '泰国']],
  ['VN', '越南', 'Vietnam', 'vi', '越南语', 'VND', 'Asia', 'vn', 'notice_and_objection', ['vn', 'vietnam', '越南']],
  ['ID', '印度尼西亚', 'Indonesia', 'id', '印尼语', 'IDR', 'Asia', 'co.id', 'notice_and_objection', ['id', 'indonesia', '印度尼西亚', '印尼']],
  ['PH', '菲律宾', 'Philippines', 'en', '英语', 'PHP', 'Asia', 'ph', 'notice_and_objection', ['ph', 'philippines', '菲律宾']],
  ['AE', '阿联酋', 'United Arab Emirates', 'en', '英语/阿拉伯语', 'AED', 'Middle East', 'ae', 'notice_and_objection', ['ae', 'uae', 'emirates', 'dubai', '阿联酋', '迪拜']],
  ['SA', '沙特阿拉伯', 'Saudi Arabia', 'en', '英语/阿拉伯语', 'SAR', 'Middle East', 'com.sa', 'notice_and_objection', ['sa', 'saudi', 'saudi arabia', '沙特', '沙特阿拉伯']],
  ['IL', '以色列', 'Israel', 'he', '希伯来语', 'ILS', 'Middle East', 'co.il', 'notice_and_objection', ['il', 'israel', '以色列']],
  ['ZA', '南非', 'South Africa', 'en', '英语', 'ZAR', 'Africa', 'co.za', 'notice_and_objection', ['za', 'south africa', '南非']],
  ['EG', '埃及', 'Egypt', 'en', '英语/阿拉伯语', 'EGP', 'Africa', 'com.eg', 'notice_and_objection', ['eg', 'egypt', '埃及']],
  ['NG', '尼日利亚', 'Nigeria', 'en', '英语', 'NGN', 'Africa', 'com.ng', 'notice_and_objection', ['ng', 'nigeria', '尼日利亚']],
  ['MX', '墨西哥', 'Mexico', 'es', '西班牙语', 'MXN', 'Latin America', 'com.mx', 'notice_and_objection', ['mx', 'mexico', '墨西哥']],
  ['BR', '巴西', 'Brazil', 'pt', '葡萄牙语', 'BRL', 'Latin America', 'com.br', 'notice_and_objection', ['br', 'brazil', '巴西']],
  ['AR', '阿根廷', 'Argentina', 'es', '西班牙语', 'ARS', 'Latin America', 'com.ar', 'notice_and_objection', ['ar', 'argentina', '阿根廷']],
  ['CL', '智利', 'Chile', 'es', '西班牙语', 'CLP', 'Latin America', 'cl', 'notice_and_objection', ['cl', 'chile', '智利']],
  ['CO', '哥伦比亚', 'Colombia', 'es', '西班牙语', 'COP', 'Latin America', 'com.co', 'notice_and_objection', ['co', 'colombia', '哥伦比亚']],
  ['PE', '秘鲁', 'Peru', 'es', '西班牙语', 'PEN', 'Latin America', 'com.pe', 'notice_and_objection', ['pe', 'peru', '秘鲁']],
];
const countryIndex = new Map();
for (const [code, nameZh, nameEn, language, languageName, currency, region, tld, coldEmailPolicy, aliases] of COUNTRY_ROWS) {
  const row = Object.freeze({ code, nameZh, nameEn, language, languageName, currency, region, tld, coldEmailPolicy });
  for (const alias of [code, nameZh, nameEn, ...aliases]) countryIndex.set(alias.toLocaleLowerCase(), row);
}
export function resolveCountry(raw, { field = 'targetCountry' } = {}) {
  const value = text(raw, field, 80);
  const hit = countryIndex.get(value.toLocaleLowerCase());
  if (hit) return { ...hit, known: true };
  // Unknown but explicit markets stay usable: the plan degrades to a generic
  // profile and flags the missing localization instead of inventing one.
  return { code: null, nameZh: value, nameEn: value, language: 'en', languageName: '英语/当地语言', currency: null, region: 'unknown', tld: null, coldEmailPolicy: 'notice_and_objection', known: false };
}

/* ------------------------------------------------------------------------- */
/* Procurement customer (buyer) type playbooks                                */
/* ------------------------------------------------------------------------- */

const BUYER_TYPE_ROWS = [
  {
    id: 'importer', labelZh: '进口商', labelEn: 'importer',
    definition: '以进口并在本国批发、分销或供货为主的企业，通常有报关、仓储和分销能力。',
    decisionRoles: ['Purchasing Manager', 'Import Manager', 'Category Buyer', 'Managing Director'],
    buyingSignals: ['有相关品类的进口记录', '有仓储或分销能力', '经营多个相关品类', '有自有品牌或贴牌需求'],
    disqualifiers: ['只做本地服务的终端门店', '与客户现有客户重叠'],
    aliases: ['importer', 'importers', '进口商', '进口', '进口批发'],
  },
  {
    id: 'distributor', labelZh: '分销商', labelEn: 'distributor',
    definition: '在目标国家代理或分销品牌/品类，覆盖批发、零售或工程渠道的企业。',
    decisionRoles: ['Purchasing Director', 'Category Manager', 'Sales Director', 'Owner'],
    buyingSignals: ['官网展示相关品类与品牌', '有区域覆盖或经销网络', '参加行业展会', '有库存/物流中心'],
    disqualifiers: ['只做单一品牌且明确排他', '规模明显不匹配'],
    aliases: ['distributor', 'distributors', '分销商', '代理', '代理商'],
  },
  {
    id: 'dealer', labelZh: '经销商', labelEn: 'dealer',
    definition: '面向专业客户或终端销售相关产品的经销企业，常按区域或行业划分。',
    decisionRoles: ['Buyer', 'Purchasing', 'Store/General Manager', 'Owner'],
    buyingSignals: ['经营相关品类', '有线下网点或专业销售团队', '有售后服务能力'],
    disqualifiers: ['仅销售无关品类', '无稳定采购记录'],
    aliases: ['dealer', 'dealers', '经销商', '门店', '专卖'],
  },
  {
    id: 'wholesaler', labelZh: '批发商', labelEn: 'wholesaler',
    definition: '以批发、现货和渠道分销为主的采购方，价格与供货稳定性敏感。',
    decisionRoles: ['Purchasing Manager', 'Buyer', 'Owner'],
    buyingSignals: ['批发目录/价目表', '大包装或整柜采购习惯', '仓储能力'],
    disqualifiers: ['只做零售小单', '无相关品类',
    ],
    aliases: ['wholesaler', 'wholesalers', '批发商', '批发'],
  },
  {
    id: 'retail_chain', labelZh: '连锁零售', labelEn: 'retail chain',
    definition: '有门店网络或电商渠道的零售连锁，适合做自有品牌或品类采购。',
    decisionRoles: ['Category Buyer', 'Sourcing Manager', 'Private Label Manager'],
    buyingSignals: ['门店数量与覆盖区域', '有自有品牌', '供应商准入流程'],
    disqualifiers: ['无自有采购权', '仅单店经营'],
    aliases: ['retail chain', 'retailer', 'retail', '连锁零售', '零售连锁', '商超', '连锁'],
  },
  {
    id: 'brand_owner', labelZh: '品牌商', labelEn: 'brand owner',
    definition: '拥有品牌、寻找 OEM/ODM 或长期供货伙伴的品牌企业。',
    decisionRoles: ['Sourcing Director', 'Product Manager', 'Head of Supply Chain'],
    buyingSignals: ['公开产品线与定位', '官网招聘供应链岗位', '有代工/贴牌线索'],
    disqualifiers: ['无产品线', '仅做营销转售且无采购能力'],
    aliases: ['brand owner', 'brand', '品牌商', '品牌', '贴牌'],
  },
  {
    id: 'ecommerce_seller', labelZh: '电商卖家', labelEn: 'e-commerce seller',
    definition: '以 Amazon/独立站/本地电商平台销售为主的卖方，关注小批量、快周转。',
    decisionRoles: ['Owner', 'Sourcing Manager', 'Operations Manager'],
    buyingSignals: ['店铺在售相关品类', '有自有品牌', '有海外仓或本地仓'],
    disqualifiers: ['纯 dropshipping 且无采购决策权', '无相关品类'],
    aliases: ['e-commerce', 'ecommerce', 'online seller', '电商', '电商卖家', '跨境卖家'],
  },
  {
    id: 'contractor', labelZh: '工程承包商', labelEn: 'contractor',
    definition: '项目型采购方，常通过招标或项目采购获取产品与材料。',
    decisionRoles: ['Procurement Manager', 'Project Manager', 'Site Manager'],
    buyingSignals: ['公开项目/招标记录', '相关资质', '长期供应商名录'],
    disqualifiers: ['无相关项目经验', '仅分包无采购权'],
    aliases: ['contractor', 'contractors', '工程承包商', '工程', '施工'],
  },
  {
    id: 'oem_buyer', labelZh: 'OEM/ODM 采购', labelEn: 'OEM/ODM buyer',
    definition: '以代工/贴牌采购为主的企业，关注产能、认证、打样与长期协议。',
    decisionRoles: ['Sourcing Manager', 'Supply Chain Manager', 'Product Development'],
    buyingSignals: ['有自有品牌', '公开供应商要求', '有打样/认证需求'],
    disqualifiers: ['只做贸易转手', '无产品开发能力'],
    aliases: ['oem', 'odm', 'oem/odm', '代工', '贴牌采购', 'oem采购'],
  },
  {
    id: 'trading_company', labelZh: '贸易公司', labelEn: 'trading company',
    definition: '作为中间商采购并转售的贸易企业，决策快、品类跨度大。',
    decisionRoles: ['Buyer', 'Sales Manager', 'Owner'],
    buyingSignals: ['经营多国/多品类', '有客户资源', '有进出口能力'],
    disqualifiers: ['与客户现有客户重叠', '无实际采购能力'],
    aliases: ['trading company', 'trading', 'trader', '贸易公司', '贸易商'],
  },
];
const buyerTypeIndex = new Map();
for (const row of BUYER_TYPE_ROWS) {
  const normalized = Object.freeze({
    ...row,
    buyingSignals: Object.freeze([...row.buyingSignals]),
    disqualifiers: Object.freeze([...row.disqualifiers]),
    decisionRoles: Object.freeze([...row.decisionRoles]),
    aliases: undefined,
  });
  for (const alias of [row.id, row.labelZh, row.labelEn, ...row.aliases]) buyerTypeIndex.set(alias.toLocaleLowerCase(), normalized);
}
export function resolveBuyerType(raw, { field = 'buyerType' } = {}) {
  const value = text(raw, field, 80);
  const hit = buyerTypeIndex.get(value.toLocaleLowerCase());
  if (hit) return { ...hit, known: true };
  return {
    id: 'generic_procurement', labelZh: value, labelEn: value, known: false,
    definition: '按输入指定的采购客户类型；缺少预置画像，需人工补充该类型的定义、决策角色与采购信号。',
    decisionRoles: ['Purchasing Manager', 'Buyer', 'Owner'],
    buyingSignals: ['采购相关品类', '有公开采购/分销信号'],
    disqualifiers: ['与客户现有客户重叠', '无采购决策权'],
  };
}

export const COLD_EMAIL_POLICY_NOTES = Object.freeze({
  allowed: '该国允许 B2B 商务邮件触达，但仍须真实发件人、物理地址、退订链接，并遵守当地反垃圾与隐私法。',
  notice_and_objection: '该国 B2B 冷邮件通常按"事先告知 + 可随时反对"处理；首封须说明身份、目的、数据来源与退订方式，反对即加入抑制名单。',
  consent_required: '该国 B2B 冷邮件需要事先明确同意（如德国 UWG §7）；默认不发送冷邮件，先走展会、线下或客户已有关系。',
});

/* ------------------------------------------------------------------------- */
/* First published AI-work: overseas procurement-customer lead discovery      */
/* ------------------------------------------------------------------------- */

export function leadDiscoveryDefinition() {
  return {
    id: 'lead-discovery',
    playbook: 'lead-discovery',
    name: '客户线索挖掘',
    nameEn: 'Overseas procurement-customer lead discovery',
    summary: '从企业产品库选择真实产品，输入目标国家与采购客户类型，生成一份可执行的海外买家开发计划，并建立"开发计划委托"；执行阶段交付带证据的候选买家线索（不编造、不外发）。',
    category: '线索发现',
    inputSchema: {
      fields: [
        { name: 'productId', label: '产品库产品', type: 'product_ref', required: true, description: '选择企业产品库中的产品；委托会钉住该产品的 revision 与 SHA-256，品类/规格/供货条件以产品库为准' },
        { name: 'targetCountry', label: '目标国家', type: 'string', required: true, maxLength: 80, description: '如：美国、德国、United States、US' },
        { name: 'buyerType', label: '采购客户类型', type: 'string', required: true, maxLength: 80, description: '如：进口商、分销商、连锁零售、品牌商、OEM 采购' },
        { name: 'productScope', label: '产品/品类范围', type: 'string', required: false, maxLength: 200, description: '留空时计划会标记"待产品档案确认"' },
        { name: 'targetCount', label: '目标候选线索数', type: 'integer', required: false, minimum: 5, maximum: 500, default: 50 },
        { name: 'budgetCredits', label: '内部预算（点数）', type: 'integer', required: false, minimum: 5, maximum: 10000, default: 20 },
        { name: 'deadlineDays', label: '交付周期（天）', type: 'integer', required: false, minimum: 3, maximum: 90, default: 30 },
        { name: 'notes', label: '补充说明', type: 'string', required: false, maxLength: 1000 },
      ],
    },
    workflow: [
      { id: 'intake', title: '受理与输入校验', owner: 'human', output: '开发计划委托（draft）' },
      { id: 'product-profile-check', title: '读取产品库精确版本并核对事实缺口', owner: 'agent', output: '产品事实快照（productId/revision/SHA-256）' },
      { id: 'plan', title: '生成开发计划书', owner: 'agent', output: '开发计划书（Markdown 工件）' },
      { id: 'plan-approval', title: '人工确认开发计划', owner: 'human', output: '已批准的委托范围' },
      { id: 'discover', title: '首批候选买家发现', owner: 'agent', output: '候选买家清单（带来源）' },
      { id: 'enrich', title: '背调、去重与证据整理', owner: 'agent', output: '买家证据卡' },
      { id: 'review', title: '人工审核线索质量', owner: 'human', output: '合格线索池' },
      { id: 'outreach', title: '生成开发信草稿（发送需另行审批）', owner: 'agent', output: '开发信草稿' },
      { id: 'report', title: '周报与阶段复盘', owner: 'agent', output: '周报工件' },
    ],
    deliverables: [
      '开发计划书（本委托创建时生成并保存为不可变工件）',
      '产品事实快照（来自企业产品库的精确 revision 与 SHA-256，含缺项清单）',
      '带公开来源与抓取时间的候选买家清单（CSV/JSON）',
      '买家证据卡（每条结论可追溯到来源 URL、时间与摘录）',
      '开发信草稿（未发送；发送前必须逐批人工审批）',
      '周报（线索数、合格数、回复数、下一步）',
    ],
    acceptance: [
      '产品事实必须来自企业产品库的精确版本（productId + revision + SHA-256）；缺项标记待补，不得编造',
      '每条线索必须能打开公开来源，并记录抓取时间与摘录',
      '同一公司或域名只保留一条，跨源重复必须合并',
      '不得编造联系人、认证、价格、交期或采购量',
      '任何外发必须存在对应的审批记录；未审批发送视为失败',
      '德国等需事先同意的市场默认不发送冷邮件',
      '数据源、模型或执行器未配置时，委托明确停在"待执行"，不生成假线索',
    ],
  };
}

/* ------------------------------------------------------------------------- */
/* Product definition validation and publication                               */
/* ------------------------------------------------------------------------- */

const PRODUCT_BODY_FIELDS = ['id', 'playbook', 'name', 'nameEn', 'summary', 'category', 'inputSchema', 'workflow', 'deliverables', 'acceptance', 'requestId', 'expectedRevision', 'status', 'changeNote'];
const INPUT_FIELD_FIELDS = ['name', 'label', 'type', 'required', 'maxLength', 'minimum', 'maximum', 'default', 'description'];
const WORKFLOW_STEP_FIELDS = ['id', 'title', 'owner', 'output'];
const INPUT_NAME = /^[a-zA-Z][a-zA-Z0-9]{0,63}$/u;

function normalizeInputField(field, index) {
  if (!isObject(field)) fail(400, 'INVALID_INPUT', `inputSchema.fields[${index}] 必须是对象。`);
  onlyFields(field, INPUT_FIELD_FIELDS, `inputSchema.fields[${index}]`);
  if (typeof field.name !== 'string' || !INPUT_NAME.test(field.name)) fail(400, 'INVALID_INPUT', `inputSchema.fields[${index}].name 必须是字母开头的字段名。`);
  const type = field.type === undefined ? 'string' : field.type;
  if (!['string', 'integer', 'product_ref'].includes(type)) fail(400, 'INVALID_INPUT', `inputSchema.fields[${index}].type 只支持 string/integer/product_ref。`);
  const base = {
    name: field.name,
    label: text(field.label, `inputSchema.fields[${index}].label`, 60),
    type,
    required: field.required === undefined ? false : field.required === true,
  };
  if (field.description !== undefined) base.description = text(field.description, `inputSchema.fields[${index}].description`, 300, { required: false });
  if (type === 'product_ref') {
    // A product_ref is resolved against the enterprise product library at
    // delegation time; the delegation pins the exact revision and SHA-256.
    if (!base.required && field.default !== undefined) fail(400, 'INVALID_INPUT', `inputSchema.fields[${index}] 是 product_ref，不能用 default。`);
  } else if (type === 'string') {
    base.maxLength = field.maxLength === undefined ? 200 : integer(field.maxLength, `inputSchema.fields[${index}].maxLength`, 1, 2000);
    if (field.default !== undefined) {
      if (typeof field.default !== 'string' || field.default.length > base.maxLength) fail(400, 'INVALID_INPUT', `inputSchema.fields[${index}].default 必须是字符串。`);
      base.default = field.default;
    }
  } else {
    base.minimum = field.minimum === undefined ? 0 : integer(field.minimum, `inputSchema.fields[${index}].minimum`, 0, 1_000_000);
    base.maximum = field.maximum === undefined ? 1_000_000 : integer(field.maximum, `inputSchema.fields[${index}].maximum`, base.minimum, 1_000_000);
    if (field.default !== undefined) base.default = integer(field.default, `inputSchema.fields[${index}].default`, base.minimum, base.maximum);
  }
  return base;
}

export function normalizeProductDefinition(body) {
  onlyFields(body, PRODUCT_BODY_FIELDS, 'AI-work 产品');
  if (typeof body.id !== 'string' || !PRODUCT_ID.test(body.id)) fail(400, 'INVALID_INPUT', '产品 id 必须是小写字母开头的 kebab-case（如 lead-discovery）。');
  const playbook = body.playbook === undefined ? 'lead-discovery' : body.playbook;
  if (!SUPPORTED_PLAYBOOKS.includes(playbook)) fail(400, 'UNSUPPORTED_PLAYBOOK', `当前只注册了 playbook：${SUPPORTED_PLAYBOOKS.join(', ')}。`);
  if (!isObject(body.inputSchema) || Object.keys(body.inputSchema).some(key => key !== 'fields') || !Array.isArray(body.inputSchema.fields)) fail(400, 'INVALID_INPUT', 'inputSchema 必须形如 { fields: [...] }。');
  if (body.inputSchema.fields.length < 1 || body.inputSchema.fields.length > 20) fail(400, 'INVALID_INPUT', 'inputSchema.fields 必须包含 1–20 个字段。');
  const fields = body.inputSchema.fields.map(normalizeInputField);
  if (new Set(fields.map(field => field.name)).size !== fields.length) fail(400, 'INVALID_INPUT', 'inputSchema 字段名不能重复。');
  if (!Array.isArray(body.workflow) || body.workflow.length < 1 || body.workflow.length > 20) fail(400, 'INVALID_INPUT', 'workflow 必须包含 1–20 个步骤。');
  const workflow = body.workflow.map((step, index) => {
    if (!isObject(step)) fail(400, 'INVALID_INPUT', `workflow[${index}] 必须是对象。`);
    onlyFields(step, WORKFLOW_STEP_FIELDS, `workflow[${index}]`);
    if (typeof step.id !== 'string' || !PRODUCT_ID.test(step.id)) fail(400, 'INVALID_INPUT', `workflow[${index}].id 必须是小写 kebab-case。`);
    const owner = step.owner === undefined ? 'agent' : step.owner;
    if (!['agent', 'human'].includes(owner)) fail(400, 'INVALID_INPUT', `workflow[${index}].owner 只支持 agent/human。`);
    return { id: step.id, title: text(step.title, `workflow[${index}].title`, 100), owner, output: text(step.output, `workflow[${index}].output`, 140) };
  });
  if (new Set(workflow.map(step => step.id)).size !== workflow.length) fail(400, 'INVALID_INPUT', 'workflow 步骤 id 不能重复。');
  const strings = (value, field, maxItems, maxLength) => {
    if (!Array.isArray(value) || value.length < 1 || value.length > maxItems) fail(400, 'INVALID_INPUT', `${field} 必须包含 1–${maxItems} 项。`);
    return value.map((item, index) => text(item, `${field}[${index}]`, maxLength));
  };
  const definition = {
    id: body.id,
    playbook,
    name: text(body.name, 'name', 100),
    nameEn: text(body.nameEn, 'nameEn', 160, { required: false }),
    summary: text(body.summary, 'summary', 600),
    category: text(body.category === undefined ? '其他' : body.category, 'category', 60),
    inputSchema: { fields },
    workflow,
    deliverables: strings(body.deliverables, 'deliverables', 20, 200),
    acceptance: strings(body.acceptance, 'acceptance', 20, 300),
  };
  return { definition, contentHash: digest(definition) };
}

/* ------------------------------------------------------------------------- */
/* Development-plan generation (deterministic playbook)                       */
/* ------------------------------------------------------------------------- */

const APPROVAL_GATES = Object.freeze({
  'lead-discovery': ['plan_approval', 'lead_review', 'outreach_send'],
});
const REQUIRED_SIGNALS = Object.freeze({
  'lead-discovery': ['buyer_direct_search', 'wholesale_directory', 'trade_show', 'expansion_news'],
});

function buildQueries(country, buyerType, productScope) {
  const scope = productScope || '{产品/品类待产品档案确认}';
  const queries = [
    { purpose: 'buyer_direct_search', query: `"${buyerType.labelEn}" "${scope}" ${country.nameEn}`, source: 'web_search', language: country.language },
    { purpose: 'wholesale_directory', query: `"${country.nameEn}" wholesale ${buyerType.labelEn} "${scope}"`, source: 'web_search', language: country.language },
    { purpose: 'trade_show', query: `"${country.nameEn}" "${scope}" trade fair exhibitor list`, source: 'web_search', language: 'en' },
    { purpose: 'expansion_news', query: `"${country.nameEn}" "${scope}" distributor warehouse OR expansion OR "new line"`, source: 'web_search', language: 'en' },
    { purpose: 'linkedin_manual', query: `site:linkedin.com/company "${scope}" "${country.nameEn}" ${buyerType.labelEn}`, source: 'manual_browse_only', language: 'en' },
    { purpose: 'customs_hint', query: `"${scope}" importer ${country.nameEn} import records`, source: 'paid_data_optional', language: 'en' },
  ];
  if (country.tld && !['com', 'org', 'net'].includes(country.tld)) queries.splice(2, 0, { purpose: 'country_domain_scan', query: `site:${country.tld} "${scope}" ${buyerType.labelEn} importer OR distributor`, source: 'web_search', language: country.language });
  return queries;
}

function buildSources(country) {
  return [
    { id: 'customer_authorized_import', label: '客户授权的历史询盘 / 展会名录 / 自有客户名单', availability: 'requires_customer_data', note: '合规且零外部成本，首批候选优先从这里来' },
    { id: 'web_search', label: '公开网页搜索（Serper / Tavily 等）', availability: 'requires_host_configuration', note: '需宿主配置搜索 API；不抓取需登录或付费墙内容' },
    { id: 'company_registry', label: country.code === 'GB' ? 'UK Companies House（免费 API）' : '公开企业登记 / 主体核验', availability: country.code === 'GB' ? 'supported_pending_key' : 'optional_by_market', note: '用于核验公司主体真实性' },
    { id: 'trade_show_directory', label: '展会 / 行业名录', availability: 'manual_or_licensed_only', note: '只使用公开或客户授权名录，不绕过平台条款' },
    { id: 'customs_data', label: '海关 / 提单数据', availability: 'paid_optional', note: '付费数据源；合同须确认来源合法与展示权' },
    { id: 'linkedin', label: 'LinkedIn 人工辅助', availability: 'manual_assist_only', note: '禁止自动化抓取或群发，只能人工查看辅助' },
  ];
}

function stepDays(deadlineDays, index, total) {
  if (total <= 1) return 0;
  return Math.max(0, Math.min(deadlineDays, Math.round((deadlineDays * index) / (total - 1))));
}

const SUPPLY_FACT_KEYS = Object.freeze(['packaging', 'samplePolicy', 'paymentTerms', 'shippingTerms', 'capacityNote']);

/** Canonical SHA-256 of an exact product-library revision (pinned by delegations). */
export function productContentHash(product) {
  return digest(product);
}

/**
 * Reduce an enterprise product-library record to the facts the development
 * plan may use. Missing fields stay explicit; nothing is defaulted or invented.
 */
export function extractProductFacts(product) {
  if (!isObject(product)) fail(400, 'INVALID_PRODUCT', '产品库记录无效。');
  const skus = Array.isArray(product.skus) ? product.skus : [];
  const supply = isObject(product.supply) ? product.supply : {};
  const missing = [];
  for (const key of ['name', 'category', 'description']) {
    if (typeof product[key] !== 'string' || !product[key].trim()) missing.push(key);
  }
  if (!skus.length) missing.push('skus');
  for (const key of SUPPLY_FACT_KEYS) if (typeof supply[key] !== 'string' || !supply[key].trim()) missing.push(`supply.${key}`);
  return {
    productId: product.id,
    revision: product.revision,
    sha256: productContentHash(product),
    name: typeof product.name === 'string' ? product.name : '',
    category: typeof product.category === 'string' ? product.category : '',
    description: typeof product.description === 'string' ? product.description.slice(0, 800) : '',
    skus: skus.slice(0, 10).map(sku => ({
      code: typeof sku?.code === 'string' ? sku.code : '',
      unit: typeof sku?.unit === 'string' ? sku.unit : '',
      specs: Array.isArray(sku?.specs) ? sku.specs.slice(0, 8).map(spec => ({ key: String(spec?.key || ''), value: String(spec?.value || '') })) : [],
      moq: Number.isSafeInteger(sku?.moq) ? sku.moq : null,
      leadTimeDays: Number.isSafeInteger(sku?.leadTimeDays) ? sku.leadTimeDays : null,
      pricingMode: typeof sku?.pricingMode === 'string' ? sku.pricingMode : 'unset',
    })),
    supply: Object.fromEntries(SUPPLY_FACT_KEYS.map(key => [key, typeof supply[key] === 'string' ? supply[key] : ''])),
    documents: Array.isArray(product.documents) ? product.documents.length : 0,
    images: Array.isArray(product.images) ? product.images.length : 0,
    sourceKind: isObject(product.source) && typeof product.source.kind === 'string' ? product.source.kind : 'unknown',
    missingFields: missing,
    factCompleteness: missing.length === 0 ? 'complete' : missing.length <= 2 ? 'partial' : 'incomplete',
  };
}

export function buildDevelopmentPlan({ product, input, country, buyerType, productFacts = null, now = new Date().toISOString() }) {
  const deadlineDays = input.deadlineDays;
  const deadlineAt = new Date(Date.parse(now) + deadlineDays * 86_400_000).toISOString();
  const firstBatchDays = Math.min(3, Math.max(1, Math.floor(deadlineDays / 5)));
  const factScope = productFacts ? [productFacts.category, productFacts.name].filter(Boolean).join(' / ') : '';
  const scope = input.productScope || factScope || '（产品/品类待产品档案确认）';
  const gates = APPROVAL_GATES[product.playbook] || ['plan_approval'];
  const workflow = product.workflow.map((step, index) => ({
    id: step.id,
    title: step.title,
    owner: step.owner,
    output: step.output,
    dueInDays: step.id === 'plan' ? 0 : step.id === 'discover' ? firstBatchDays : stepDays(deadlineDays, index, product.workflow.length),
    status: 'pending',
  }));
  const discovery = {
    targetCount: input.targetCount,
    probeCount: Math.max(input.targetCount * 3, 30),
    queries: buildQueries(country, buyerType, input.productScope || factScope),
    sources: buildSources(country),
    dedupeKeys: ['companyNameNormalized', 'websiteDomain'],
    qualityGates: [
      '候选公司真实存在：官网或公开登记可核验',
      '与输入国家、采购客户类型、产品范围匹配，且有可引用的页面证据',
      '至少 1 个采购信号（品类页面 / 进口记录 / 展会 / 渠道覆盖）',
      '联系方式仅使用公开可见信息，并标注验证状态',
      '同一公司或域名只保留一条',
    ],
  };
  const buyerProfile = {
    type: buyerType.labelZh,
    typeEn: buyerType.labelEn,
    known: buyerType.known,
    definition: buyerType.definition,
    decisionRoles: buyerType.decisionRoles,
    buyingSignals: buyerType.buyingSignals,
    disqualifiers: buyerType.disqualifiers,
    languageHint: country.language === 'en' ? '英文开发信' : `建议使用${country.languageName}或英文`,
  };
  const notes = [];
  if (!country.known) notes.push('目标国家未在预置市场表中，本地化建议与合规提示为通用版本，执行前需人工补充。');
  if (!buyerType.known) notes.push('采购客户类型未在预置画像中，买家画像为通用模板，需人工补充该类型的决策角色与采购信号。');
  if (!input.productScope && !factScope) notes.push('产品库与输入均未提供产品/品类范围：搜索词中的 {产品/品类} 占位符需在产品档案确认后替换。');
  if (productFacts?.missingFields?.length) notes.push(`产品库事实缺口：${productFacts.missingFields.join('、')}；执行前需在产品库补齐，计划中不猜测这些字段。`);
  const risks = [
    '数据源、模型或执行器未配置时，委托会停在"待执行"，不会生成假线索。',
    COLD_EMAIL_POLICY_NOTES[country.coldEmailPolicy],
    '冷邮件需要 2–4 周域名预热；首月日发送量应受控，并持续监控退信与投诉率。',
    '人工审核是质量闸门：每批候选都需要逐条确认证据，不能以数量代替质量。',
    '客户已有客户与在谈商机必须排除，避免撞单。',
  ];
  if (productFacts && productFacts.factCompleteness !== 'complete') risks.push('产品事实不完整：开发信与报价口径可能失真，必须在创建开发信草稿前补齐或由人工确认。');
  const plan = {
    schema: 'workspace.development-plan.v1',
    generator: 'lead-discovery-playbook-v1',
    generatedAt: now,
    aiWork: { id: product.id, revision: product.revision, contentHash: product.contentHash },
    productFacts: productFacts || null,
    objective: `为产品库产品「${productFacts?.name || scope}」在${country.nameZh}开发 ${input.targetCount} 条${buyerType.labelZh}类采购客户候选线索（${scope}），先交付可核验的候选清单与证据，再进入人工审核与（审批后的）开发信触达。`,
    market: {
      country: { code: country.code, nameZh: country.nameZh, nameEn: country.nameEn, known: country.known },
      language: { code: country.language, label: country.languageName },
      currency: country.currency,
      region: country.region,
      coldEmailPolicy: country.coldEmailPolicy,
      coldEmailNote: COLD_EMAIL_POLICY_NOTES[country.coldEmailPolicy],
    },
    buyerProfile,
    discovery,
    workflow,
    deliverables: [
      ...product.deliverables.map(item => ({ name: item, dueInDays: deadlineDays, status: 'pending' })),
      { name: `候选买家清单（目标 ${input.targetCount} 条，实际以人工审核为准）`, dueInDays: firstBatchDays, status: 'pending' },
    ],
    acceptance: [...product.acceptance],
    approvalGates: gates,
    requiredSignals: REQUIRED_SIGNALS[product.playbook] || ['buyer_direct_search'],
    risks,
    openQuestions: [
      ...(productFacts
        ? [`产品库中「${productFacts.name}」（revision ${productFacts.revision}）的 MOQ、交期、认证与报价口径是否已确认？`]
        : ['客户的产品/品类范围与 HS 编码是什么？']),
      '客户已有客户/在谈商机名单（用于排除）？',
      '可接受的采购客户类型排序与最小规模？',
      '是否已有可授权的历史询盘或展会名录可导入？',
    ],
    sla: { deadlineAt, deadlineDays, firstBatchDays, reportCadence: 'weekly' },
    budgetCredits: input.budgetCredits,
    notes,
  };
  return plan;
}

export function renderDevelopmentPlanMarkdown({ product, delegation }) {
  const plan = delegation.plan;
  const input = delegation.input;
  const lines = [
    `# ${plan.objective}`,
    '',
    `> 产品：${product.name}（${product.id} v${product.revision}）  `,
    `> 委托 ID：${delegation.id}  `,
    `> 状态：${delegation.status}  `,
    `> 生成器：${plan.generator}；生成时间：${plan.generatedAt}  `,
    '> 本文件是开发计划书，不包含任何外发、模型调用或数据抓取；执行前需人工批准。',
    '',
    '## 1. 委托输入',
    '',
    `- 目标国家：${input.targetCountry}${plan.market.country.code ? `（${plan.market.country.code}）` : ''}`,
    `- 采购客户类型：${input.buyerType}`,
    `- 产品/品类范围：${input.productScope || '（待产品档案确认）'}`,
    `- 目标候选线索数：${input.targetCount}`,
    `- 交付周期：${input.deadlineDays} 天（截止 ${plan.sla.deadlineAt}）`,
    `- 内部预算：${input.budgetCredits} 点`,
    input.notes ? `- 补充说明：${input.notes}` : '',
    '',
    '### 产品库事实（精确版本）',
    '',
    plan.productFacts
      ? [
          `- 产品：${plan.productFacts.name}（${plan.productFacts.category || '品类待补'}）`,
          `- 产品 ID：${plan.productFacts.productId}`,
          `- 版本：revision ${plan.productFacts.revision}；SHA-256：\`${plan.productFacts.sha256}\``,
          `- SKU：${plan.productFacts.skus.length ? plan.productFacts.skus.map(sku => `${sku.code || '未编码'}${sku.unit ? ` (${sku.unit})` : ''}${sku.moq ? ` MOQ ${sku.moq}` : ''}${sku.leadTimeDays ? ` 交期 ${sku.leadTimeDays} 天` : ''}`).join('；') : '缺项'}`,
          `- 供货条件：${SUPPLY_FACT_KEYS.map(key => plan.productFacts.supply[key] ? `${key}=${plan.productFacts.supply[key]}` : `${key}=缺项`).join('；')}`,
          `- 事实完整度：${plan.productFacts.factCompleteness}${plan.productFacts.missingFields.length ? `（缺：${plan.productFacts.missingFields.join('、')}）` : ''}`,
          '- 来源：企业产品库精确版本（委托已钉住 revision 与 SHA-256，不允许用计划生成后的新版本替代）',
        ].join('\n')
      : '- 本次委托未绑定产品库产品（通用 AI-work 委托）。',
    '',
    '## 2. 买家画像',
    '',
    `- 类型：${plan.buyerProfile.type}（${plan.buyerProfile.typeEn}）`,
    `- 定义：${plan.buyerProfile.definition}`,
    `- 决策角色：${plan.buyerProfile.decisionRoles.join('、')}`,
    `- 采购信号：${plan.buyerProfile.buyingSignals.join('；')}`,
    `- 排除条件：${plan.buyerProfile.disqualifiers.join('；')}`,
    `- 语言建议：${plan.buyerProfile.languageHint}`,
    '',
    '## 3. 线索发现计划',
    '',
    `- 目标候选数：${plan.discovery.targetCount}；探测量级：约 ${plan.discovery.probeCount}`,
    `- 去重键：${plan.discovery.dedupeKeys.join('、')}`,
    '',
    '### 搜索 Query',
    '',
    '| 用途 | Query | 来源 |',
    '|---|---|---|',
    ...plan.discovery.queries.map(item => `| ${item.purpose} | \`${item.query.replaceAll('|', '\\|')}\` | ${item.source} |`),
    '',
    '### 数据源',
    '',
    '| 数据源 | 可用性 | 说明 |',
    '|---|---|---|',
    ...plan.discovery.sources.map(item => `| ${item.label} | ${item.availability} | ${item.note} |`),
    '',
    '### 质量闸门',
    '',
    ...plan.discovery.qualityGates.map(item => `- ${item}`),
    '',
    '## 4. 执行工作流',
    '',
    '| 步骤 | 负责人 | 产出 | 计划天数 |',
    '|---|---|---|---|',
    ...plan.workflow.map(step => `| ${step.title} | ${step.owner === 'human' ? '人工' : 'AI/Agent'} | ${step.output} | D+${step.dueInDays} |`),
    '',
    '## 5. 交付物与验收',
    '',
    '### 交付物',
    '',
    ...plan.deliverables.map(item => `- ${item.name}（D+${item.dueInDays}）`),
    '',
    '### 验收标准',
    '',
    ...plan.acceptance.map(item => `- ${item}`),
    '',
    '### 审批闸门',
    '',
    ...plan.approvalGates.map(item => `- ${item}`),
    '',
    '## 6. 市场合规提示',
    '',
    `- 冷邮件政策：${plan.market.coldEmailPolicy} — ${plan.market.coldEmailNote}`,
    '',
    '## 7. 风险与开放问题',
    '',
    '### 风险',
    '',
    ...plan.risks.map(item => `- ${item}`),
    '',
    '### 开放问题',
    '',
    ...plan.openQuestions.map(item => `- ${item}`),
  ];
  if (plan.notes.length) lines.push('', '### 需要人工补充', '', ...plan.notes.map(item => `- ${item}`));
  return `${lines.filter(line => line !== '').join('\n')}\n`;
}

/* ------------------------------------------------------------------------- */
/* Durable registry validation (called by store.mjs)                          */
/* ------------------------------------------------------------------------- */

export function validateAiWorksState(aiWorks) {
  const invalid = () => { throw new Error('Invalid AI-work registry data.'); };
  if (!isObject(aiWorks) || aiWorks.version !== AI_WORKS_VERSION) invalid();
  for (const key of ['products', 'delegations', 'events']) if (!Array.isArray(aiWorks[key])) invalid();
  // Legacy snapshots written before the execution pipeline have no candidates.
  if (aiWorks.candidates !== undefined && !Array.isArray(aiWorks.candidates)) invalid();
  if (aiWorks.products.length > MAX_PRODUCTS || aiWorks.delegations.length > MAX_DELEGATIONS || aiWorks.events.length > MAX_EVENTS) invalid();
  if ((aiWorks.candidates?.length || 0) > MAX_CANDIDATES) invalid();
  const productKeys = new Set();
  for (const product of aiWorks.products) {
    if (!isObject(product) || typeof product.id !== 'string' || !PRODUCT_ID.test(product.id)) invalid();
    if (!Number.isSafeInteger(product.revision) || product.revision < 1 || product.revision > 1_000_000) invalid();
    const key = `${product.id}@${product.revision}`;
    if (productKeys.has(key)) invalid();
    productKeys.add(key);
    if (!['published', 'retired'].includes(product.status)) invalid();
    if (typeof product.name !== 'string' || typeof product.summary !== 'string') invalid();
    if (typeof product.contentHash !== 'string' || !/^[a-f0-9]{64}$/u.test(product.contentHash)) invalid();
    if (!iso(product.createdAt) || !iso(product.updatedAt)) invalid();
    if (product.publishedAt !== null && !iso(product.publishedAt)) invalid();
    if (!isObject(product.inputSchema) || !Array.isArray(product.inputSchema.fields)) invalid();
    if (!Array.isArray(product.workflow) || !Array.isArray(product.deliverables) || !Array.isArray(product.acceptance)) invalid();
  }
  const delegationIds = new Set();
  for (const delegation of aiWorks.delegations) {
    if (!isObject(delegation) || typeof delegation.id !== 'string' || !delegation.id.trim() || delegation.id.length > 128) invalid();
    if (delegationIds.has(delegation.id)) invalid();
    delegationIds.add(delegation.id);
    if (!DELEGATION_STATUSES.includes(delegation.status)) invalid();
    if (typeof delegation.productId !== 'string' || !Number.isSafeInteger(delegation.productRevision)) invalid();
    if (typeof delegation.productHash !== 'string' || !/^[a-f0-9]{64}$/u.test(delegation.productHash)) invalid();
    if (!isObject(delegation.input) || !isObject(delegation.plan)) invalid();
    if (!Array.isArray(delegation.productRefs)) invalid();
    for (const ref of delegation.productRefs) {
      if (!isObject(ref) || typeof ref.field !== 'string' || typeof ref.productId !== 'string'
        || !Number.isSafeInteger(ref.revision) || ref.revision < 1
        || typeof ref.sha256 !== 'string' || !/^[a-f0-9]{64}$/u.test(ref.sha256)) invalid();
    }
    if (typeof delegation.planHash !== 'string' || !/^[a-f0-9]{64}$/u.test(delegation.planHash)) invalid();
    if (!iso(delegation.createdAt) || !iso(delegation.updatedAt)) invalid();
    if (delegation.approvedAt !== null && !iso(delegation.approvedAt)) invalid();
    if (delegation.cancelledAt !== null && !iso(delegation.cancelledAt)) invalid();
    if (!isObject(delegation.execution) || !EXECUTION_STATUSES.includes(delegation.execution.status)) invalid();
    if (delegation.execution.startedAt !== null && !iso(delegation.execution.startedAt)) invalid();
    if (delegation.execution.finishedAt !== null && !iso(delegation.execution.finishedAt)) invalid();
    if (delegation.execution.counts !== undefined && !isObject(delegation.execution.counts)) invalid();
  }
  const candidateIds = new Set();
  for (const candidate of aiWorks.candidates || []) {
    if (!isObject(candidate) || typeof candidate.id !== 'string' || !candidate.id.trim() || candidate.id.length > 128) invalid();
    if (candidateIds.has(candidate.id)) invalid();
    candidateIds.add(candidate.id);
    if (typeof candidate.delegationId !== 'string' || !delegationIds.has(candidate.delegationId)) invalid();
    if (typeof candidate.companyName !== 'string' || !candidate.companyName.trim()) invalid();
    if (typeof candidate.websiteDomain !== 'string' || !candidate.websiteDomain) invalid();
    if (!CANDIDATE_STATUSES.includes(candidate.status)) invalid();
    if (!Number.isSafeInteger(candidate.fitScore) || candidate.fitScore < 0 || candidate.fitScore > 100) invalid();
    if (!Array.isArray(candidate.evidence) || candidate.evidence.length < 1) invalid();
    for (const evidence of candidate.evidence) {
      if (!isObject(evidence) || typeof evidence.sourceUrl !== 'string' || !/^https:\/\//u.test(evidence.sourceUrl)) invalid();
      if (typeof evidence.excerpt !== 'string' || !evidence.excerpt.trim()) invalid();
      if (evidence.fetchedAt !== null && !iso(evidence.fetchedAt)) invalid();
    }
    if (!iso(candidate.createdAt) || !iso(candidate.updatedAt)) invalid();
    if (candidate.review !== null) {
      if (!isObject(candidate.review) || !['qualified', 'rejected'].includes(candidate.review.decision)) invalid();
      if (!iso(candidate.review.at)) invalid();
    }
  }
  if (aiWorks.drafts !== undefined && !Array.isArray(aiWorks.drafts)) invalid();
  if ((aiWorks.drafts?.length || 0) > MAX_DRAFTS) invalid();
  const draftIds = new Set();
  for (const draft of aiWorks.drafts || []) {
    if (!isObject(draft) || typeof draft.id !== 'string' || !draft.id.trim() || draft.id.length > 128) invalid();
    if (draftIds.has(draft.id)) invalid();
    draftIds.add(draft.id);
    if (typeof draft.delegationId !== 'string' || !delegationIds.has(draft.delegationId)) invalid();
    if (typeof draft.candidateId !== 'string' || !candidateIds.has(draft.candidateId)) invalid();
    if (!DRAFT_STATUSES.includes(draft.status)) invalid();
    if (draft.humanReviewRequired !== true || typeof draft.sent !== 'boolean') invalid();
    if (draft.sent === true) {
      if (!iso(draft.sentAt)) invalid();
      if (!isObject(draft.sendReceipt) || typeof draft.sendReceipt.provider !== 'string' || typeof draft.sendReceipt.messageId !== 'string' || !iso(draft.sendReceipt.at)) invalid();
    } else if (draft.sentAt !== null && draft.sentAt !== undefined && !iso(draft.sentAt)) invalid();
    if (draft.sendRequestId !== undefined && draft.sendRequestId !== null && (typeof draft.sendRequestId !== 'string' || !draft.sendRequestId.trim())) invalid();
    if (draft.contentHash !== undefined && (typeof draft.contentHash !== 'string' || !/^[a-f0-9]{64}$/u.test(draft.contentHash))) invalid();
    if (draft.sendAttempts !== undefined) {
      if (!Array.isArray(draft.sendAttempts) || draft.sendAttempts.length > 20) invalid();
      for (const attempt of draft.sendAttempts) {
        if (!isObject(attempt) || typeof attempt.requestId !== 'string' || !['sent', 'failed'].includes(attempt.outcome) || !iso(attempt.at)) invalid();
        if (attempt.error !== undefined && (typeof attempt.error !== 'string' || attempt.error.length > 300)) invalid();
        if (attempt.provider !== undefined && typeof attempt.provider !== 'string') invalid();
      }
    }
    if (draft.lastSendError !== undefined && draft.lastSendError !== null) {
      if (!isObject(draft.lastSendError) || typeof draft.lastSendError.message !== 'string' || !iso(draft.lastSendError.at)) invalid();
    }
    if (!Array.isArray(draft.evidenceRefs) || draft.evidenceRefs.length < 1) invalid();
    for (const evidence of draft.evidenceRefs) {
      if (!isObject(evidence) || typeof evidence.sourceUrl !== 'string' || !/^https:\/\//u.test(evidence.sourceUrl)) invalid();
      if (typeof evidence.excerpt !== 'string' || !evidence.excerpt.trim()) invalid();
      if (evidence.fetchedAt !== null && !iso(evidence.fetchedAt)) invalid();
    }
    if (typeof draft.subject !== 'string' || !draft.subject.trim() || typeof draft.body !== 'string' || !draft.body.trim()) invalid();
    if (!Number.isSafeInteger(draft.revision) || draft.revision < 1) invalid();
    if (!iso(draft.createdAt) || !iso(draft.updatedAt)) invalid();
    if (draft.reviewedAt !== null && !iso(draft.reviewedAt)) invalid();
  }
  if (aiWorks.suppressions !== undefined && !Array.isArray(aiWorks.suppressions)) invalid();
  if ((aiWorks.suppressions?.length || 0) > 5000) invalid();
  const suppressionIds = new Set();
  for (const suppression of aiWorks.suppressions || []) {
    if (!isObject(suppression) || typeof suppression.id !== 'string' || !suppression.id.trim()) invalid();
    if (suppressionIds.has(suppression.id)) invalid();
    suppressionIds.add(suppression.id);
    const email = typeof suppression.email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/u.test(suppression.email) ? suppression.email : null;
    const domain = typeof suppression.domain === 'string' && /^[a-z0-9.-]+\.[a-z]{2,}$/u.test(suppression.domain) ? suppression.domain : null;
    if (!email && !domain) invalid();
    if (typeof suppression.reason !== 'string' || !suppression.reason.trim() || suppression.reason.length > 500) invalid();
    if (!iso(suppression.createdAt)) invalid();
  }
  const eventIds = new Set();
  for (const event of aiWorks.events) {
    if (!isObject(event) || typeof event.id !== 'string' || !event.id.trim()) invalid();
    if (eventIds.has(event.id)) invalid();
    eventIds.add(event.id);
    if (typeof event.type !== 'string' || !event.type.trim() || event.type.length > 80) invalid();
    if (!iso(event.at)) invalid();
  }
}

/* ------------------------------------------------------------------------- */
/* Service                                                                    */
/* ------------------------------------------------------------------------- */

const freshRegistry = () => ({ version: AI_WORKS_VERSION, products: [], delegations: [], candidates: [], drafts: [], suppressions: [], events: [] });
const registryView = state => (isObject(state.aiWorks) ? state.aiWorks : freshRegistry());
function registryMutable(state) {
  if (!isObject(state.aiWorks)) state.aiWorks = freshRegistry();
  if (!Array.isArray(state.aiWorks.candidates)) state.aiWorks.candidates = [];
  if (!Array.isArray(state.aiWorks.drafts)) state.aiWorks.drafts = [];
  if (!Array.isArray(state.aiWorks.suppressions)) state.aiWorks.suppressions = [];
  return state.aiWorks;
}
const requireActor = (actor, { write = false, admin = false } = {}) => {
  if (!isObject(actor) || !identifier(actor.subject)) fail(401, 'AUTH_REQUIRED', '需要已认证的工作区成员身份。');
  if (!['admin', 'operator', 'viewer'].includes(actor.role)) fail(403, 'ROLE_REQUIRED', '当前角色不能操作 AI-work。');
  if (write && actor.role === 'viewer') fail(403, 'ROLE_REQUIRED', '只读角色不能创建或审批委托。');
  if (admin && actor.role !== 'admin') fail(403, 'ROLE_REQUIRED', '只有管理员可以发布 AI-work 产品或审批委托。');
};
function pushEvent(registry, type, actor, detail = {}) {
  registry.events.push({ id: randomUUID(), type, at: new Date().toISOString(), actor: actor?.subject || null, ...detail });
  if (registry.events.length > MAX_EVENTS) registry.events.splice(0, registry.events.length - MAX_EVENTS);
}
const latestProducts = registry => {
  const latest = new Map();
  for (const product of registry.products) {
    const current = latest.get(product.id);
    if (!current || product.revision > current.revision) latest.set(product.id, product);
  }
  return latest;
};
const publishedProduct = (registry, id) => {
  const latest = latestProducts(registry).get(id);
  return latest && latest.status === 'published' ? latest : null;
};
const publicProduct = product => structuredClone(product);

/* ------------------------------------------------------------------------- */
/* Execution pipeline helpers: authorized import -> candidates -> review      */
/* ------------------------------------------------------------------------- */

export function sourceReadiness(environment = {}) {
  return SOURCE_DEFINITIONS.map(source => {
    const configured = source.environmentKey
      ? typeof environment[source.environmentKey] === 'string' && environment[source.environmentKey].trim() !== ''
      : true;
    const status = !source.implemented ? 'not_implemented' : source.kind === 'import' || configured ? 'available' : 'unconfigured';
    return { id: source.id, label: source.label, kind: source.kind, implemented: source.implemented, configured, status, note: source.note };
  });
}

const SEARCH_TIMEOUT_MS = 10_000;
async function fetchJson(fetchImpl, url, options = {}, timeoutMs = SEARCH_TIMEOUT_MS) {
  if (typeof fetchImpl !== 'function') throw new Error('fetch implementation is missing');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  timer.unref?.();
  try {
    const response = await fetchImpl(url, { ...options, signal: controller.signal });
    if (!response.ok) throw new Error(`provider returned HTTP ${response.status}`);
    return await response.json();
  } finally { clearTimeout(timer); }
}

/** Serper.dev Google SERP adapter. Returns public page references, never contacts. */
export function createSerperSearchAdapter({ fetchImpl = fetch, apiKey, timeoutMs = SEARCH_TIMEOUT_MS } = {}) {
  if (typeof apiKey !== 'string' || !apiKey.trim()) throw new TypeError('Serper adapter requires an API key.');
  return {
    id: 'serper',
    async search({ query, limit = 10 }) {
      const data = await fetchJson(fetchImpl, 'https://google.serper.dev/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-API-KEY': apiKey },
        body: JSON.stringify({ q: query, num: Math.max(1, Math.min(20, limit)) }),
      }, timeoutMs);
      const organic = Array.isArray(data?.organic) ? data.organic : [];
      return organic.slice(0, limit).map(item => ({
        companyName: String(item?.title || '').slice(0, 180),
        url: String(item?.link || ''),
        snippet: String(item?.snippet || '').slice(0, 1000),
        sourceLabel: 'Serper 搜索',
      }));
    },
  };
}

/** UK Companies House search adapter. Registry identity, no website/contact claims. */
export function createCompaniesHouseSearchAdapter({ fetchImpl = fetch, apiKey, timeoutMs = SEARCH_TIMEOUT_MS } = {}) {
  if (typeof apiKey !== 'string' || !apiKey.trim()) throw new TypeError('Companies House adapter requires an API key.');
  return {
    id: 'companies_house',
    async search({ query, limit = 10 }) {
      const url = `https://api.company-information.service.gov.uk/search/companies?q=${encodeURIComponent(query)}&items_per_page=${Math.max(1, Math.min(20, limit))}`;
      const data = await fetchJson(fetchImpl, url, {
        headers: { Authorization: `Basic ${Buffer.from(`${apiKey}:`).toString('base64')}` },
      }, timeoutMs);
      const items = Array.isArray(data?.items) ? data.items : [];
      return items.slice(0, limit).map(item => ({
        companyName: String(item?.title || '').slice(0, 180),
        url: item?.company_number ? `https://find-and-update.company-information.service.gov.uk/company/${encodeURIComponent(String(item.company_number))}` : '',
        snippet: String(item?.snippet || item?.address_snippet || '').slice(0, 1000),
        country: '英国',
        registryId: String(item?.company_number || ''),
        sourceLabel: 'UK Companies House',
      }));
    },
  };
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/u;
const OUTREACH_PROVIDERS = Object.freeze({
  resend: { label: 'Resend', key: 'RESEND_API_KEY', endpoint: 'https://api.resend.com/emails' },
  postmark: { label: 'Postmark', key: 'POSTMARK_SERVER_TOKEN', endpoint: 'https://api.postmarkapp.com/email' },
});
export function outreachReadiness(environment = {}) {
  const name = String(environment.OUTREACH_PROVIDER || '').trim().toLocaleLowerCase();
  const provider = OUTREACH_PROVIDERS[name] || null;
  const apiKey = provider ? String(environment[provider.key] || '').trim() : '';
  const fromEmail = String(environment.OUTREACH_FROM_EMAIL || '').trim();
  const fromName = String(environment.OUTREACH_FROM_NAME || '').trim();
  const replyTo = String(environment.OUTREACH_REPLY_TO || '').trim();
  const configured = !!provider && !!apiKey && EMAIL_PATTERN.test(fromEmail) && (!replyTo || EMAIL_PATTERN.test(replyTo));
  return {
    configured, provider: provider ? name : null, providerLabel: provider?.label || null,
    fromEmail: fromEmail || null, fromName: fromName || null, replyTo: replyTo || null,
    dualApproval: String(environment.AI_WORK_DUAL_APPROVAL || '').toLocaleLowerCase() === 'true',
    status: configured ? 'available' : 'unconfigured',
    note: '逐封发送已批准草稿：需配置 OUTREACH_PROVIDER（resend/postmark）、对应 API key 与 OUTREACH_FROM_EMAIL；仍受人工审批、退订/抑制名单约束。',
  };
}
function createOutreachTransport({ environment = {}, fetchImpl = fetch, timeoutMs = 15_000 } = {}) {
  const readiness = outreachReadiness(environment);
  if (!readiness.configured) return null;
  const provider = OUTREACH_PROVIDERS[readiness.provider];
  const apiKey = String(environment[provider.key]).trim();
  const from = readiness.fromName ? `${readiness.fromName} <${readiness.fromEmail}>` : readiness.fromEmail;
  return {
    provider: readiness.provider,
    async send({ to, subject, text }) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      timer.unref?.();
      try {
        let response;
        if (readiness.provider === 'resend') {
          response = await fetchImpl(provider.endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
            body: JSON.stringify({ from, to: [to], subject, text, ...(readiness.replyTo ? { reply_to: readiness.replyTo } : {}) }),
            signal: controller.signal,
          });
        } else {
          response = await fetchImpl(provider.endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Postmark-Server-Token': apiKey },
            body: JSON.stringify({ From: from, To: to, Subject: subject, TextBody: text, ...(readiness.replyTo ? { ReplyTo: readiness.replyTo } : {}) }),
            signal: controller.signal,
          });
        }
        if (!response.ok) throw Object.assign(new Error(`邮件服务返回 HTTP ${response.status}`), { providerStatus: response.status });
        const data = await response.json().catch(() => ({}));
        const messageId = readiness.provider === 'resend'
          ? (typeof data.id === 'string' && data.id ? data.id : 'provider-accepted')
          : (typeof data.MessageID === 'string' && data.MessageID ? data.MessageID : 'provider-accepted');
        return { provider: readiness.provider, messageId };
      } finally { clearTimeout(timer); }
    },
  };
}

function scoreCandidateFacts({ delegation, companyName, website, country, buyerType, contactEmail, excerpt, sourceLabel }) {  const plan = delegation.plan;
  const reasons = [], missing = [];
  let score = 0;
  const haystack = `${companyName} ${excerpt} ${website}`.toLocaleLowerCase();
  const productTokens = [plan.productFacts?.name, plan.productFacts?.category].filter(Boolean).join(' ').split(/[\s/、，,·]+/u).filter(token => token.length >= 2);
  if (productTokens.some(token => haystack.includes(token.toLocaleLowerCase()))) { score += 25; reasons.push('产品相关：公司/摘录中出现产品名或品类'); } else missing.push('product_match');
  const planCountry = plan.market?.country || {};
  if (country) {
    const normalizedCountry = country.toLocaleLowerCase();
    if ([planCountry.code, planCountry.nameZh, planCountry.nameEn].filter(Boolean).some(value => String(value).toLocaleLowerCase().includes(normalizedCountry) || normalizedCountry.includes(String(value).toLocaleLowerCase()))) { score += 20; reasons.push('目标国家匹配'); }
    else missing.push('country_match');
  } else missing.push('country');
  const planBuyer = plan.buyerProfile || {};
  if (buyerType) {
    const normalizedBuyer = buyerType.toLocaleLowerCase();
    if ([planBuyer.type, planBuyer.typeEn].filter(Boolean).some(value => String(value).toLocaleLowerCase().includes(normalizedBuyer) || normalizedBuyer.includes(String(value).toLocaleLowerCase()))) { score += 15; reasons.push('采购客户类型匹配'); }
    else missing.push('buyer_type_match');
  } else missing.push('buyerType');
  if (contactEmail) { score += 15; reasons.push('有可验证的企业邮箱（待发送前二次验证）'); } else missing.push('contactEmail');
  if (website) { score += 10; reasons.push('有公司官网/来源页面'); }
  score += 15; reasons.push(`有来源 URL 与逐字摘录（${sourceLabel}）`);
  return { fitScore: Math.max(0, Math.min(100, score)), fitReasons: reasons, missingFields: missing };
}
const emptyCounts = () => ({ importBatches: 0, imported: 0, duplicates: 0, rejectedRows: 0, candidates: 0, needsReview: 0, qualified: 0, rejected: 0 });
function executionView(execution) {
  return {
    status: EXECUTION_STATUSES.includes(execution?.status) ? execution.status : 'not_started',
    startedAt: execution?.startedAt || null,
    finishedAt: execution?.finishedAt || null,
    sources: Array.isArray(execution?.sources) ? [...execution.sources] : [],
    importIds: Array.isArray(execution?.importIds) ? [...execution.importIds] : [],
    imports: Array.isArray(execution?.imports) ? structuredClone(execution.imports) : [],
    counts: { ...emptyCounts(), ...(isObject(execution?.counts) ? execution.counts : {}) },
    lastError: isObject(execution?.lastError) ? structuredClone(execution.lastError) : null,
    lastExecuteRequestId: typeof execution?.lastExecuteRequestId === 'string' ? execution.lastExecuteRequestId : null,
    workerOrderId: execution?.workerOrderId || null,
    reason: typeof execution?.reason === 'string' ? execution.reason : '',
  };
}
const delegationView = delegation => ({ ...structuredClone(delegation), execution: executionView(delegation.execution) });
const candidateView = candidate => structuredClone(candidate);

const IMPORT_COLUMNS = Object.freeze(['companyName', 'website', 'country', 'buyerType', 'contactName', 'contactTitle', 'contactEmail', 'sourceUrl', 'sourceExcerpt', 'sourceFetchedAt', 'notes']);
const IMPORT_REQUIRED = Object.freeze(['companyName', 'website', 'sourceUrl', 'sourceExcerpt', 'sourceFetchedAt']);
const candidateDomain = website => {
  const url = new URL(website);
  return url.hostname.toLocaleLowerCase().replace(/^www\./u, '');
};
const normalizeCompanyName = value => value.toLocaleLowerCase().replace(/[\s\-_.,，。·()（）&]+/gu, '');
const candidateKey = (domain, companyName) => (domain ? `domain:${domain}` : `name:${normalizeCompanyName(companyName)}`);

function parseJsonImport(text) {
  let parsed;
  try { parsed = JSON.parse(text); } catch { fail(400, 'INVALID_IMPORT', 'JSON 不是合法 JSON。'); }
  const rows = Array.isArray(parsed) ? parsed : parsed?.candidates;
  if (!Array.isArray(rows)) fail(400, 'INVALID_IMPORT', 'JSON 必须是候选数组或 { candidates: [...] }。');
  return rows;
}
function parseCsvImport(text) {
  const source = text.replace(/^\uFEFF/u, '');
  const rows = [];
  let row = [], cell = '', quoted = false;
  for (let index = 0; index < source.length; index++) {
    const char = source[index];
    if (quoted) {
      if (char === '"' && source[index + 1] === '"') { cell += '"'; index += 1; }
      else if (char === '"') quoted = false;
      else cell += char;
      continue;
    }
    if (char === '"') quoted = true;
    else if (char === ',') { row.push(cell); cell = ''; }
    else if (char === '\n' || char === '\r') {
      if (char === '\r' && source[index + 1] === '\n') index += 1;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += char;
  }
  if (quoted) fail(400, 'INVALID_IMPORT', 'CSV 引号未闭合。');
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  const clean = rows.filter(line => line.some(value => value.trim() !== ''));
  if (clean.length < 2) fail(400, 'INVALID_IMPORT', 'CSV 至少需要表头与一行数据。');
  const header = clean[0].map(value => value.trim());
  if (new Set(header).size !== header.length) fail(400, 'INVALID_IMPORT', 'CSV 表头不能重复。');
  const unknown = header.filter(value => !IMPORT_COLUMNS.includes(value));
  if (unknown.length) fail(400, 'INVALID_IMPORT', `CSV 包含不支持的列：${unknown.join('、')}。`);
  const missing = IMPORT_REQUIRED.filter(value => !header.includes(value));
  if (missing.length) fail(400, 'INVALID_IMPORT', `CSV 缺少必需列：${missing.join('、')}。`);
  return clean.slice(1).map(line => Object.fromEntries(header.map((key, index) => [key, line[index] ?? ''])));
}
function importRows(body) {
  const format = body.format;
  if (!['json', 'csv'].includes(format)) fail(400, 'INVALID_IMPORT', 'format 只支持 json / csv。');
  if (typeof body.content !== 'string' || !body.content.trim()) fail(400, 'INVALID_IMPORT', 'content 不能为空。');
  if (Buffer.byteLength(body.content, 'utf8') > MAX_IMPORT_BYTES) fail(413, 'IMPORT_TOO_LARGE', '导入内容超过 64 KiB。');
  const rows = format === 'json' ? parseJsonImport(body.content) : parseCsvImport(body.content);
  if (rows.length > MAX_IMPORT_ROWS) fail(413, 'IMPORT_TOO_MANY_ROWS', `单次最多导入 ${MAX_IMPORT_ROWS} 行。`);
  return { format, rows };
}

function normalizeImportedRow(row, index, delegation) {
  const reject = (code, message) => ({ row: index + 2, code, message });
  const rowError = (code, message) => { const error = new Error(message); error.rowCode = code; return error; };
  if (!isObject(row)) return { error: reject('INVALID_ROW', '每行必须是对象。') };
  try {
  const unknown = Object.keys(row).filter(key => !IMPORT_COLUMNS.includes(key));
  if (unknown.length) return { error: reject('UNKNOWN_FIELD', `不支持的字段：${unknown.join('、')}。`) };
  const text = (value, field, max, required) => {
    const raw = value === undefined || value === null ? '' : String(value).trim();
    if (!raw && required) throw rowError('INVALID_ROW', `${field} 必填（第 ${index + 2} 行）。`);
    if (raw.length > max) throw rowError('INVALID_ROW', `${field} 超过 ${max} 字符（第 ${index + 2} 行）。`);
    return raw;
  };
  const companyName = text(row.companyName, 'companyName', 180, true);
  const websiteRaw = text(row.website, 'website', 500, true);
  let website;
  try { website = new URL(websiteRaw); } catch { return { error: reject('INVALID_WEBSITE', 'website 必须是合法 URL。') }; }
  if (!['http:', 'https:'].includes(website.protocol) || website.username || website.password || !website.hostname.includes('.') || /^\d+\.\d+\.\d+\.\d+$/u.test(website.hostname) || /(?:^|\.)(?:localhost|local|internal)$/u.test(website.hostname))
    return { error: reject('INVALID_WEBSITE', 'website 必须是公开 http(s) 域名。') };
  const sourceUrlRaw = text(row.sourceUrl, 'sourceUrl', 500, true);
  let sourceUrl;
  try { sourceUrl = new URL(sourceUrlRaw); } catch { return { error: reject('INVALID_SOURCE', 'sourceUrl 必须是合法 URL。') }; }
  if (sourceUrl.protocol !== 'https:' || sourceUrl.username || sourceUrl.password) return { error: reject('INVALID_SOURCE', 'sourceUrl 必须是公开 HTTPS URL。') };
  const excerpt = text(row.sourceExcerpt, 'sourceExcerpt', 1000, true);
  if (excerpt.length < 10) return { error: reject('INVALID_SOURCE', 'sourceExcerpt 至少 10 个字符（逐字摘录）。') };
  const fetchedRaw = text(row.sourceFetchedAt, 'sourceFetchedAt', 40, true);
  const fetchedAt = new Date(fetchedRaw);
  if (!Number.isFinite(fetchedAt.getTime())) return { error: reject('INVALID_SOURCE_DATE', 'sourceFetchedAt 必须是明确日期/ISO 时间。') };
  const country = text(row.country, 'country', 80, false);
  const buyerType = text(row.buyerType, 'buyerType', 80, false);
  const contactName = text(row.contactName, 'contactName', 120, false);
  const contactTitle = text(row.contactTitle, 'contactTitle', 120, false);
  const contactEmail = text(row.contactEmail, 'contactEmail', 200, false);
  if (contactEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/u.test(contactEmail)) return { error: reject('INVALID_EMAIL', 'contactEmail 格式不正确。') };
  const notes = text(row.notes, 'notes', 1000, false);
  const domain = candidateDomain(website);
  const plan = delegation.plan;
  const planBuyer = plan.buyerProfile || {};
  const scored = scoreCandidateFacts({ delegation, companyName, website: website.href, country, buyerType, contactEmail, excerpt, sourceLabel: '授权导入' });
  return {
    candidate: {
      companyName, companyNameNormalized: normalizeCompanyName(companyName),
      website: website.href, websiteDomain: domain,
      country, buyerType: buyerType || planBuyer.type || '',
      contact: { name: contactName, title: contactTitle, email: contactEmail },
      notes,
      evidence: [{ kind: 'authorized_import', sourceUrl: sourceUrl.href, excerpt, fetchedAt: fetchedAt.toISOString() }],
      fitScore: scored.fitScore, fitReasons: scored.fitReasons, missingFields: scored.missingFields,
      dedupeKey: candidateKey(domain, companyName),
    },
  };
  } catch (error) {
    return { error: reject(error.rowCode || 'INVALID_ROW', error.message) };
  }
}

function countCandidates(candidates) {
  return {
    candidates: candidates.length,
    needsReview: candidates.filter(item => item.status === 'needs_review').length,
    qualified: candidates.filter(item => item.status === 'qualified').length,
    rejected: candidates.filter(item => item.status === 'rejected').length,
  };
}

const csvCell = value => {
  const text = value === null || value === undefined ? '' : String(value);
  return /[",\n\r]/u.test(text) ? `"${text.replace(/"/gu, '""')}"` : text;
};
const csvContent = (headers, rows) => [headers.join(','), ...rows.map(row => headers.map(key => csvCell(row[key])).join(','))].join('\n');
const exportPayload = (delegationId, suffix, headers, rows) => ({
  export: { filename: `ai-work-${delegationId}-${suffix}.csv`, contentType: 'text/csv; charset=utf-8', content: csvContent(headers, rows), rows: rows.length },
});

/** Turn one public search/registry result into a reviewable candidate, or drop it. */
function autoCandidateRecord({ result, delegation, adapterId, query, at }) {
  let sourceUrl;
  try { sourceUrl = new URL(String(result.url || '')); } catch { return { dropped: 'invalid_url' }; }
  const host = sourceUrl.hostname.toLocaleLowerCase().replace(/^\[|\]$/gu, '');
  if (sourceUrl.protocol !== 'https:' || sourceUrl.username || sourceUrl.password
    || !host.includes('.') || /^\d+\.\d+\.\d+\.\d+$/u.test(host) || /(?:^|\.)(?:localhost|local|internal)$/u.test(host)) return { dropped: 'invalid_url' };
  const excerpt = String(result.snippet || '').replace(/\s+/gu, ' ').trim().slice(0, 1000);
  if (excerpt.length < 10) return { dropped: 'missing_excerpt' };
  const companyName = String(result.companyName || '').replace(/\s+/gu, ' ').trim().slice(0, 180);
  if (companyName.length < 2) return { dropped: 'missing_company' };
  let website;
  try { website = new URL(String(result.website || result.url)); } catch { website = sourceUrl; }
  if (!['http:', 'https:'].includes(website.protocol) || website.username || website.password) website = sourceUrl;
  const domain = candidateDomain(website.href);
  const country = String(result.country || '').slice(0, 80);
  const buyerType = String(result.buyerType || '').slice(0, 80);
  const contactEmail = String(result.contactEmail || '').slice(0, 200);
  const notes = result.registryId ? `Companies House 编号 ${String(result.registryId).slice(0, 40)}` : '';
  const scored = scoreCandidateFacts({
    delegation, companyName, website: website.href, country, buyerType, contactEmail, excerpt,
    sourceLabel: result.sourceLabel || adapterId,
  });
  return {
    candidate: {
      id: randomUUID(), delegationId: delegation.id,
      productRef: delegation.productRefs?.find(ref => ref.field === 'productId') || null,
      companyName, companyNameNormalized: normalizeCompanyName(companyName),
      website: website.href, websiteDomain: domain, country, buyerType,
      contact: { name: '', title: '', email: contactEmail },
      notes,
      evidence: [{ kind: adapterId, sourceUrl: sourceUrl.href, excerpt, fetchedAt: at }],
      fitScore: scored.fitScore, fitReasons: scored.fitReasons, missingFields: scored.missingFields,
      dedupeKey: candidateKey(domain, companyName),
      source: { kind: adapterId, query: String(query).slice(0, 300), fetchedAt: at },
      status: 'needs_review', review: null, createdAt: at, updatedAt: at,
    },
  };
}

/* Outreach drafts are UNSENT by construction: no adapter, no model, no send. */

const DRAFT_FACT_LABELS = Object.freeze({
  en: { moq: 'MOQ', leadTime: 'Lead time', packaging: 'Packaging', samplePolicy: 'Sample policy', paymentTerms: 'Payment terms', shippingTerms: 'Shipping terms', capacityNote: 'Capacity', days: 'days', missing: 'to be confirmed (missing in product library)' },
  de: { moq: 'Mindestbestellmenge', leadTime: 'Lieferzeit', packaging: 'Verpackung', samplePolicy: 'Musterpolitik', paymentTerms: 'Zahlungsbedingungen', shippingTerms: 'Versandbedingungen', capacityNote: 'Kapazität', days: 'Tage', missing: 'noch zu bestätigen (fehlt in der Produktbibliothek)' },
});
const DRAFT_COPY = Object.freeze({
  en: {
    subject: (facts, candidate) => `${facts.name} — supplier introduction for ${candidate.companyName}`,
    greeting: () => 'Hello [Contact name / Purchasing team],',
    intro: (facts, candidate, plan) => `I am [Your name] from [Your company]. We manufacture ${facts.name}${facts.category ? ` (${facts.category})` : ''} in China and are looking for ${plan.buyerProfile?.typeEn || candidate.buyerType || 'buyer'} partners in ${plan.market?.country?.nameEn || candidate.country || '[target country]'}. I am writing to ${candidate.companyName}.`,
    relevance: (excerpt, url, date) => `We noticed: "${excerpt}" (source: ${url}, observed ${date}).`,
    factsTitle: () => 'Confirmed product facts from our product library:',
    ask: () => 'Would it be useful if we sent a short product sheet and a price indication for a trial order?',
    closing: () => 'Best regards,',
    signature: () => '[Your name]\n[Your company] · [Physical address]',
    footer: () => 'Unsubscribe: [Unsubscribe link] · Data source: authorized import · This is a B2B business inquiry.',
  },
  de: {
    subject: (facts, candidate) => `${facts.name} — Lieferantenanfrage für ${candidate.companyName}`,
    greeting: () => 'Hallo [Ansprechpartner],',
    intro: (facts, candidate, plan) => `ich bin [Ihr Name] von [Ihr Unternehmen]. Wir fertigen ${facts.name}${facts.category ? ` (${facts.category})` : ''} in China und suchen ${plan.buyerProfile?.type || candidate.buyerType || 'Einkaufspartner'} in ${plan.market?.country?.nameZh || candidate.country || '[Zielmarkt]'}. Ich schreibe ${candidate.companyName} an.`,
    relevance: (excerpt, url, date) => `Uns ist aufgefallen: „${excerpt}" (Quelle: ${url}, gesehen am ${date}).`,
    factsTitle: () => 'Bestätigte Produktdaten aus unserer Produktbibliothek:',
    ask: () => 'Wäre es für Sie interessant, ein kurzes Produktdatenblatt und eine Preisindikation für eine Testbestellung zu erhalten?',
    closing: () => 'Mit freundlichen Grüßen',
    signature: () => '[Ihr Name]\n[Ihr Unternehmen] · [Anschrift]',
    footer: () => 'Abmelden: [Abmelde-Link] · Datenquelle: autorisierter Import · Geschäftliche B2B-Anfrage.',
  },
});

function draftFactsLines(facts, language) {
  const labels = DRAFT_FACT_LABELS[language] || DRAFT_FACT_LABELS.en;
  const sku = facts.skus?.[0];
  const lines = [];
  lines.push(`${labels.moq}: ${sku?.moq ?? labels.missing}`);
  lines.push(`${labels.leadTime}: ${sku?.leadTimeDays ? `${sku.leadTimeDays} ${labels.days}` : labels.missing}`);
  for (const [key, label] of [['packaging', 'packaging'], ['samplePolicy', 'samplePolicy'], ['paymentTerms', 'paymentTerms'], ['shippingTerms', 'shippingTerms'], ['capacityNote', 'capacityNote']]) {
    lines.push(`${labels[label]}: ${facts.supply?.[key] || labels.missing}`);
  }
  return lines;
}

export function buildOutreachDraft({ delegation, candidate, language, now = new Date().toISOString() }) {
  const requested = language === undefined ? null : language;
  if (requested !== null && !DRAFT_LANGUAGES.includes(requested)) fail(400, 'INVALID_LANGUAGE', `草稿语言只支持：${DRAFT_LANGUAGES.join(', ')}。`);
  const marketLanguage = delegation.plan?.market?.language?.code;
  const selected = requested || (DRAFT_LANGUAGES.includes(marketLanguage) ? marketLanguage : 'en');
  const warnings = [];
  if (requested === null && marketLanguage && !DRAFT_LANGUAGES.includes(marketLanguage)) warnings.push(`目标市场语言 ${marketLanguage} 暂无模板，已生成英文草稿；发送前需人工翻译或确认可用英文。`);
  const copy = DRAFT_COPY[selected] || DRAFT_COPY.en;
  const facts = delegation.plan?.productFacts || { name: '[产品名称缺失]', category: '', skus: [], supply: {} };
  const evidence = candidate.evidence[0];
  const observedAt = evidence.fetchedAt ? evidence.fetchedAt.slice(0, 10) : 'unknown';
  const excerpt = evidence.excerpt.replace(/\s+/gu, ' ').slice(0, 300);
  const subject = copy.subject(facts, candidate);
  const body = [
    copy.greeting(),
    '',
    copy.intro(facts, candidate, delegation.plan || {}),
    '',
    copy.relevance(excerpt, evidence.sourceUrl, observedAt),
    '',
    copy.factsTitle(),
    ...draftFactsLines(facts, selected).map(line => `- ${line}`),
    '',
    copy.ask(),
    '',
    copy.closing(),
    copy.signature(),
    copy.footer(),
  ].join('\n');
  const coldEmailPolicy = delegation.plan?.market?.coldEmailPolicy || 'notice_and_objection';
  const compliance = {
    coldEmailPolicy,
    consentRequired: coldEmailPolicy === 'consent_required',
    optOutRequired: true,
    humanReviewRequired: true,
    sent: false,
    externalSend: 'not_implemented',
    note: '草稿未发送；外发通道需服务端单独配置。发送前必须由管理员逐封确认，并填写签名、地址与退订链接。',
  };
  if (compliance.consentRequired) warnings.push('目标市场需要事先明确同意（如德国 UWG §7）；未取得同意前不得发送冷邮件。');
  if (facts.missingFields?.length) warnings.push(`产品事实缺项：${facts.missingFields.join('、')}；已标记待补充，不得在草稿中猜测。`);
  return {
    language: selected,
    subject: subject.slice(0, 200),
    body: body.slice(0, 8000),
    evidenceRefs: candidate.evidence.map(item => ({ sourceUrl: item.sourceUrl, excerpt: item.excerpt, fetchedAt: item.fetchedAt })),
    productFacts: { name: facts.name, category: facts.category, revision: facts.revision, sha256: facts.sha256 },
    compliance,
    warnings,
  };
}



/**
 * @param {{ store: {read:Function, update:Function}, artifacts?: object|null, clock?: Function }} options
 */
export function createAiWorkService({ store, artifacts = null, lookupProduct = null, sourceEnvironment = {}, fetchImpl = fetch, outreachFetch = fetch, clock = () => Date.now() } = {}) {
  if (typeof store?.read !== 'function' || typeof store?.update !== 'function') throw new TypeError('AI-work products require the durable workspace store.');
  if (typeof clock !== 'function') throw new TypeError('AI-work clock must be a function.');
  if (lookupProduct !== null && typeof lookupProduct !== 'function') throw new TypeError('Product-library lookup must be a trusted synchronous function.');
  if (!isObject(sourceEnvironment)) throw new TypeError('AI-work source environment must be a plain object.');
  if (typeof fetchImpl !== 'function') throw new TypeError('AI-work search adapters require a fetch implementation.');
  if (typeof outreachFetch !== 'function') throw new TypeError('AI-work outreach transport requires a fetch implementation.');
  const nowIso = () => new Date(clock()).toISOString();
  const configuredSearchAdapters = () => {
    const adapters = [];
    const serperKey = sourceEnvironment.SERPER_API_KEY;
    if (typeof serperKey === 'string' && serperKey.trim()) adapters.push(createSerperSearchAdapter({ fetchImpl, apiKey: serperKey.trim() }));
    const companiesHouseKey = sourceEnvironment.COMPANIES_HOUSE_API_KEY;
    if (typeof companiesHouseKey === 'string' && companiesHouseKey.trim()) adapters.push(createCompaniesHouseSearchAdapter({ fetchImpl, apiKey: companiesHouseKey.trim() }));
    return adapters;
  };
  const outreachTransport = createOutreachTransport({ environment: sourceEnvironment, fetchImpl: outreachFetch });

  function assertProductBodyRevision(registry, body, id, contentHash) {
    const latest = latestProducts(registry).get(id);
    if (!latest) {
      if (body.expectedRevision !== undefined) fail(409, 'REVISION_CONFLICT', '产品尚不存在，不能指定 expectedRevision。');
      return { latest: null, duplicate: false };
    }
    const sameRequest = latest.requestId !== null && latest.requestId === body.requestId;
    if (sameRequest) {
      if (latest.contentHash === contentHash) return { latest, duplicate: true };
      fail(409, 'IDEMPOTENCY_CONFLICT', '同一 requestId 不能用于不同的产品内容。');
    }
    if (body.expectedRevision === undefined) fail(409, 'REVISION_REQUIRED', '产品已存在；更新必须提供 expectedRevision。');
    if (body.expectedRevision !== latest.revision) fail(409, 'REVISION_CONFLICT', '产品已有新版本，请重新读取后再发布。');
    if (latest.contentHash === contentHash) fail(409, 'NO_CHANGES', '产品内容没有变化，无需发布新版本。');
    return { latest, duplicate: false };
  }

  async function publish(body, actor) {
    requireActor(actor, { admin: true });
    onlyFields(body, PRODUCT_BODY_FIELDS, 'AI-work 产品');
    if (!identifier(body.requestId)) fail(400, 'INVALID_INPUT', '发布产品需要稳定的 requestId。');
    const { definition, contentHash } = normalizeProductDefinition(body);
    const status = body.status === undefined ? 'published' : body.status;
    if (!['published', 'retired'].includes(status)) fail(400, 'INVALID_INPUT', 'status 只支持 published/retired。');
    const changeNote = body.changeNote === undefined ? '' : text(body.changeNote, 'changeNote', 500, { required: false });
    return store.update(state => {
      const registry = registryMutable(state);
      const { latest, duplicate } = assertProductBodyRevision(registry, body, definition.id, contentHash);
      if (duplicate) return { product: publicProduct(latest), duplicate: true };
      const revision = latest ? latest.revision + 1 : 1;
      if (registry.products.length >= MAX_PRODUCTS) fail(409, 'PRODUCT_LIMIT', 'AI-work 产品数量已达上限。');
      const at = nowIso();
      const product = {
        ...definition, revision, status, contentHash,
        requestId: body.requestId, requestFingerprint: digest({ definition, status }), changeNote,
        createdBy: actor.subject, createdAt: at, updatedAt: at,
        publishedAt: status === 'published' ? at : null, publishedBy: status === 'published' ? actor.subject : null,
        retiredAt: status === 'retired' ? at : null,
      };
      registry.products.push(product);
      pushEvent(registry, latest ? 'product_revised' : 'product_published', actor, { productId: product.id, revision: product.revision });
      return { product: publicProduct(product), duplicate: false };
    });
  }

  function catalog() {
    const registry = registryView(store.read());
    const latest = [...latestProducts(registry).values()].filter(product => product.status === 'published');
    latest.sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN') || a.id.localeCompare(b.id));
    return { products: latest.map(publicProduct) };
  }

  function getProduct(id) {
    if (typeof id !== 'string' || !PRODUCT_ID.test(id)) fail(400, 'INVALID_PRODUCT_ID', '产品 id 无效。');
    const registry = registryView(store.read());
    const product = publishedProduct(registry, id) || latestProducts(registry).get(id) || null;
    if (!product) fail(404, 'PRODUCT_NOT_FOUND', 'AI-work 产品不存在。');
    return { product: publicProduct(product) };
  }

  function normalizeInputs(product, body) {
    onlyFields(body, ['requestId', ...product.inputSchema.fields.map(field => field.name)], '委托输入');
    const inputs = {};
    for (const field of product.inputSchema.fields) {
      const raw = body[field.name];
      if (raw === undefined || raw === null) {
        if (field.required) fail(400, 'INVALID_INPUT', `${field.label}（${field.name}）必填。`);
        if (field.default !== undefined) inputs[field.name] = field.default;
        continue;
      }
      if (field.type === 'integer') inputs[field.name] = integer(raw, field.label, field.minimum, field.maximum);
      else if (field.type === 'product_ref') inputs[field.name] = text(raw, field.label, 128);
      else {
        const value = text(raw, field.label, field.maxLength, { required: field.required });
        inputs[field.name] = value;
      }
    }
    return inputs;
  }

  function planMarkdown(product, delegation) {
    return renderDevelopmentPlanMarkdown({ product, delegation });
  }

  async function attachPlanArtifact(product, delegation) {
    if (!artifacts || typeof artifacts.create !== 'function') return delegation;
    try {
      const created = await artifacts.create({
        filename: `ai-work-plan-${delegation.id}.md`,
        content: planMarkdown(product, delegation),
        title: `开发计划书 · ${product.name}`,
        description: 'AI-work 根据委托输入生成的开发计划书；不含外发、模型调用或数据抓取。',
        metadata: { aiWorkId: product.id, aiWorkRevision: product.revision, delegationId: delegation.id, planHash: delegation.planHash },
        requestId: `aiwork-plan-${delegation.id}`,
      });
      const artifact = created.artifact;
      return store.update(state => {
        const registry = registryMutable(state);
        const current = registry.delegations.find(item => item.id === delegation.id);
        if (!current) return current;
        if (!current.artifactId) {
          current.artifactId = artifact.id;
          current.artifactSha256 = artifact.sha256;
          current.updatedAt = nowIso();
        }
        return structuredClone(current);
      });
    } catch {
      // The delegation and its inline plan are already durable; a failed
      // convenience artifact must not roll back a valid plan delegation.
      return delegation;
    }
  }

  async function createDelegation(productId, body, actor) {
    requireActor(actor, { write: true });
    if (typeof productId !== 'string' || !PRODUCT_ID.test(productId)) fail(400, 'INVALID_PRODUCT_ID', '产品 id 无效。');
    const snapshot = store.read();
    const product = publishedProduct(registryView(snapshot), productId);
    if (!product) fail(404, 'PRODUCT_NOT_PUBLISHED', '该 AI-work 产品尚未发布，不能建立委托。');
    if (!isObject(body) || !identifier(body.requestId)) fail(400, 'INVALID_INPUT', '建立委托需要稳定的 requestId。');
    const inputs = normalizeInputs(product, body);
    const productRefs = [];
    let productFacts = null;
    for (const field of product.inputSchema.fields.filter(item => item.type === 'product_ref')) {
      const value = inputs[field.name];
      if (!value) continue;
      if (typeof lookupProduct !== 'function') fail(409, 'PRODUCT_LIBRARY_UNAVAILABLE', '企业产品库未接入，不能绑定产品。');
      let found = null;
      try { found = lookupProduct(value); } catch { found = null; }
      const item = found?.product;
      if (!item) fail(404, 'PRODUCT_NOT_FOUND', `产品库中找不到产品 ${value}。`);
      if (item.status === 'archived') fail(409, 'PRODUCT_ARCHIVED', '产品已归档，不能用于新的开发计划。');
      const facts = extractProductFacts(item);
      productRefs.push({ field: field.name, productId: item.id, revision: item.revision, sha256: facts.sha256 });
      if (!productFacts) productFacts = facts;
    }
    const country = resolveCountry(inputs.targetCountry);
    const buyerType = resolveBuyerType(inputs.buyerType);
    const planInput = {
      productScope: inputs.productScope || '',
      targetCount: inputs.targetCount === undefined ? 50 : inputs.targetCount,
      budgetCredits: inputs.budgetCredits === undefined ? 20 : inputs.budgetCredits,
      deadlineDays: inputs.deadlineDays === undefined ? 30 : inputs.deadlineDays,
      notes: inputs.notes || '',
    };
    const plan = buildDevelopmentPlan({ product, input: planInput, country, buyerType, productFacts, now: nowIso() });
    const normalizedInput = {
      ...inputs,
      targetCountry: inputs.targetCountry,
      buyerType: inputs.buyerType,
      productScope: planInput.productScope,
      targetCount: planInput.targetCount,
      budgetCredits: planInput.budgetCredits,
      deadlineDays: planInput.deadlineDays,
      notes: planInput.notes,
    };
    const planHash = digest(plan);
    const requestFingerprint = digest({ productId: product.id, productRevision: product.revision, productHash: product.contentHash, input: normalizedInput, actor: actor.subject });
    const created = await store.update(state => {
      const registry = registryMutable(state);
      const previous = registry.delegations.find(item => item.requestId === body.requestId && item.createdBy === actor.subject);
      if (previous) {
        if (previous.requestFingerprint !== requestFingerprint) fail(409, 'IDEMPOTENCY_CONFLICT', '同一 requestId 不能用于不同的委托内容。');
        return { delegation: delegationView(previous), duplicate: true };
      }
      if (registry.delegations.length >= MAX_DELEGATIONS) fail(409, 'DELEGATION_LIMIT', '开发计划委托数量已达上限。');
      const at = nowIso();
      const delegation = {
        id: randomUUID(),
        requestId: body.requestId, requestFingerprint,
        productId: product.id, productRevision: product.revision, productHash: product.contentHash,
        productRefs,
        input: normalizedInput,
        plan, planHash,
        status: 'draft',
        execution: {
          status: 'not_started', startedAt: null, finishedAt: null,
          sources: [], importIds: [], imports: [], counts: emptyCounts(),
          lastError: null, lastExecuteRequestId: null, workerOrderId: null,
          reason: '开发计划已生成；等待人工审批，审批后可导入客户授权线索并执行规则评分。',
        },
        createdBy: actor.subject, createdAt: at, updatedAt: at,
        approvedBy: null, approvedAt: null, approvalRequestId: null, approvalNote: null,
        cancelledBy: null, cancelledAt: null, cancelReason: null,
        artifactId: null, artifactSha256: null,
      };
      registry.delegations.push(delegation);
      pushEvent(registry, 'delegation_created', actor, { delegationId: delegation.id, productId: product.id, productRevision: product.revision });
      return { delegation: delegationView(delegation), duplicate: false };
    });
    if (created.duplicate) return { ...created, product: publicProduct(product) };
    const withArtifact = await attachPlanArtifact(product, created.delegation);
    return { delegation: withArtifact || created.delegation, product: publicProduct(product), duplicate: false };
  }

  function listDelegations() {
    const registry = registryView(store.read());
    return { delegations: [...registry.delegations].sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id)).map(delegationView) };
  }

  function getDelegation(id) {
    if (typeof id !== 'string' || !id.trim() || id.length > 128) fail(400, 'INVALID_INPUT', '委托 id 无效。');
    const found = registryView(store.read()).delegations.find(item => item.id === id);
    if (!found) fail(404, 'DELEGATION_NOT_FOUND', '开发计划委托不存在。');
    return { delegation: delegationView(found) };
  }

  async function approveDelegation(id, body, actor) {
    requireActor(actor, { admin: true });
    onlyFields(body, ['requestId', 'confirmed', 'note'], '委托审批');
    if (body.confirmed !== true) fail(400, 'CONFIRMATION_REQUIRED', '审批需要 confirmed: true。');
    if (!identifier(body.requestId)) fail(400, 'INVALID_INPUT', '审批需要稳定的 requestId。');
    const note = body.note === undefined ? null : text(body.note, 'note', 1000, { required: false });
    return store.update(state => {
      const registry = registryMutable(state);
      const delegation = registry.delegations.find(item => item.id === id);
      if (!delegation) fail(404, 'DELEGATION_NOT_FOUND', '开发计划委托不存在。');
      if (delegation.status === 'approved' && delegation.approvalRequestId === body.requestId) return { delegation: delegationView(delegation), duplicate: true };
      if (delegation.status !== 'draft') fail(409, 'INVALID_STATE', '只有 draft 状态的委托可以审批。');
      delegation.status = 'approved';
      delegation.approvedBy = actor.subject;
      delegation.approvedAt = nowIso();
      delegation.approvalRequestId = body.requestId;
      delegation.approvalNote = note;
      delegation.updatedAt = delegation.approvedAt;
      pushEvent(registry, 'delegation_approved', actor, { delegationId: delegation.id });
      return { delegation: delegationView(delegation), duplicate: false };
    });
  }

  async function cancelDelegation(id, body, actor) {
    requireActor(actor, { write: true });
    onlyFields(body, ['requestId', 'reason'], '委托取消');
    if (!identifier(body.requestId)) fail(400, 'INVALID_INPUT', '取消需要稳定的 requestId。');
    const reason = body.reason === undefined ? null : text(body.reason, 'reason', 500, { required: false });
    return store.update(state => {
      const registry = registryMutable(state);
      const delegation = registry.delegations.find(item => item.id === id);
      if (!delegation) fail(404, 'DELEGATION_NOT_FOUND', '开发计划委托不存在。');
      if (delegation.status === 'cancelled' && delegation.cancelRequestId === body.requestId) return { delegation: delegationView(delegation), duplicate: true };
      if (delegation.status !== 'draft') fail(409, 'INVALID_STATE', '只有 draft 状态的委托可以取消；已审批委托需走终止流程。');
      delegation.status = 'cancelled';
      delegation.cancelledBy = actor.subject;
      delegation.cancelledAt = nowIso();
      delegation.cancelRequestId = body.requestId;
      delegation.cancelReason = reason;
      delegation.updatedAt = delegation.cancelledAt;
      pushEvent(registry, 'delegation_cancelled', actor, { delegationId: delegation.id });
      return { delegation: delegationView(delegation), duplicate: false };
    });
  }

  function requireApprovedDelegation(registry, id) {
    const delegation = registry.delegations.find(item => item.id === id);
    if (!delegation) fail(404, 'DELEGATION_NOT_FOUND', '开发计划委托不存在。');
    if (delegation.status === 'cancelled') fail(409, 'INVALID_STATE', '已取消的委托不能执行或导入线索。');
    if (delegation.status !== 'approved') fail(409, 'DELEGATION_NOT_APPROVED', '先审批开发计划，才能导入线索或开始执行。');
    return delegation;
  }

  function ensureExecution(delegation) {
    delegation.execution = executionView(delegation.execution);
    return delegation.execution;
  }

  async function importCandidates(delegationId, body, actor) {
    requireActor(actor, { write: true });
    onlyFields(body, ['requestId', 'format', 'content'], '线索导入');
    if (!identifier(body.requestId)) fail(400, 'INVALID_INPUT', '导入线索需要稳定的 requestId。');
    const { format, rows } = importRows(body);
    const fingerprint = digest({ format, content: body.content });
    return store.update(state => {
      const registry = registryMutable(state);
      const delegation = requireApprovedDelegation(registry, delegationId);
      const execution = ensureExecution(delegation);
      const previous = execution.imports.find(item => item.requestId === body.requestId);
      if (previous) {
        if (previous.fingerprint !== fingerprint) fail(409, 'IDEMPOTENCY_CONFLICT', '同一 requestId 不能用于不同的导入内容。');
        return { import: structuredClone(previous), delegation: delegationView(delegation), duplicate: true };
      }
      if (execution.imports.length >= 50) fail(409, 'IMPORT_LIMIT', '单个委托的导入批次已达上限。');
      const existingKeys = new Set(registry.candidates.filter(item => item.delegationId === delegation.id).map(item => item.dedupeKey));
      const accepted = [], rejected = [];
      for (const [index, row] of rows.entries()) {
        const normalized = normalizeImportedRow(row, index, delegation);
        if (normalized.error) { rejected.push(normalized.error); continue; }
        const candidate = normalized.candidate;
        if (existingKeys.has(candidate.dedupeKey)) { rejected.push({ row: index + 2, code: 'DUPLICATE_CANDIDATE', message: '同一域名/公司已存在，重复行被拒绝。' }); continue; }
        if (registry.candidates.filter(item => item.delegationId === delegation.id).length + accepted.length >= MAX_CANDIDATES_PER_DELEGATION) fail(409, 'CANDIDATE_LIMIT', `单个委托最多 ${MAX_CANDIDATES_PER_DELEGATION} 条候选线索。`);
        if (registry.candidates.length + accepted.length >= MAX_CANDIDATES) fail(409, 'CANDIDATE_LIMIT', '平台候选线索总量已达上限。');
        const at = nowIso();
        accepted.push({
          id: randomUUID(), delegationId: delegation.id,
          productRef: delegation.productRefs.find(ref => ref.field === 'productId') || null,
          ...candidate,
          source: { kind: 'authorized_import', importId: null, format, row: index + 2 },
          status: 'needs_review', review: null,
          createdAt: at, updatedAt: at,
        });
        existingKeys.add(candidate.dedupeKey);
      }
      const importId = randomUUID();
      for (const record of accepted) { record.source.importId = importId; registry.candidates.push(record); }
      const counts = countCandidates(registry.candidates.filter(item => item.delegationId === delegation.id));
      const duplicates = rejected.filter(item => item.code === 'DUPLICATE_CANDIDATE').length;
      execution.imports.push({ id: importId, requestId: body.requestId, fingerprint, format, at: nowIso(), imported: accepted.length, duplicates, rejectedRows: rejected.length - duplicates });
      execution.importIds.push(importId);
      execution.counts = {
        ...execution.counts,
        importBatches: execution.imports.length,
        imported: (execution.counts.imported || 0) + accepted.length,
        duplicates: (execution.counts.duplicates || 0) + duplicates,
        rejectedRows: (execution.counts.rejectedRows || 0) + rejected.length - duplicates,
        ...counts,
      };
      if (execution.status === 'awaiting_source' && accepted.length) {
        execution.status = 'not_started';
        execution.reason = '已导入客户授权线索；开始执行后会完成规则评分并生成待审核队列。';
      }
      delegation.updatedAt = nowIso();
      pushEvent(registry, 'candidates_imported', actor, { delegationId: delegation.id, importId, imported: accepted.length, rejected: rejected.length });
      return {
        import: { id: importId, requestId: body.requestId, format, rows: rows.length, imported: accepted.length, duplicates, rejected },
        delegation: delegationView(delegation), duplicate: false,
      };
    });
  }

  function listCandidates(delegationId) {    if (typeof delegationId !== 'string' || !delegationId.trim() || delegationId.length > 128) fail(400, 'INVALID_INPUT', '委托 id 无效。');
    const registry = registryView(store.read());
    if (!registry.delegations.some(item => item.id === delegationId)) fail(404, 'DELEGATION_NOT_FOUND', '开发计划委托不存在。');
    return { candidates: registry.candidates.filter(item => item.delegationId === delegationId).map(candidateView) };
  }

  function exportCandidates(delegationId) {
    const registry = registryView(store.read());
    const delegation = registry.delegations.find(item => item.id === delegationId);
    if (!delegation) fail(404, 'DELEGATION_NOT_FOUND', '开发计划委托不存在。');
    const headers = ['companyName', 'websiteDomain', 'country', 'buyerType', 'contactName', 'contactEmail', 'fitScore', 'status', 'sourceUrls', 'evidenceExcerpt', 'notes', 'createdAt'];
    const rows = registry.candidates.filter(item => item.delegationId === delegationId).map(item => ({
      companyName: item.companyName, websiteDomain: item.websiteDomain, country: item.country, buyerType: item.buyerType,
      contactName: item.contact?.name || '', contactEmail: item.contact?.email || '', fitScore: item.fitScore, status: item.status,
      sourceUrls: (item.evidence || []).map(evidence => evidence.sourceUrl).join(' | '),
      evidenceExcerpt: item.evidence?.[0]?.excerpt || '', notes: item.notes || '', createdAt: item.createdAt,
    }));
    return exportPayload(delegationId, 'candidates', headers, rows);
  }

  function exportDrafts(delegationId) {
    const registry = registryView(store.read());
    const delegation = registry.delegations.find(item => item.id === delegationId);
    if (!delegation) fail(404, 'DELEGATION_NOT_FOUND', '开发计划委托不存在。');
    const candidates = new Map(registry.candidates.filter(item => item.delegationId === delegationId).map(item => [item.id, item]));
    const headers = ['draftId', 'companyName', 'language', 'revision', 'status', 'sent', 'sentAt', 'provider', 'providerMessageId', 'subject', 'rejectReason', 'reviewedBy', 'updatedAt'];
    const rows = registry.drafts.filter(item => item.delegationId === delegationId).map(item => ({
      draftId: item.id, companyName: candidates.get(item.candidateId)?.companyName || '', language: item.language, revision: item.revision,
      status: item.status, sent: item.sent, sentAt: item.sentAt || '', provider: item.sendReceipt?.provider || '',
      providerMessageId: item.sendReceipt?.messageId || '', subject: item.subject, rejectReason: item.rejectReason || '',
      reviewedBy: item.reviewedBy || '', updatedAt: item.updatedAt,
    }));
    return exportPayload(delegationId, 'drafts', headers, rows);
  }

  function exportEvents(delegationId) {
    const registry = registryView(store.read());
    if (!registry.delegations.some(item => item.id === delegationId)) fail(404, 'DELEGATION_NOT_FOUND', '开发计划委托不存在。');
    const headers = ['eventId', 'type', 'at', 'actor', 'detail'];
    const rows = registry.events.filter(item => item.delegationId === delegationId).map(item => {
      const { id, type, at, actor, delegationId: _delegationId, ...detail } = item;
      return { eventId: id, type, at, actor: actor || '', detail: JSON.stringify(detail) };
    });
    return exportPayload(delegationId, 'events', headers, rows);
  }

  function listEvents(delegationId) {
    if (typeof delegationId !== 'string' || !delegationId.trim() || delegationId.length > 128) fail(400, 'INVALID_INPUT', '委托 id 无效。');
    const registry = registryView(store.read());
    if (!registry.delegations.some(item => item.id === delegationId)) fail(404, 'DELEGATION_NOT_FOUND', '开发计划委托不存在。');
    const events = registry.events.filter(item => item.delegationId === delegationId).slice(-100).reverse().map(item => structuredClone(item));
    return { events };
  }

  async function executeDelegation(delegationId, body, actor) {
    requireActor(actor, { write: true });
    onlyFields(body, ['requestId'], '执行委托');
    if (!identifier(body.requestId)) fail(400, 'INVALID_INPUT', '执行需要稳定的 requestId。');
    const snapshot = store.read();
    const preview = registryView(snapshot).delegations.find(item => item.id === delegationId);
    if (!preview) fail(404, 'DELEGATION_NOT_FOUND', '开发计划委托不存在。');
    if (preview.status === 'cancelled') fail(409, 'INVALID_STATE', '已取消的委托不能执行。');
    if (preview.status !== 'approved') fail(409, 'DELEGATION_NOT_APPROVED', '先审批开发计划，才能执行。');
    const adapters = configuredSearchAdapters();
    const collected = [];
    const errors = [];
    let queriesRun = 0;
    if (adapters.length) {
      const allQueries = Array.isArray(preview.plan?.discovery?.queries)
        ? preview.plan.discovery.queries.filter(item => item && typeof item.query === 'string' && item.query.trim() && ['web_search', 'paid_data_optional'].includes(item.source))
        : [];
      const queries = allQueries.slice(0, 3);
      for (const adapter of adapters) {
        for (const query of queries) {
          queriesRun += 1;
          try {
            const results = await adapter.search({ query: query.query, limit: 10 });
            for (const result of results) collected.push({ result, adapterId: adapter.id, query: query.query });
          } catch (error) {
            errors.push({ source: adapter.id, query: String(query.query).slice(0, 120), message: String(error?.message || error).slice(0, 200) });
          }
        }
      }
    }
    return store.update(state => {
      const registry = registryMutable(state);
      const delegation = requireApprovedDelegation(registry, delegationId);
      const execution = ensureExecution(delegation);
      if (execution.lastExecuteRequestId === body.requestId && execution.status === 'completed') {
        return { delegation: delegationView(delegation), duplicate: true };
      }
      const at = nowIso();
      const existing = registry.candidates.filter(item => item.delegationId === delegation.id);
      const existingKeys = new Set(existing.map(item => item.dedupeKey));
      const accepted = [];
      const dropped = [];
      for (const entry of collected) {
        if (existing.length + accepted.length >= MAX_CANDIDATES_PER_DELEGATION) { dropped.push('candidate_limit'); break; }
        if (registry.candidates.length >= MAX_CANDIDATES) { dropped.push('platform_limit'); break; }
        const built = autoCandidateRecord({ ...entry, delegation, at });
        if (built.dropped) { dropped.push(built.dropped); continue; }
        if (existingKeys.has(built.candidate.dedupeKey)) { dropped.push('duplicate'); continue; }
        existingKeys.add(built.candidate.dedupeKey);
        accepted.push(built.candidate);
      }
      for (const candidate of accepted) registry.candidates.push(candidate);
      const all = existing.concat(accepted);
      const adapterIds = adapters.map(adapter => adapter.id);
      execution.startedAt = execution.startedAt || at;
      execution.finishedAt = at;
      execution.lastExecuteRequestId = body.requestId;
      execution.sources = [...new Set([...(existing.some(item => item.source?.kind === 'authorized_import') ? ['authorized_import'] : []), ...adapterIds])];
      execution.counts = { ...execution.counts, ...countCandidates(all) };
      if (all.length === 0) {
        if (adapters.length === 0) {
          execution.status = 'awaiting_source';
          execution.lastError = null;
          execution.reason = '没有可执行的线索输入：请先导入客户授权的线索（CSV/JSON），或配置 SERPER_API_KEY / COMPANIES_HOUSE_API_KEY 启用自动搜索；未配置前不会生成任何线索。';
          delegation.updatedAt = at;
          pushEvent(registry, 'execution_awaiting_source', actor, { delegationId: delegation.id, queriesRun, adapters: adapterIds });
          return { delegation: delegationView(delegation), duplicate: false, awaitingSource: true };
        }
        const allFailed = queriesRun > 0 && errors.length === queriesRun;
        execution.status = allFailed ? 'failed' : 'completed';
        execution.lastError = errors.length ? { code: 'SOURCE_PARTIAL_FAILURE', message: `${errors.length}/${queriesRun} 个查询失败；示例：${errors[0].message}`, at } : null;
        execution.reason = allFailed
          ? '自动搜索全部查询失败，未生成候选；请检查数据源凭据/网络后重试，或导入客户授权线索。'
          : `已执行 ${queriesRun} 个自动查询，但没有可入库候选（丢弃 ${dropped.length} 条）；请调整 query/市场或导入客户授权线索。`;
        delegation.updatedAt = at;
        pushEvent(registry, allFailed ? 'execution_failed' : 'execution_completed', actor, { delegationId: delegation.id, queriesRun, accepted: 0, errors: errors.length });
        return { delegation: delegationView(delegation), duplicate: false, awaitingSource: false };
      }
      execution.status = 'completed';
      execution.lastError = errors.length ? { code: 'SOURCE_PARTIAL_FAILURE', message: `${errors.length}/${queriesRun} 个查询失败；示例：${errors[0].message}`, at } : null;
      execution.reason = `已入库 ${accepted.length} 条新候选（丢弃 ${dropped.length} 条：重复/无效/超限），共 ${all.length} 条待人工审核；自动搜索只提供公开来源与摘要，需人工确认产品匹配。`;
      delegation.updatedAt = at;
      pushEvent(registry, 'execution_completed', actor, { delegationId: delegation.id, queriesRun, accepted: accepted.length, errors: errors.length });
      return { delegation: delegationView(delegation), duplicate: false };
    });
  }

  async function reviewCandidate(candidateId, body, actor) {
    requireActor(actor, { write: true });
    onlyFields(body, ['requestId', 'decision', 'reason'], '线索审核');
    if (!identifier(body.requestId)) fail(400, 'INVALID_INPUT', '审核需要稳定的 requestId。');
    if (!['qualified', 'rejected'].includes(body.decision)) fail(400, 'INVALID_INPUT', 'decision 只支持 qualified / rejected。');
    const reason = text(body.reason, '审核理由', 500);
    if (reason.length < 2) fail(400, 'INVALID_INPUT', '审核理由至少 2 个字符。');
    return store.update(state => {
      const registry = registryMutable(state);
      const candidate = registry.candidates.find(item => item.id === candidateId);
      if (!candidate) fail(404, 'CANDIDATE_NOT_FOUND', '候选线索不存在。');
      const delegation = registry.delegations.find(item => item.id === candidate.delegationId);
      if (!delegation) fail(409, 'INVALID_STATE', '候选线索所属委托已不存在。');
      if (candidate.review && candidate.review.requestId === body.requestId) return { candidate: candidateView(candidate), delegation: delegationView(delegation), duplicate: true };
      if (candidate.status !== 'needs_review') fail(409, 'INVALID_STATE', '只有待审核线索可以审核。');
      const at = nowIso();
      candidate.status = body.decision;
      candidate.review = { requestId: body.requestId, decision: body.decision, reason, reviewer: actor.subject, at };
      candidate.updatedAt = at;
      const execution = ensureExecution(delegation);
      execution.counts = { ...execution.counts, ...countCandidates(registry.candidates.filter(item => item.delegationId === delegation.id)) };
      delegation.updatedAt = at;
      pushEvent(registry, 'candidate_reviewed', actor, { delegationId: delegation.id, candidateId: candidate.id, decision: body.decision });
      return { candidate: candidateView(candidate), delegation: delegationView(delegation), duplicate: false };
    });
  }

  async function createDraft(candidateId, body, actor) {
    requireActor(actor, { write: true });
    onlyFields(body, ['requestId', 'language'], '开发信草稿');
    if (!identifier(body.requestId)) fail(400, 'INVALID_INPUT', '生成草稿需要稳定的 requestId。');
    if (body.language !== undefined && typeof body.language !== 'string') fail(400, 'INVALID_INPUT', 'language 必须是字符串。');
    return store.update(state => {
      const registry = registryMutable(state);
      const candidate = registry.candidates.find(item => item.id === candidateId);
      if (!candidate) fail(404, 'CANDIDATE_NOT_FOUND', '候选线索不存在。');
      if (candidate.status !== 'qualified') fail(409, 'CANDIDATE_NOT_QUALIFIED', '只有已合格线索可以生成开发信草稿。');
      const delegation = registry.delegations.find(item => item.id === candidate.delegationId);
      if (!delegation) fail(409, 'INVALID_STATE', '候选线索所属委托已不存在。');
      const previous = registry.drafts.find(item => item.candidateId === candidate.id);
      const fingerprint = digest({ candidateId: candidate.id, candidateUpdatedAt: candidate.updatedAt, language: body.language ?? null });
      if (previous) {
        if (previous.requestId === body.requestId) {
          if (previous.requestFingerprint === fingerprint) return { draft: structuredClone(previous), delegation: delegationView(delegation), duplicate: true };
          fail(409, 'IDEMPOTENCY_CONFLICT', '同一 requestId 不能用于不同的草稿内容。');
        }
        if (previous.status === 'draft') fail(409, 'DRAFT_EXISTS', '该线索已有待审核草稿；请先审批或拒绝。');
        if (previous.status === 'approved') fail(409, 'DRAFT_APPROVED', '该线索已有已批准草稿。');
      }
      const at = nowIso();
      const built = buildOutreachDraft({ delegation, candidate, language: body.language, now: at });
      const record = {
        id: previous?.id || randomUUID(),
        delegationId: delegation.id,
        candidateId: candidate.id,
        requestId: body.requestId,
        requestFingerprint: fingerprint,
        revision: (previous?.revision || 0) + 1,
        ...built,
        contentHash: digest({ subject: built.subject, body: built.body }),
        status: 'draft',
        humanReviewRequired: true,
        sent: false,
        externalSend: 'not_implemented',
        sentAt: null,
        sendReceipt: null,
        sendRequestId: null,
        sendAttempts: [],
        lastSendError: null,
        createdAt: previous?.createdAt || at,
        updatedAt: at,
        reviewedBy: null,
        reviewedAt: null,
        reviewRequestId: null,
        reviewNote: null,
        rejectReason: null,
      };
      if (previous) registry.drafts.splice(registry.drafts.indexOf(previous), 1, record);
      else {
        if (registry.drafts.length >= MAX_DRAFTS) fail(409, 'DRAFT_LIMIT', '开发信草稿数量已达上限。');
        registry.drafts.push(record);
      }
      pushEvent(registry, previous ? 'draft_regenerated' : 'draft_created', actor, { delegationId: delegation.id, candidateId: candidate.id, draftId: record.id });
      return { draft: structuredClone(record), delegation: delegationView(delegation), duplicate: false };
    });
  }

  function listDrafts(delegationId) {
    if (typeof delegationId !== 'string' || !delegationId.trim() || delegationId.length > 128) fail(400, 'INVALID_INPUT', '委托 id 无效。');
    const registry = registryView(store.read());
    if (!registry.delegations.some(item => item.id === delegationId)) fail(404, 'DELEGATION_NOT_FOUND', '开发计划委托不存在。');
    return { drafts: registry.drafts.filter(item => item.delegationId === delegationId).map(item => structuredClone(item)) };
  }

  function getDraft(id) {
    if (typeof id !== 'string' || !id.trim() || id.length > 128) fail(400, 'INVALID_INPUT', '草稿 id 无效。');
    const draft = registryView(store.read()).drafts.find(item => item.id === id);
    if (!draft) fail(404, 'DRAFT_NOT_FOUND', '开发信草稿不存在。');
    return { draft: structuredClone(draft) };
  }

  async function approveDraft(id, body, actor) {
    requireActor(actor, { admin: true });
    onlyFields(body, ['requestId', 'confirmed', 'note'], '草稿审批');
    if (body.confirmed !== true) fail(400, 'CONFIRMATION_REQUIRED', '审批草稿需要 confirmed: true。');
    if (!identifier(body.requestId)) fail(400, 'INVALID_INPUT', '审批需要稳定的 requestId。');
    const note = body.note === undefined ? null : text(body.note, 'note', 1000, { required: false });
    return store.update(state => {
      const registry = registryMutable(state);
      const draft = registry.drafts.find(item => item.id === id);
      if (!draft) fail(404, 'DRAFT_NOT_FOUND', '开发信草稿不存在。');
      if (draft.status === 'approved' && draft.reviewRequestId === body.requestId) return { draft: structuredClone(draft), duplicate: true };
      if (draft.status !== 'draft') fail(409, 'INVALID_STATE', '只有待审核草稿可以审批。');
      const candidate = registry.candidates.find(item => item.id === draft.candidateId);
      if (!candidate || candidate.status !== 'qualified') fail(409, 'CANDIDATE_NOT_QUALIFIED', '线索已不是合格状态，不能审批草稿。');
      draft.status = 'approved';
      draft.reviewedBy = actor.subject;
      draft.reviewedAt = nowIso();
      draft.reviewRequestId = body.requestId;
      draft.reviewNote = note;
      draft.updatedAt = draft.reviewedAt;
      pushEvent(registry, 'draft_approved', actor, { delegationId: draft.delegationId, draftId: draft.id });
      return { draft: structuredClone(draft), duplicate: false };
    });
  }

  async function rejectDraft(id, body, actor) {
    requireActor(actor, { write: true });
    onlyFields(body, ['requestId', 'reason'], '草稿拒绝');
    if (!identifier(body.requestId)) fail(400, 'INVALID_INPUT', '拒绝草稿需要稳定的 requestId。');
    const reason = text(body.reason, '拒绝理由', 500);
    if (reason.length < 2) fail(400, 'INVALID_INPUT', '拒绝理由至少 2 个字符。');
    return store.update(state => {
      const registry = registryMutable(state);
      const draft = registry.drafts.find(item => item.id === id);
      if (!draft) fail(404, 'DRAFT_NOT_FOUND', '开发信草稿不存在。');
      if (draft.status === 'rejected' && draft.reviewRequestId === body.requestId) return { draft: structuredClone(draft), duplicate: true };
      if (draft.status !== 'draft') fail(409, 'INVALID_STATE', '只有待审核草稿可以拒绝。');
      draft.status = 'rejected';
      draft.reviewedBy = actor.subject;
      draft.reviewedAt = nowIso();
      draft.reviewRequestId = body.requestId;
      draft.rejectReason = reason;
      draft.updatedAt = draft.reviewedAt;
      pushEvent(registry, 'draft_rejected', actor, { delegationId: draft.delegationId, draftId: draft.id });
      return { draft: structuredClone(draft), duplicate: false };
    });
  }

  function sources() {
    return { sources: sourceReadiness(sourceEnvironment) };
  }

  function outreach() {
    const registry = registryView(store.read());
    const drafts = registry.drafts || [];
    const candidates = registry.candidates || [];
    const attempts = drafts.flatMap(item => item.sendAttempts || []);
    const lastErrors = drafts.map(item => item.lastSendError).filter(Boolean).sort((a, b) => b.at.localeCompare(a.at));
    const failedDrafts = drafts.filter(item => item.sent !== true && item.lastSendError).map(item => ({
      draftId: item.id, delegationId: item.delegationId, candidateId: item.candidateId,
      companyName: candidates.find(candidate => candidate.id === item.candidateId)?.companyName || '',
      provider: item.sendAttempts?.at(-1)?.provider || null,
      error: item.lastSendError.message, at: item.lastSendError.at,
    })).slice(0, 20);
    return {
      outreach: outreachReadiness(sourceEnvironment),
      suppressions: structuredClone(registry.suppressions || []),
      failedDrafts,
      stats: {
        sent: drafts.filter(item => item.sent === true).length,
        attempts: attempts.length,
        failedAttempts: attempts.filter(item => item.outcome === 'failed').length,
        suppressions: (registry.suppressions || []).length,
        lastError: lastErrors[0] || null,
        providers: attempts.reduce((counts, item) => { if (item.provider) counts[item.provider] = (counts[item.provider] || 0) + 1; return counts; }, {}),
      },
    };
  }

  async function updateDraftContent(id, body, actor) {
    requireActor(actor, { write: true });
    onlyFields(body, ['requestId', 'subject', 'body'], '编辑开发信草稿');
    if (!identifier(body.requestId)) fail(400, 'INVALID_INPUT', '编辑草稿需要稳定的 requestId。');
    const subject = text(body.subject, 'subject', 200);
    const content = text(body.body, 'body', 8000);
    if (content.length < 20) fail(400, 'INVALID_INPUT', '草稿正文至少 20 个字符。');
    return store.update(state => {
      const registry = registryMutable(state);
      const draft = registry.drafts.find(item => item.id === id);
      if (!draft) fail(404, 'DRAFT_NOT_FOUND', '开发信草稿不存在。');
      if (draft.updateRequestId === body.requestId) return { draft: structuredClone(draft), duplicate: true };
      if (draft.sent === true) fail(409, 'ALREADY_SENT', '已发送的草稿不能再编辑。');
      if (draft.status !== 'draft') fail(409, 'INVALID_STATE', '只有待审核草稿可以编辑；已批准草稿需重新生成后审批。');
      const at = nowIso();
      draft.subject = subject;
      draft.body = content;
      draft.contentHash = digest({ subject, body: content });
      draft.revision += 1;
      draft.updateRequestId = body.requestId;
      draft.updatedAt = at;
      pushEvent(registry, 'draft_updated', actor, { delegationId: draft.delegationId, draftId: draft.id, revision: draft.revision });
      return { draft: structuredClone(draft), duplicate: false };
    });
  }

  async function sendDraft(id, body, actor) {
    requireActor(actor, { admin: true });
    onlyFields(body, ['requestId', 'confirmed', 'consentConfirmed', 'consentBasis'], '发送开发信');
    if (body.confirmed !== true) fail(400, 'CONFIRMATION_REQUIRED', '发送需要 confirmed: true（管理员逐封确认）。');
    if (!identifier(body.requestId)) fail(400, 'INVALID_INPUT', '发送需要稳定的 requestId。');
    if (!outreachTransport) fail(503, 'OUTREACH_NOT_CONFIGURED', '外发通道未配置：需要 OUTREACH_PROVIDER、对应 API key 与 OUTREACH_FROM_EMAIL。');
    const consentBasis = body.consentBasis === undefined ? '' : text(body.consentBasis, 'consentBasis', 500, { required: false });
    const snapshot = registryView(store.read());
    const draft = snapshot.drafts.find(item => item.id === id);
    if (!draft) fail(404, 'DRAFT_NOT_FOUND', '开发信草稿不存在。');
    if (draft.sent === true && draft.sendRequestId === body.requestId) return { draft: structuredClone(draft), duplicate: true };
    if (draft.sent === true) fail(409, 'ALREADY_SENT', '该草稿已经发送，不能重复发送。');
    if (draft.status !== 'approved') fail(409, 'DRAFT_NOT_APPROVED', '只有已批准草稿可以发送。');
    if (outreachReadiness(sourceEnvironment).dualApproval && draft.reviewedBy === actor.subject) {
      fail(403, 'DUAL_APPROVAL_REQUIRED', '已开启双人审批：审批人与发送人必须是不同的管理员。');
    }
    const candidate = snapshot.candidates.find(item => item.id === draft.candidateId);
    if (!candidate || candidate.status !== 'qualified') fail(409, 'CANDIDATE_NOT_QUALIFIED', '线索已不是合格状态，不能发送。');
    const to = candidate.contact?.email || '';
    if (!EMAIL_PATTERN.test(to)) fail(409, 'CONTACT_EMAIL_REQUIRED', '候选线索没有可用的企业邮箱，不能发送。');
    const domain = to.split('@')[1].toLocaleLowerCase();
    const suppression = (snapshot.suppressions || []).find(entry => (entry.email && entry.email.toLocaleLowerCase() === to.toLocaleLowerCase()) || (entry.domain && entry.domain.toLocaleLowerCase() === domain));
    if (suppression) fail(409, 'SUPPRESSED', `该收件人已在退订/抑制名单：${suppression.reason}`);
    const combined = `${draft.subject}\n${draft.body}`;
    const placeholders = [...new Set((combined.match(/\[[^\]\n]{2,60}\]/gu) || []))];
    if (placeholders.length) fail(409, 'DRAFT_PLACEHOLDERS', `发送前必须替换占位符：${placeholders.join('、')}`);
    if (!/https:\/\//u.test(combined)) fail(409, 'UNSUBSCRIBE_LINK_REQUIRED', '正文必须包含可用的退订/隐私链接（https URL）。');
    if (draft.compliance?.consentRequired === true && body.consentConfirmed !== true) fail(409, 'CONSENT_REQUIRED', '目标市场要求事先同意：发送需 consentConfirmed: true 并填写 consentBasis。');
    if (draft.compliance?.consentRequired === true && consentBasis.trim().length < 5) fail(400, 'INVALID_INPUT', 'consentBasis 至少 5 个字符（记录同意来源/时间）。');
    let receipt;
    try {
      receipt = await outreachTransport.send({ to, subject: draft.subject, text: draft.body });
    } catch (error) {
      const message = String(error?.message || error).slice(0, 200);
      const at = nowIso();
      try {
        await store.update(state => {
          const registry = registryMutable(state);
          const current = registry.drafts.find(item => item.id === id);
          if (!current || current.sent === true) return { draft: current ? structuredClone(current) : null, duplicate: false };
          current.sendAttempts = [...(current.sendAttempts || []), { requestId: body.requestId, at, outcome: 'failed', provider: outreachTransport.provider, error: message }].slice(-20);
          current.lastSendError = { code: 'OUTREACH_PROVIDER_ERROR', message, at };
          current.updatedAt = at;
          pushEvent(registry, 'outreach_failed', actor, { delegationId: current.delegationId, draftId: current.id, provider: outreachTransport.provider, error: message });
          return { draft: structuredClone(current), duplicate: false };
        });
      } catch { /* the original provider error is the actionable failure */ }
      fail(502, 'OUTREACH_PROVIDER_ERROR', `邮件服务发送失败：${message}`);
    }
    const at = nowIso();
    return store.update(state => {
      const registry = registryMutable(state);
      const current = registry.drafts.find(item => item.id === id);
      if (!current) fail(404, 'DRAFT_NOT_FOUND', '开发信草稿不存在。');
      if (current.sent === true) {
        if (current.sendRequestId === body.requestId) return { draft: structuredClone(current), duplicate: true };
        fail(409, 'ALREADY_SENT', '该草稿已经发送，不能重复发送。');
      }
      if (current.status !== 'approved') fail(409, 'DRAFT_NOT_APPROVED', '只有已批准草稿可以发送。');
      current.sent = true;
      current.sentAt = at;
      current.externalSend = `provider:${receipt.provider}`;
      current.sendReceipt = { provider: receipt.provider, messageId: receipt.messageId, at, to, consentBasis: consentBasis || null };
      current.sendRequestId = body.requestId;
      current.sendAttempts = [...(current.sendAttempts || []), { requestId: body.requestId, at, outcome: 'sent', provider: receipt.provider }].slice(-20);
      current.lastSendError = null;
      current.updatedAt = at;
      pushEvent(registry, 'outreach_sent', actor, { delegationId: current.delegationId, draftId: current.id, provider: receipt.provider });
      return { draft: structuredClone(current), duplicate: false };
    });
  }

  function listSuppressions() {
    return { suppressions: structuredClone(registryView(store.read()).suppressions || []) };
  }

  async function addSuppression(body, actor) {
    requireActor(actor, { admin: true });
    onlyFields(body, ['requestId', 'email', 'domain', 'reason'], '新增退订/抑制');
    if (!identifier(body.requestId)) fail(400, 'INVALID_INPUT', '新增抑制需要稳定的 requestId。');
    const email = body.email === undefined ? '' : text(body.email, 'email', 200, { required: false }).toLocaleLowerCase();
    const domain = body.domain === undefined ? '' : text(body.domain, 'domain', 200, { required: false }).toLocaleLowerCase();
    if (!email && !domain) fail(400, 'INVALID_INPUT', 'email 或 domain 至少填写一个。');
    if (email && !EMAIL_PATTERN.test(email)) fail(400, 'INVALID_INPUT', 'email 格式不正确。');
    if (domain && !/^[a-z0-9.-]+\.[a-z]{2,}$/u.test(domain)) fail(400, 'INVALID_INPUT', 'domain 格式不正确。');
    const reason = text(body.reason, 'reason', 500);
    if (reason.length < 2) fail(400, 'INVALID_INPUT', '抑制原因至少 2 个字符。');
    return store.update(state => {
      const registry = registryMutable(state);
      const existing = registry.suppressions.find(item => (email && item.email === email) || (domain && item.domain === domain));
      if (existing) return { suppression: structuredClone(existing), duplicate: true };
      if (registry.suppressions.length >= 5000) fail(409, 'SUPPRESSION_LIMIT', '抑制名单已达上限。');
      const record = { id: randomUUID(), email: email || null, domain: domain || null, reason, createdBy: actor.subject, createdAt: nowIso(), requestId: body.requestId };
      registry.suppressions.push(record);
      pushEvent(registry, 'suppression_added', actor, { suppressionId: record.id });
      return { suppression: structuredClone(record), duplicate: false };
    });
  }

  async function removeSuppression(id, body, actor) {
    requireActor(actor, { admin: true });
    onlyFields(body, ['requestId'], '撤销退订/抑制');
    if (!identifier(body.requestId)) fail(400, 'INVALID_INPUT', '撤销抑制需要稳定的 requestId。');
    return store.update(state => {
      const registry = registryMutable(state);
      const index = registry.suppressions.findIndex(item => item.id === id);
      if (index < 0) fail(404, 'SUPPRESSION_NOT_FOUND', '抑制记录不存在。');
      const [removed] = registry.suppressions.splice(index, 1);
      pushEvent(registry, 'suppression_removed', actor, { suppressionId: removed.id });
      return { removed: structuredClone(removed), duplicate: false };
    });
  }

  function status() {
    const registry = registryView(store.read());
    const latest = latestProducts(registry);
    const published = [...latest.values()].filter(product => product.status === 'published');
    return {
      version: AI_WORKS_VERSION,
      products: registry.products.length,
      publishedProducts: published.length,
      productIds: published.map(product => product.id),
      delegations: registry.delegations.length,
      draftDelegations: registry.delegations.filter(item => item.status === 'draft').length,
      approvedDelegations: registry.delegations.filter(item => item.status === 'approved').length,
      cancelledDelegations: registry.delegations.filter(item => item.status === 'cancelled').length,
      candidates: (registry.candidates || []).length,
      candidatesNeedsReview: (registry.candidates || []).filter(item => item.status === 'needs_review').length,
      candidatesQualified: (registry.candidates || []).filter(item => item.status === 'qualified').length,
      candidatesRejected: (registry.candidates || []).filter(item => item.status === 'rejected').length,
      drafts: (registry.drafts || []).length,
      draftDrafts: (registry.drafts || []).filter(item => item.status === 'draft').length,
      approvedDrafts: (registry.drafts || []).filter(item => item.status === 'approved').length,
      rejectedDrafts: (registry.drafts || []).filter(item => item.status === 'rejected').length,
      sentDrafts: (registry.drafts || []).filter(item => item.sent === true).length,
      suppressions: (registry.suppressions || []).length,
      outreach: outreachReadiness(sourceEnvironment),
      sourceReadiness: sourceReadiness(sourceEnvironment),
      productLibraryAvailable: typeof lookupProduct === 'function',
      firstProduct: published.find(product => product.id === 'lead-discovery') ? { id: 'lead-discovery', revision: published.find(product => product.id === 'lead-discovery').revision } : null,
    };
  }

  /** Publish the built-in first AI-work once. Idempotent across restarts. */
  async function initialize() {
    const definition = leadDiscoveryDefinition();
    const { definition: normalized, contentHash } = normalizeProductDefinition({ ...definition, requestId: 'builtin-lead-discovery' });
    return store.update(state => {
      const registry = registryMutable(state);
      const existing = publishedProduct(registry, normalized.id);
      if (existing) return { created: false, current: existing.contentHash === contentHash, productId: existing.id, revision: existing.revision };
      const revision = (latestProducts(registry).get(normalized.id)?.revision || 0) + 1;
      if (registry.products.length >= MAX_PRODUCTS) throw new Error('AI-work product limit reached during built-in publication.');
      const at = nowIso();
      const product = {
        ...normalized, revision, status: 'published', contentHash,
        requestId: 'builtin-lead-discovery', requestFingerprint: digest({ definition: normalized, status: 'published' }),
        changeNote: revision === 1 ? '平台内置的首个通用 AI-work（客户线索挖掘）。' : '内置 AI-work 定义更新。',
        createdBy: 'system', createdAt: at, updatedAt: at,
        publishedAt: at, publishedBy: 'system', retiredAt: null,
      };
      registry.products.push(product);
      pushEvent(registry, 'product_published', null, { productId: product.id, revision: product.revision, system: true });
      return { created: true, current: true, productId: product.id, revision: product.revision };
    });
  }

  return { initialize, status, catalog, getProduct, publish, createDelegation, listDelegations, getDelegation, approveDelegation, cancelDelegation, importCandidates, listCandidates, exportCandidates, exportDrafts, exportEvents, listEvents, executeDelegation, reviewCandidate, createDraft, listDrafts, getDraft, updateDraftContent, approveDraft, rejectDraft, sendDraft, sources, outreach, listSuppressions, addSuppression, removeSuppression };
}

/* ------------------------------------------------------------------------- */
/* HTTP mapping                                                               */
/* ------------------------------------------------------------------------- */

export async function aiWorksHttp({ service, method, pathname, body, actor }) {
  if (method === 'GET' && pathname === '/api/ai-works') return { status: 200, body: { ...service.catalog(), status: service.status() } };
  if (method === 'GET' && pathname === '/api/ai-works/status') return { status: 200, body: service.status() };
  if (method === 'GET' && pathname === '/api/ai-work-sources') return { status: 200, body: service.sources() };
  if (method === 'GET' && pathname === '/api/ai-work-outreach') return { status: 200, body: service.outreach() };
  if (method === 'GET' && pathname === '/api/ai-work-suppressions') return { status: 200, body: service.listSuppressions() };
  if (method === 'POST' && pathname === '/api/ai-work-suppressions') return { status: 201, body: await service.addSuppression(body, actor) };
  const suppressionMatch = pathname.match(/^\/api\/ai-work-suppressions\/([^/]+)\/remove$/u);
  if (method === 'POST' && suppressionMatch) return { status: 200, body: await service.removeSuppression(suppressionMatch[1], body, actor) };
  let match = pathname.match(/^\/api\/ai-works\/([a-z][a-z0-9-]{1,63})$/u);
  if (method === 'GET' && match) return { status: 200, body: service.getProduct(match[1]) };
  if (method === 'GET' && pathname === '/api/ai-work-delegations') return { status: 200, body: service.listDelegations() };
  match = pathname.match(/^\/api\/ai-work-delegations\/([^/]+)\/candidates$/u);
  if (method === 'GET' && match) return { status: 200, body: service.listCandidates(match[1]) };
  if (method === 'POST' && match) return { status: 201, body: await service.importCandidates(match[1], body, actor) };
  match = pathname.match(/^\/api\/ai-work-delegations\/([^/]+)\/execute$/u);
  if (method === 'POST' && match) return { status: 200, body: await service.executeDelegation(match[1], body, actor) };
  match = pathname.match(/^\/api\/ai-work-delegations\/([^/]+)\/drafts$/u);
  if (method === 'GET' && match) return { status: 200, body: service.listDrafts(match[1]) };
  match = pathname.match(/^\/api\/ai-work-delegations\/([^/]+)\/export\/(candidates|drafts|events)$/u);
  if (method === 'GET' && match) return { status: 200, body: match[2] === 'candidates' ? service.exportCandidates(match[1]) : match[2] === 'drafts' ? service.exportDrafts(match[1]) : service.exportEvents(match[1]) };
  match = pathname.match(/^\/api\/ai-work-delegations\/([^/]+)\/events$/u);
  if (method === 'GET' && match) return { status: 200, body: service.listEvents(match[1]) };
  match = pathname.match(/^\/api\/ai-work-candidates\/([^/]+)\/drafts$/u);
  if (method === 'POST' && match) return { status: 201, body: await service.createDraft(match[1], body, actor) };
  match = pathname.match(/^\/api\/ai-work-drafts\/([^/]+)\/approve$/u);
  if (method === 'POST' && match) return { status: 200, body: await service.approveDraft(match[1], body, actor) };
  match = pathname.match(/^\/api\/ai-work-drafts\/([^/]+)\/reject$/u);
  if (method === 'POST' && match) return { status: 200, body: await service.rejectDraft(match[1], body, actor) };
  match = pathname.match(/^\/api\/ai-work-drafts\/([^/]+)\/send$/u);
  if (method === 'POST' && match) return { status: 200, body: await service.sendDraft(match[1], body, actor) };
  match = pathname.match(/^\/api\/ai-work-drafts\/([^/]+)$/u);
  if (method === 'GET' && match) return { status: 200, body: service.getDraft(match[1]) };
  if (method === 'PATCH' && match) return { status: 200, body: await service.updateDraftContent(match[1], body, actor) };
  match = pathname.match(/^\/api\/ai-work-candidates\/([^/]+)\/review$/u);
  if (method === 'POST' && match) return { status: 200, body: await service.reviewCandidate(match[1], body, actor) };
  match = pathname.match(/^\/api\/ai-work-delegations\/([^/]+)$/u);
  if (method === 'GET' && match) return { status: 200, body: service.getDelegation(match[1]) };
  if (method === 'POST' && pathname === '/api/ai-works') return { status: 201, body: await service.publish(body, actor) };
  match = pathname.match(/^\/api\/ai-works\/([a-z][a-z0-9-]{1,63})\/delegations$/u);
  if (method === 'POST' && match) return { status: 201, body: await service.createDelegation(match[1], body, actor) };
  match = pathname.match(/^\/api\/ai-work-delegations\/([^/]+)\/approve$/u);
  if (method === 'POST' && match) return { status: 200, body: await service.approveDelegation(match[1], body, actor) };
  match = pathname.match(/^\/api\/ai-work-delegations\/([^/]+)\/cancel$/u);
  if (method === 'POST' && match) return { status: 200, body: await service.cancelDelegation(match[1], body, actor) };
  return null;
}
