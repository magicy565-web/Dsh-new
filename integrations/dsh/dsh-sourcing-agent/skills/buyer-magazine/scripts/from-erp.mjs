import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const supported = ['product', 'procurement', 'exclusive'];
const requireText = (value, name) => { if (typeof value !== 'string' || !value.trim()) throw new Error(`${name}: text required`); };
const count = (value, name) => { if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${name}: non-negative safe integer required`); };
function timestamp(value, name) {
  requireText(value, name);
  if (!/^\d{4}-\d\d-\d\dT.*(?:Z|[+-]\d\d:\d\d)$/.test(value) || !Number.isFinite(Date.parse(value))) throw new Error(`${name}: timestamp with time zone required`);
}

// File adapter only: the ERP provides a snapshot; the Skill decides what to include.
// Original internal source references are retained separately from public blocks.
export function blocksFromErp(snapshot, selection) {
  const { modules, language = 'zh', timeZone = 'Asia/Shanghai', blockPrefix } = selection;
  if (!Array.isArray(modules) || !modules.length || new Set(modules).size !== modules.length || modules.some(m => !supported.includes(m))) throw new Error('Select unique ERP-backed modules: product, procurement, exclusive. Other modules need their own source material.');
  if (!['zh', 'en'].includes(language)) throw new Error('language must be zh or en');
  const en = language === 'en', t = (zh, english) => en ? english : zh;
  const fmt = new Intl.DateTimeFormat(en ? 'en-GB' : 'zh-CN', { timeZone, dateStyle: 'medium', timeStyle: 'long' });
  const time = value => fmt.format(new Date(value));
  const p = snapshot.product;
  requireText(snapshot.workspaceId, 'workspaceId'); timestamp(snapshot.asOf, 'asOf');
  if (!p) throw new Error('Supply snapshot must contain product');
  for (const key of ['id', 'name', 'source']) requireText(p[key], `product.${key}`);
  if (p.asOf !== snapshot.asOf) throw new Error('Product must belong to the same supply snapshot');
  count(p.revision, 'revision'); if (!p.revision) throw new Error('revision must be positive');
  count(p.unitPriceMinor, 'unitPriceMinor'); count(p.available, 'available'); count(p.stockTotal, 'stockTotal');
  if (p.available > p.stockTotal || !['USD', 'EUR', 'GBP', 'CNY'].includes(p.currency)) throw new Error('Invalid allocation or unsupported currency');
  const o = modules.includes('exclusive') ? snapshot.offer : null;
  if (modules.includes('exclusive')) {
    if (!o) throw new Error('exclusive requires an explicit offerId and matching offer snapshot');
    for (const key of ['id', 'territory', 'channel', 'term', 'conditions', 'source']) requireText(o[key], `offer.${key}`);
    if (o.productId !== p.id || o.asOf !== snapshot.asOf) throw new Error('Offer must match this product and snapshot');
    timestamp(o.validUntil, 'offer.validUntil'); count(o.capacity, 'capacity'); count(o.availableSlots, 'availableSlots');
    if (!o.capacity || o.availableSlots > o.capacity) throw new Error('Invalid offer allocation');
    if (Date.parse(o.validUntil) <= Date.parse(snapshot.asOf) && o.availableSlots !== 0) throw new Error('Expired offer cannot have available slots');
  }
  const prefix = blockPrefix ?? `erp-${createHash('sha256').update(JSON.stringify([snapshot.workspaceId, p.id, o?.id])).digest('hex').slice(0, 12)}`;
  if (!/^[a-zA-Z][\w-]*$/.test(prefix)) throw new Error('blockPrefix must be an HTML-safe identifier');
  const asOf = time(snapshot.asOf);
  const productEvidence = {
    label: t('ERP 商品记录', 'ERP product record'), kind: 'provided', date: snapshot.asOf,
    reference: t(`SKU ${p.id}，版本 ${p.revision}。读取时间 ${asOf}；原始资料由经营者登记，未在本次转换中独立核验。`, `SKU ${p.id}, revision ${p.revision}. Read at ${asOf}; underlying material was recorded by the operator and was not independently checked by this conversion.`),
  };
  const blocks = modules.map(type => {
    let data, evidence = [productEvidence];
    if (type === 'product') data = {
      summary: p.name, features: [t(`产品编号：${p.id}`, `SKU: ${p.id}`)],
    };
    if (type === 'procurement') data = { terms: [
      t(`ERP 登记单价：${p.currency} ${(p.unitPriceMinor / 100).toFixed(2)} / 件`, `ERP recorded unit price: ${p.currency} ${(p.unitPriceMinor / 100).toFixed(2)}`),
      t(`可分配数量快照：${p.available} 件（${asOf}）`, `Available allocation snapshot: ${p.available} units (${asOf})`),
      t('起订量、交期、运费、税费及付款条件尚需核对原始资料；登记单价不等于包含全部费用的报价。', 'MOQ, lead time, freight, taxes and payment terms require the source material. Recorded unit price is not an all-inclusive quote.'),
    ] };
    if (type === 'exclusive') {
      data = { status: 'recorded', territory: o.territory, channel: o.channel, term: o.term,
        conditions: [o.conditions, t(`接受新预留截止：${time(o.validUntil)}`, `New reservation deadline: ${time(o.validUntil)}`),
          t('这是 ERP 登记的权益条件，未在本次转换中独立核验供应方原始材料，也不表示已为本买手锁定。', 'These terms are recorded in the ERP; supplier source material was not independently verified by this conversion, and no slot has been reserved for this buyer.')],
        slots: o.availableSlots, asOf,
      };
      evidence = [{ label: t('ERP 供货权益记录', 'ERP supply-rights record'), kind: 'provided', date: snapshot.asOf,
        reference: t(`权益记录 ${o.id}。读取时间 ${asOf}；来源原文留在任务资料中。`, `Offer record ${o.id}. Read at ${asOf}; original source references remain in task materials.`) }];
    }
    return { id: `${prefix}-${type}`, type, product: p.name, data, evidence };
  });
  return {
    blocks,
    provenance: { internalOnly: true, workspaceId: snapshot.workspaceId, productId: p.id, productRevision: p.revision,
      productSource: p.source, asOf: snapshot.asOf, ...(o ? { offerId: o.id, offerSource: o.source } : {}) },
    notes: [t('仅转换所选模块。发布前按本期要求补充产品说明、图片及缺失条款；交易前重新读取 ERP。', 'Only selected modules were converted. Add descriptions, images and missing terms as needed; read the ERP again before any transaction.')],
  };
}

async function main(args) {
  if (args.length !== 3) throw new Error('Usage: node from-erp.mjs <supply-snapshot.json> <selection.json> <new-blocks.json>');
  const snapshot = JSON.parse(await readFile(resolve(args[0]), 'utf8'));
  const selection = JSON.parse(await readFile(resolve(args[1]), 'utf8'));
  const result = blocksFromErp(snapshot, selection);
  await writeFile(resolve(args[2]), JSON.stringify(result, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  console.log(`Created ${args[2]} with ${result.blocks.length} blocks. Internal provenance stays in the workspace.`);
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main(process.argv.slice(2)).catch(e => { console.error(e.message); process.exitCode = 1; });
