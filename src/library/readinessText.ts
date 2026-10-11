import type { Readiness } from './types';

export const checkStatus = { missing: '缺项', invalid: '需修正', expired: '已过期', unverified: '待验证', verified: '已检查' };
const labels: Record<string, string> = { 'company.legalName': '企业名称', name: '产品名称', description: '产品简介', category: '产品分类', status: '产品状态', skus: 'SKU 与规格', images: '产品图片', documents: '支持资料', 'supply.packaging': '包装方式', 'supply.samplePolicy': '样品政策', 'supply.paymentTerms': '付款条件', 'supply.shippingTerms': '运输与贸易条件' };
const suffix: Record<string, string> = { specs: '规格项', unit: '计量单位', moq: '最小起订量', leadTimeDays: '交期', priceTiers: '内部报价' };
export function checkLabel(check: Readiness['checks'][number]) { const path = check.fieldPath; if (path.startsWith('skus.')) { const [_, index, key] = path.split('.'); return `SKU ${Number(index) + 1} · ${suffix[key] || key}`; } if (path === 'documents' && check.key.startsWith('document-')) return check.label.replace(': file integrity', ' · 文件完整性').replace(': validity', ' · 有效期').replace(': administrator review', ' · 人工审核'); return labels[path] || check.label; }
export function checkMessage(check: Readiness['checks'][number]) {
  if (check.status === 'expired') return '所关联的确切证书版本已经过期，请核对并更新关联。';
  if (check.key.endsWith('-integrity')) return check.status === 'verified' ? '确切文件版本与保存的 SHA-256 相符。' : '文件缺失或校验不一致，请重新核对。';
  if (check.key.endsWith('-review')) return check.status === 'verified' ? '管理员已记录对这个确切版本的检查。' : check.status === 'invalid' ? '管理员标记这个确切版本需要修正。' : '这个确切版本尚无管理员审核记录。';
  if (check.key.endsWith('-validity')) return check.status === 'verified' ? '记录的有效期覆盖今天，仍需核对文件真实性。' : check.status === 'invalid' ? '证书尚未生效，请核对日期。' : '有效期尚未核实，请补充证书记录。';
  if (check.status === 'missing') return '这项资料尚未补齐，草稿仍可以保存。';
  if (check.status === 'verified') return check.fieldPath === 'images' ? '确切图片版本的文件完整性已检查。' : '已保存这项内容；不代表外部资质或认证。';
  if (check.fieldPath === 'status') return '已归档产品不能作为待发布草稿。';
  return check.message;
}
