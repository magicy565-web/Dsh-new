// Client half of the Harness Workspace Library.
//
// Renders one main panel (产品库 / 企业资料库) plus its sidebar entry. All data
// comes from the Host half's same-origin JSON surface; styles use only the
// Harness theme tokens so the panel follows light/dark and future themes.
window.__ModuleLoader__.load({
  id: 'dsh-workspace-library',
  factory(require) {
    const React = require('react');
    const h = React.createElement;
    const SurfaceUI = React.createContext(null);
    const control = (name, tag) => React.forwardRef((props, ref) => {
      const ui = React.useContext(SurfaceUI);
      return h(ui?.[name] || tag, { ...props, ref });
    });
    const LibraryInput = control('Input', 'input'), LibraryTextArea = control('TextArea', 'textarea');
    const LibraryButton = control('Button', 'button'), LibraryCard = control('Card', 'div');
    const withSurfaceUI = Component => ({ ui, ...props }) => h(SurfaceUI.Provider, { value: ui || null }, h(Component, props));

    const { useCallback, useEffect, useMemo, useRef, useState } = React;

    const NS = 'workspace-library';
    const API = '/workspace-library-api';
    const PANEL_ID = 'workspace-library';
    const MAX_FILE_BYTES = 12 * 1024 * 1024;
    const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];
    const CERT_SLOTS = ['license', 'certificate', 'test_report'];
    const SLOTS = [
      ['company', '企业介绍'],
      ['license', '营业执照'],
      ['certificate', '资质证书'],
      ['test_report', '检测报告'],
      ['specification', '产品规格'],
      ['supply_policy', '供货政策'],
      ['other', '其他资料'],
    ];
    const SUPPLY_FIELDS = [
      ['packaging', '包装方式'],
      ['samplePolicy', '样品政策'],
      ['paymentTerms', '付款条件'],
      ['shippingTerms', '运输与贸易条件'],
      ['capacityNote', '产能与供货说明'],
    ];

    const zh = {
      'panel': '资料库',
      'reference.group': '企业资料 · 固定版本',
      'reference.insert': '引用资料',
      'reference.hint': '选择 TXT、Markdown、CSV 或 JSON 的确切版本',
      'eyebrow': '企业的知识与底气',
      'title': '资料库',
      'subtitle': '每一份资料，都为下一步做好准备。',
      'tab.products': '产品库',
      'tab.company': '企业资料',
      'action.newProduct': '新建产品',
      'action.newDocument': '上传资料',
      'notice.saved': '已保存。',
      'file.choose': '选择文件',
      'file.none': '尚未选择文件。',
      'file.tooLarge': '文件不能超过 {size} MiB。',
      'editor.modeFile': '上传文件',
      'editor.modeText': '文字说明',
      'editor.attachHint': '文件按原字节保存，SHA-256 会记录在版本里。',
      'editor.uploading': '正在上传…',
      'image.title': '产品图片',
      'image.add': '上传图片',
      'image.empty': '还没有产品图片。',
      'image.alt': '图片说明',
      'image.primary': '主图',
      'image.setPrimary': '设为主图',
      'image.up': '上移',
      'image.down': '下移',
      'image.remove': '移除图片',
      'image.hint': '支持 PNG、JPEG、WebP、GIF；单张不超过 12 MiB。',
      'image.saveFirst': '先保存产品，再上传图片。',
      'document.editInfo': '编辑资料信息',
      'document.file': '文件',
      'document.text': '文字',
      'document.openFile': '打开',
      'document.download': '下载',
      'document.textOnly': '文字版本，没有文件',
      'document.fileUnavailable': '文件不可读取',
      'metadata.title': '资料信息',
      'metadata.tagsHint': '用逗号分隔',
      'action.refresh': '刷新',
      'action.retry': '重试',
      'action.cancel': '取消',
      'action.save': '保存',
      'action.edit': '编辑',
      'action.back': '返回列表',
      'search.products': '搜索名称、简介或分类',
      'search.documents': '搜索标题、标签或正文',
      'state.loading': '正在读取资料库…',
      'state.failed': '资料库暂时不可用。',
      'state.emptyProducts': '你的第一个产品，从这里开始',
      'state.emptyProductsHint': '保存后可以关联企业资料，并让 Agent 通过工具读取。',
      'state.noProductMatch': '没有找到相关产品',
      'state.noProductMatchHint': '试试其他关键词。',
      'state.emptyDocuments': '还没有企业资料',
      'state.emptyDocumentsHint': '先上传营业执照、资质或产品规格，再关联到产品。',
      'state.noDocumentMatch': '没有找到相关资料',
      'state.selectProduct': '选择一个产品查看详情',
      'state.selectProductHint': '资料齐备度、SKU、供货条件与关联资料都在这里。',
      'state.selectDocument': '选择一份资料查看版本与审核',
      'state.selectDocumentHint': '每一版都有独立的 SHA-256 与审核记录。',
      'count.products': '个产品',
      'count.documents': '份资料',
      'product.status.draft': '草稿',
      'product.tag.draft': '产品草稿',
      'product.status.archived': '已归档',
      'product.revision': '修订',
      'product.updated': '更新于',
      'product.facts': '产品信息',
      'product.category': '产品分类',
      'product.description': '产品简介',
      'product.name': '产品名称',
      'product.status': '状态',
      'product.emptyDescription': '尚未填写产品简介',
      'product.emptyCategory': '未分类',
      'sku.title': 'SKU 与规格',
      'sku.empty': '还没有添加 SKU。',
      'sku.add': '添加 SKU',
      'sku.remove': '移除 SKU',
      'sku.code': 'SKU 编码',
      'sku.unit': '计量单位',
      'sku.unitHint': '例如：件、套、千克',
      'sku.moq': '最小起订量（MOQ）',
      'sku.lead': '交期（天）',
      'sku.pricing': '报价方式',
      'sku.pricing.unset': '未填写',
      'sku.pricing.tiered': '阶梯报价',
      'sku.pricing.on_request': '按需询价',
      'sku.pricing.note': '报价说明',
      'sku.tier.add': '添加价格档',
      'sku.tier.min': '起订量',
      'sku.tier.price': '单价',
      'sku.tier.currency': '币种',
      'sku.spec.add': '添加规格项',
      'sku.spec.key': '规格名称',
      'sku.spec.value': '规格值',
      'sku.spec.remove': '移除',
      'supply.title': '供货条件',
      'supply.empty': '待补充',
      'documents.title': '关联企业资料',
      'documents.hint': '关联到确切版本；企业资料的新版本不会自动替换这里。',
      'documents.empty': '还没有关联任何企业资料。',
      'documents.pick': '选择企业资料',
      'documents.version': '固定版本',
      'documents.versionCurrent': '当前版本',
      'documents.versionHistory': '历史版本',
      'documents.purpose': '关联用途',
      'documents.add': '添加关联',
      'documents.remove': '移除此关联',
      'documents.choose': '请选择',
      'readiness.title': '发布准备检查',
      'readiness.hint': '只检查已保存资料的完整性、有效期和人工审核记录；这不是认证。',
      'readiness.incomplete': '资料待补齐',
      'readiness.needs_review': '需要审核',
      'readiness.ready_for_review': '已完成当前检查',
      'readiness.loading': '正在检查…',
      'check.missing': '缺失',
      'check.invalid': '无效',
      'check.expired': '已过期',
      'check.unverified': '待核实',
      'check.verified': '已核实',
      'company.title': '企业档案',
      'company.base': '企业基础档案',
      'company.subtitle': '把企业档案与支持文件放在一起，按版本留存。',
      'company.legalName': '企业全称',
      'company.displayName': '展示名称',
      'company.description': '企业简介',
      'company.edit': '编辑企业档案',
      'company.empty': '还没有填写企业档案',
      'company.emptyHint': '企业名称会出现在产品详情和 Agent 的读取结果里。',
      'company.files': '企业文件',
      'document.slot.all': '全部资料',
      'document.current': '当前 v{version}',
      'document.versions': '版本历史',
      'document.reviews': '审核记录',
      'document.noReviews': '还没有审核记录。',
      'document.review': '人工审核',
      'document.review.hint': '审核记录绑定这一版的 SHA-256；新增版本后需要重新审核。',
      'document.verify': '通过',
      'document.reject': '驳回',
      'document.review.note': '审核备注（可选）',
      'document.review.reviewedBy': '审核人',
      'document.review.unreviewed': '未审核',
      'document.review.verified': '已核实',
      'document.review.rejected': '已驳回',
      'document.status.active': '使用中',
      'document.status.archived': '已归档',
      'document.archive': '归档资料',
      'document.restore': '恢复资料',
      'document.addVersion': '添加新版本',
      'document.fileName': '文件名',
      'document.bytes': '大小',
      'document.sha': 'SHA-256',
      'document.createdAt': '创建时间',
      'document.preview': '查看正文',
      'document.hidePreview': '收起正文',
      'document.title': '文档标题',
      'document.slot': '资料类别',
      'document.tags': '标签',
      'document.tagsHint': '用逗号分隔',
      'document.content': '资料正文',
      'document.certificate': '证书与有效期',
      'cert.number': '证书编号',
      'cert.issuer': '签发机构',
      'cert.scope': '范围',
      'cert.validFrom': '生效日期',
      'cert.validUntil': '失效日期',
      'cert.expiryMode': '有效期类型',
      'cert.expiryNote': '有效期说明',
      'cert.unknown': '未知',
      'cert.dated': '有固定期限',
      'cert.no_expiry': '无固定期限',
      'cert.hint': '填写不代表已通过审核；审核是单独的人工动作。',
      'editor.newProduct': '新建产品',
      'editor.editProduct': '编辑产品',
      'editor.saveProduct': '保存产品',
      'editor.saving': '正在保存…',
      'editor.newDocument': '上传企业资料',
      'editor.newVersion': '添加新版本',
      'editor.saveDocument': '保存资料',
      'editor.saveVersion': '保存新版本',
      'editor.versionHint': '新版本会成为当前版本；已关联旧版本的产品保持原版本。',
      'editor.required': '必填',
      'editor.conflict': '这项内容已被其他窗口修改，请刷新后重试。',
      'editor.reload': '重新读取',
      'error.generic': '操作没有完成。',
    };
    const en = {
      'panel': 'Library',
      'reference.group': 'Enterprise documents · pinned versions',
      'reference.insert': 'Reference document',
      'reference.hint': 'Choose an exact TXT, Markdown, CSV or JSON version',
      'eyebrow': 'The knowledge behind the business',
      'title': 'Library',
      'subtitle': 'Every record is one more step ready for what comes next.',
      'tab.products': 'Products',
      'tab.company': 'Enterprise',
      'action.newProduct': 'New product',
      'action.newDocument': 'Add document',
      'notice.saved': 'Saved.',
      'file.choose': 'Choose file',
      'file.none': 'No file selected.',
      'file.tooLarge': 'Files must stay under {size} MiB.',
      'editor.modeFile': 'Upload file',
      'editor.modeText': 'Text note',
      'editor.attachHint': 'Bytes are stored verbatim and the version records their SHA-256.',
      'editor.uploading': 'Uploading…',
      'image.title': 'Product images',
      'image.add': 'Upload image',
      'image.empty': 'No product image yet.',
      'image.alt': 'Image description',
      'image.primary': 'Primary',
      'image.setPrimary': 'Set primary',
      'image.up': 'Move up',
      'image.down': 'Move down',
      'image.remove': 'Remove image',
      'image.hint': 'PNG, JPEG, WebP or GIF; at most 12 MiB each.',
      'image.saveFirst': 'Save the product once, then upload images.',
      'document.editInfo': 'Edit document info',
      'document.file': 'File',
      'document.text': 'Text',
      'document.openFile': 'Open',
      'document.download': 'Download',
      'document.textOnly': 'Text-only version, no file',
      'document.fileUnavailable': 'File is unreadable',
      'metadata.title': 'Document info',
      'metadata.tagsHint': 'Comma separated',
      'action.refresh': 'Refresh',
      'action.retry': 'Retry',
      'action.cancel': 'Cancel',
      'action.save': 'Save',
      'action.edit': 'Edit',
      'action.back': 'Back to list',
      'search.products': 'Search name, summary or category',
      'search.documents': 'Search title, tags or text',
      'state.loading': 'Reading the library…',
      'state.failed': 'The library is unavailable.',
      'state.emptyProducts': 'Start with your first product',
      'state.emptyProductsHint': 'After saving you can pin enterprise documents and let the agent read it.',
      'state.noProductMatch': 'No matching products',
      'state.noProductMatchHint': 'Try another keyword.',
      'state.emptyDocuments': 'No enterprise documents yet',
      'state.emptyDocumentsHint': 'Add a license, certificate or specification, then pin it to a product.',
      'state.noDocumentMatch': 'No matching documents',
      'state.selectProduct': 'Select a product to see details',
      'state.selectProductHint': 'Readiness, SKUs, supply terms and pinned documents live here.',
      'state.selectDocument': 'Select a document to see versions and reviews',
      'state.selectDocumentHint': 'Every version carries its own SHA-256 and review history.',
      'count.products': 'products',
      'count.documents': 'documents',
      'product.status.draft': 'Draft',
      'product.tag.draft': 'Product draft',
      'product.status.archived': 'Archived',
      'product.revision': 'Revision',
      'product.updated': 'Updated',
      'product.facts': 'Product facts',
      'product.category': 'Category',
      'product.description': 'Summary',
      'product.name': 'Name',
      'product.status': 'Status',
      'product.emptyDescription': 'No summary yet',
      'product.emptyCategory': 'Uncategorised',
      'sku.title': 'SKUs and specifications',
      'sku.empty': 'No SKU added yet.',
      'sku.add': 'Add SKU',
      'sku.remove': 'Remove SKU',
      'sku.code': 'SKU code',
      'sku.unit': 'Unit',
      'sku.unitHint': 'e.g. piece, set, kg',
      'sku.moq': 'Minimum order quantity',
      'sku.lead': 'Lead time (days)',
      'sku.pricing': 'Pricing',
      'sku.pricing.unset': 'Not set',
      'sku.pricing.tiered': 'Tiered',
      'sku.pricing.on_request': 'On request',
      'sku.pricing.note': 'Pricing note',
      'sku.tier.add': 'Add price tier',
      'sku.tier.min': 'From quantity',
      'sku.tier.price': 'Unit price',
      'sku.tier.currency': 'Currency',
      'sku.spec.add': 'Add specification',
      'sku.spec.key': 'Name',
      'sku.spec.value': 'Value',
      'sku.spec.remove': 'Remove',
      'supply.title': 'Supply terms',
      'supply.empty': 'Not set',
      'documents.title': 'Pinned enterprise documents',
      'documents.hint': 'Pins an exact version; newer versions never replace it automatically.',
      'documents.empty': 'No enterprise document pinned yet.',
      'documents.pick': 'Select a document',
      'documents.version': 'Pinned version',
      'documents.versionCurrent': 'current',
      'documents.versionHistory': 'history',
      'documents.purpose': 'Purpose',
      'documents.add': 'Pin document',
      'documents.remove': 'Unpin',
      'documents.choose': 'Choose',
      'readiness.title': 'Publish readiness',
      'readiness.hint': 'Checks completeness, validity and human reviews of saved data only; this is not a certification.',
      'readiness.incomplete': 'Needs data',
      'readiness.needs_review': 'Needs review',
      'readiness.ready_for_review': 'Current checks pass',
      'readiness.loading': 'Checking…',
      'check.missing': 'Missing',
      'check.invalid': 'Invalid',
      'check.expired': 'Expired',
      'check.unverified': 'Unverified',
      'check.verified': 'Verified',
      'company.title': 'Enterprise profile',
      'company.base': 'Enterprise basics',
      'company.subtitle': 'Keep the enterprise profile and its supporting documents together, by version.',
      'company.legalName': 'Legal name',
      'company.displayName': 'Display name',
      'company.description': 'About',
      'company.edit': 'Edit profile',
      'company.empty': 'The enterprise profile is empty',
      'company.emptyHint': 'The name appears in product details and in what the agent reads.',
      'company.files': 'Enterprise documents',
      'document.slot.all': 'All documents',
      'document.current': 'Current v{version}',
      'document.versions': 'Version history',
      'document.reviews': 'Review history',
      'document.noReviews': 'No review yet.',
      'document.review': 'Human review',
      'document.review.hint': 'A review is bound to this version\'s SHA-256; a new version needs a new review.',
      'document.verify': 'Verify',
      'document.reject': 'Reject',
      'document.review.note': 'Review note (optional)',
      'document.review.reviewedBy': 'Reviewer',
      'document.review.unreviewed': 'Unreviewed',
      'document.review.verified': 'Verified',
      'document.review.rejected': 'Rejected',
      'document.status.active': 'Active',
      'document.status.archived': 'Archived',
      'document.archive': 'Archive document',
      'document.restore': 'Restore document',
      'document.addVersion': 'Add version',
      'document.fileName': 'File name',
      'document.bytes': 'Size',
      'document.sha': 'SHA-256',
      'document.createdAt': 'Created',
      'document.preview': 'Show text',
      'document.hidePreview': 'Hide text',
      'document.title': 'Title',
      'document.slot': 'Category',
      'document.tags': 'Tags',
      'document.tagsHint': 'Comma separated',
      'document.content': 'Document text',
      'document.certificate': 'Certificate and validity',
      'cert.number': 'Certificate number',
      'cert.issuer': 'Issuer',
      'cert.scope': 'Scope',
      'cert.validFrom': 'Valid from',
      'cert.validUntil': 'Valid until',
      'cert.expiryMode': 'Validity type',
      'cert.expiryNote': 'Validity note',
      'cert.unknown': 'Unknown',
      'cert.dated': 'Fixed period',
      'cert.no_expiry': 'No expiry',
      'cert.hint': 'Recording validity is not a review; verification is a separate human action.',
      'editor.newProduct': 'New product',
      'editor.editProduct': 'Edit product',
      'editor.saveProduct': 'Save product',
      'editor.saving': 'Saving…',
      'editor.newDocument': 'Add enterprise document',
      'editor.newVersion': 'Add version',
      'editor.saveDocument': 'Save document',
      'editor.saveVersion': 'Save version',
      'editor.versionHint': 'The new version becomes current; products pinned to the old version keep it.',
      'editor.required': 'required',
      'editor.conflict': 'This item changed elsewhere. Reload before saving again.',
      'editor.reload': 'Reload',
      'error.generic': 'The operation did not complete.',
    };

    const styles = `
.wl-page{height:100%;min-height:0;overflow:auto;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font-size:13px;line-height:1.6;--wl-accent:#1479f6;--wl-accent-ink:#fff}
.wl-content{width:min(768px,calc(100% - 100px));margin:42px auto 70px;box-sizing:border-box}
.wl-library-title{margin:0 0 28px}
.wl-eyebrow{display:block;font-size:10px;font-weight:500;letter-spacing:1.2px;color:var(--dsw-alias-label-secondary);margin:0 0 11px}
.wl-title{font-size:25px;line-height:1.4;font-weight:600;letter-spacing:-.2px;margin:0 0 13px}
.wl-subtitle{font-size:13px;line-height:1.8;color:var(--dsw-alias-label-secondary);margin:0;max-width:510px}
.wl-tabs{display:flex;gap:25px;border-bottom:1px solid var(--dsw-alias-border-l2);margin:0 0 32px;overflow:auto}
.wl-tab{appearance:none;background:none;border:0;cursor:pointer;white-space:nowrap;padding:12px 0 15px;color:var(--dsw-alias-label-secondary);font:inherit;font-size:14px;border-bottom:2px solid transparent}
.wl-tab:hover{color:var(--dsw-alias-label-primary)}
.wl-tab[aria-selected="true"]{color:var(--dsw-alias-label-primary);border-bottom-color:var(--dsw-alias-label-primary)}
.wl-tab:focus-visible,.wl-row:focus-visible,.wl-back:focus-visible,.wl-btn:not(.rt-Button):focus-visible,.wl-chip:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:3px}
.wl-heading{display:flex;align-items:flex-start;justify-content:space-between;gap:20px;margin:0 0 25px}
.wl-heading h2{font-size:24px;font-weight:550;line-height:1.4;margin:0 0 8px;overflow-wrap:anywhere}
.wl-heading p{font-size:13px;line-height:1.8;color:var(--dsw-alias-label-secondary);max-width:510px;margin:0}
.wl-count{font-size:12px;color:var(--dsw-alias-label-secondary);padding-top:9px;display:block}
.wl-toolbar{display:flex;gap:12px;margin:0 0 20px}
.wl-search{flex:1;display:flex;align-items:center;gap:9px;padding:12px 14px;border-radius:14px;background:var(--dsw-alias-bg-layer-2);min-width:0;color:var(--dsw-alias-label-secondary);cursor:text}
.wl-search input{width:100%;min-width:0;border:0;background:none;font:inherit;font-size:13px;color:var(--dsw-alias-label-primary);outline:none}
.wl-search input::placeholder{color:var(--dsw-alias-label-secondary)}
.wl-list{border-top:1px solid var(--dsw-alias-border-l2)}
.wl-row{width:100%;display:flex;align-items:center;justify-content:space-between;gap:16px;padding:18px 3px;border:0;border-bottom:1px solid var(--dsw-alias-border-l2);background:none;border-radius:0;text-align:left;color:inherit;font:inherit;cursor:pointer}
.wl-row:hover{background:color-mix(in srgb,var(--dsw-alias-bg-layer-2) 55%,transparent)}
.wl-row > span{min-width:0}
.wl-row.with-thumb{display:grid;grid-template-columns:54px minmax(0,1fr) 18px;align-items:center}
.wl-row-body{display:flex;flex-direction:column;gap:0;min-width:0;flex:1}
.wl-row-main{display:flex;align-items:center;justify-content:space-between;gap:10px;min-width:0}
.wl-row-title{display:block;font-size:16px;font-weight:550;line-height:1.5;overflow-wrap:anywhere}
.wl-row-snippet{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;color:var(--dsw-alias-label-secondary);font-size:13px;line-height:1.7;margin-top:6px;white-space:pre-wrap;overflow-wrap:anywhere}
.wl-row-meta{display:flex;align-items:center;gap:6px;flex-wrap:wrap;color:var(--dsw-alias-label-secondary);font-size:11px;margin-top:9px}
.wl-row-chevron{color:var(--dsw-alias-label-secondary);display:flex;justify-content:center}
.wl-row-thumb{width:54px;height:64px;border-radius:12px;overflow:hidden;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary);display:flex;align-items:center;justify-content:center;flex:none}
.wl-row-thumb img{width:100%;height:100%;object-fit:cover}
.wl-row-thumb.empty{border:1px dashed var(--dsw-alias-border-l2);background:none}
.wl-tag{display:inline-flex;align-items:center;gap:5px;padding:4px 9px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary);font-size:11px;border-radius:8px;white-space:nowrap}
.wl-tag.ok{color:var(--dsw-alias-state-success-primary);background:color-mix(in srgb,var(--dsw-alias-state-success-primary) 12%,transparent)}
.wl-tag.warn{color:var(--dsw-alias-state-warn-primary);background:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 12%,transparent)}
.wl-tag.bad{color:var(--dsw-alias-state-error-primary);background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 12%,transparent)}
.wl-tag.idle{color:var(--dsw-alias-state-idle-primary)}
.wl-tag.dot::before{content:"";width:5px;height:5px;border-radius:50%;background:currentColor;flex:none}
.wl-back{display:inline-flex;align-items:center;gap:8px;min-height:44px;font-size:13px;color:var(--dsw-alias-label-secondary);margin:0 0 15px;background:none;border:0;padding:0;cursor:pointer;font:inherit}
.wl-back:hover{color:var(--dsw-alias-label-primary)}
.wl-detail-head{display:flex;align-items:flex-start;justify-content:space-between;gap:20px;margin:0 0 22px;flex-wrap:wrap}
.wl-detail-title{font-size:24px;font-weight:550;line-height:1.45;letter-spacing:-.2px;margin:0 0 8px;overflow-wrap:anywhere}
.wl-detail-sub{font-size:12px;line-height:1.8;color:var(--dsw-alias-label-secondary);margin:0}
.wl-detail-actions{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
.wl-description{font-size:15px;line-height:1.9;white-space:pre-wrap;overflow-wrap:anywhere;color:var(--dsw-alias-label-secondary);margin:18px 0 0}
.wl-prose{white-space:pre-wrap;word-break:break-word;font-size:13px;line-height:1.8}
.wl-section{border-top:1px solid var(--dsw-alias-border-l2);padding:27px 0;margin-top:25px}
.wl-section:first-of-type{border-top:0;padding-top:0;margin-top:0}
.wl-section h3{font-size:17px;font-weight:550;margin:0 0 12px}
.wl-section h4{font-size:13px;font-weight:500;margin:18px 0 12px}
.wl-card:not(.rt-Card){border-top:1px solid var(--dsw-alias-border-l2);padding:27px 0;margin-top:25px}
.wl-card:not(.rt-Card):first-of-type{border-top:0;padding-top:0;margin-top:0}
.wl-card-head{display:flex;align-items:center;justify-content:space-between;gap:12px;margin:0 0 12px}
.wl-card-head h3{margin:0;font-size:17px;font-weight:550}
.wl-card:not(.rt-Card) h4{font-size:13px;font-weight:500;margin:18px 0 12px}
.wl-subheading{display:flex;align-items:center;justify-content:space-between;gap:15px;margin:0 0 16px}
.wl-subheading h3{margin:0}
.wl-help{margin:8px 0;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:1.8;overflow-wrap:anywhere}
.wl-help button{font-size:12px}
.wl-facts{display:grid;grid-template-columns:95px minmax(0,1fr);gap:12px 15px;font-size:13px;line-height:1.8;margin:18px 0;padding:0}
.wl-facts dt{color:var(--dsw-alias-label-secondary);margin:0}
.wl-facts dd{margin:0;white-space:pre-wrap;overflow-wrap:anywhere}
.wl-checks{list-style:none;padding:0;margin:0}
.wl-checks li{display:flex;gap:12px;padding:13px 0;border-bottom:1px solid var(--dsw-alias-border-l2);align-items:flex-start}
.wl-checks li:last-child{border-bottom:0}
.wl-check-status{font-size:11px;white-space:nowrap;padding:4px 8px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary);border-radius:8px;flex:none}
.wl-check-status.verified{color:var(--dsw-alias-state-success-primary);background:color-mix(in srgb,var(--dsw-alias-state-success-primary) 12%,transparent)}
.wl-check-status.unverified{color:var(--dsw-alias-state-warn-primary);background:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 12%,transparent)}
.wl-check-status.missing,.wl-check-status.invalid,.wl-check-status.expired{color:var(--dsw-alias-state-error-primary);background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 12%,transparent)}
.wl-check-body{min-width:0;display:flex;flex-direction:column;gap:4px}
.wl-check-body strong{font-size:13px;font-weight:500}
.wl-check-body p{margin:0;font-size:12px;line-height:1.7;color:var(--dsw-alias-label-secondary)}
.wl-btn:not(.rt-Button){appearance:none;min-height:39px;display:inline-flex;align-items:center;justify-content:center;gap:8px;border:0;border-radius:23px;padding:10px 20px;font:inherit;font-size:13px;line-height:1.4;font-weight:500;white-space:nowrap;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary);cursor:pointer}
.wl-btn:not(.rt-Button):hover{background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary)}
.wl-btn:not(.rt-Button)[disabled]{opacity:.5;cursor:default}
.wl-btn:not(.rt-Button).primary{background:var(--wl-accent);color:var(--wl-accent-ink)}
.wl-btn:not(.rt-Button).primary:hover{filter:brightness(1.06)}
.wl-btn:not(.rt-Button).danger{background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 12%,transparent);color:var(--dsw-alias-state-error-primary)}
.wl-btn:not(.rt-Button).ghost{background:none;color:var(--dsw-alias-label-secondary);padding-left:6px;padding-right:6px}
.wl-btn:not(.rt-Button).small{min-height:30px;padding:5px 12px;font-size:12px}
.wl-detail-action{display:flex;justify-content:flex-end;padding:20px 0;margin-top:20px;border-top:1px solid var(--dsw-alias-border-l2)}
.wl-detail-action .wl-btn:not(.rt-Button).primary{min-width:140px}
.wl-empty{padding:60px 10px;text-align:center;color:var(--dsw-alias-label-secondary)}
.wl-empty strong{display:block;font-size:19px;font-weight:500;color:var(--dsw-alias-label-primary);margin:0 0 12px}
.wl-empty p{font-size:13px;line-height:1.8;margin:0 auto;max-width:42ch}
.wl-empty-mark{display:none}
.wl-loading{padding:40px 0;color:var(--dsw-alias-label-secondary);font-size:13px}
.wl-error{margin:14px 0;padding:12px 15px;border-radius:11px;background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 10%,transparent);color:var(--dsw-alias-state-error-primary);font-size:13px;line-height:1.8;overflow-wrap:anywhere}
.wl-notice{margin:0 0 18px;padding:10px 14px;border-radius:11px;background:color-mix(in srgb,var(--dsw-alias-state-success-primary) 10%,transparent);color:var(--dsw-alias-state-success-primary);font-size:12px}
.wl-form{display:flex;flex-direction:column;gap:0}
.wl-editor{max-width:780px}
.wl-field{display:flex;flex-direction:column;gap:9px;font-size:13px;color:var(--dsw-alias-label-secondary);margin:0 0 23px}
.wl-field > label{font-size:13px;color:var(--dsw-alias-label-secondary)}
.wl-field input:not(.rt-TextFieldInput),.wl-field select,.wl-field textarea:not(.rt-TextAreaInput){width:100%;min-width:0;box-sizing:border-box;background:var(--dsw-alias-bg-base);border:1px solid var(--dsw-alias-border-l2);border-radius:11px;padding:12px;font:14px/1.6 inherit;color:var(--dsw-alias-label-primary)}
.wl-field textarea:not(.rt-TextAreaInput){resize:vertical;line-height:1.7}
.wl-field input:not(.rt-TextFieldInput):focus-visible,.wl-field select:focus-visible,.wl-field textarea:not(.rt-TextAreaInput):focus-visible{outline:none;border-color:var(--dsw-alias-brand-primary);box-shadow:0 0 0 3px color-mix(in srgb,var(--dsw-alias-brand-primary) 16%,transparent)}
.wl-field-row{display:grid;grid-template-columns:1fr 1fr;gap:20px}
.wl-inline{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.wl-form-actions{display:flex;justify-content:flex-end;align-items:center;gap:12px;padding:20px 0 0;margin-top:15px;border-top:1px solid var(--dsw-alias-border-l2)}
.wl-group{border-bottom:1px solid var(--dsw-alias-border-l2);padding:0 0 20px;margin:18px 0}
.wl-group:last-child{border-bottom:0}
.wl-group > summary{font-size:15px;font-weight:500;cursor:pointer;min-height:48px;padding:13px 0;line-height:1.7;overflow-wrap:anywhere;list-style:none}
.wl-group > summary::-webkit-details-marker{display:none}
.wl-group > summary::before{content:"›";display:inline-block;width:17px;color:var(--dsw-alias-label-secondary);transition:transform .15s}
.wl-group[open] > summary::before{transform:rotate(90deg)}
.wl-group > summary small{display:block;font-size:12px;color:var(--dsw-alias-label-secondary);font-weight:400;padding-left:17px;margin-top:2px}
.wl-group[open] > summary{margin-bottom:18px}
.wl-group .wl-field{margin-bottom:20px}
.wl-sku{border-top:1px solid var(--dsw-alias-border-l2);padding:18px 0;margin:12px 0;min-width:0}
.wl-sku:first-of-type{border-top:0;padding-top:4px}
.wl-sku-head{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:14px}
.wl-sku-head strong{font-size:14px;font-weight:500;overflow-wrap:anywhere}
.wl-spec-row{display:grid;grid-template-columns:minmax(90px,1fr) minmax(110px,1.4fr) auto;gap:6px;margin-top:6px;align-items:center}
.wl-tier-row{display:grid;grid-template-columns:minmax(70px,1fr) minmax(80px,1fr) 64px auto;gap:6px;margin-top:6px;align-items:center}
.wl-spec-row input,.wl-tier-row input{width:100%;min-width:0;box-sizing:border-box;background:var(--dsw-alias-bg-base);border:1px solid var(--dsw-alias-border-l2);border-radius:8px;padding:8px 9px;font:12px/1.5 inherit;color:var(--dsw-alias-label-primary)}
.wl-image-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(170px,1fr));gap:14px;margin-top:16px}
.wl-image-card{border:1px solid var(--dsw-alias-border-l2);border-radius:12px;padding:10px;background:var(--dsw-alias-bg-base);display:flex;flex-direction:column;gap:8px;min-width:0}
.wl-image-thumb{height:100px;border-radius:8px;overflow:hidden;background:var(--dsw-alias-bg-layer-2);display:flex;align-items:center;justify-content:center;color:var(--dsw-alias-label-secondary);font-size:11px;text-align:center;word-break:break-all;padding:6px}
.wl-image-thumb img{width:100%;height:100%;object-fit:cover}
.wl-image-card input{width:100%;box-sizing:border-box;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;padding:7px 9px}
.wl-image-actions{display:flex;gap:6px;flex-wrap:wrap}
.wl-gallery{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:12px;margin:20px 0 4px}
.wl-image{margin:0;border:1px solid var(--dsw-alias-border-l2);border-radius:14px;overflow:hidden;background:var(--dsw-alias-bg-layer-2)}
.wl-image img{display:block;width:100%;height:130px;object-fit:cover}
.wl-image-fallback{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;height:130px;color:var(--dsw-alias-label-secondary);font-size:11px;padding:8px;text-align:center;word-break:break-all}
.wl-image figcaption{padding:6px 10px;font-size:10px;color:var(--dsw-alias-label-secondary);border-top:1px solid var(--dsw-alias-border-l2)}
.wl-image-empty{display:flex;align-items:center;justify-content:center;gap:11px;min-height:86px;border-radius:15px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary);margin:18px 0 20px}
.wl-image-empty p{font-size:12px;margin:0}
.wl-seg{display:inline-flex;border:1px solid var(--dsw-alias-border-l2);border-radius:23px;overflow:hidden;margin:0 0 20px;align-self:flex-start;padding:3px;background:var(--dsw-alias-bg-layer-2)}
.wl-seg-btn{appearance:none;border:0;background:none;color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;padding:7px 16px;cursor:pointer;border-radius:20px}
.wl-seg-btn[aria-pressed="true"]{background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font-weight:500;box-shadow:0 1px 3px rgba(0,0,0,.06)}
.wl-thumb{display:block;max-width:100%;max-height:420px;object-fit:contain;border-radius:12px;border:1px solid var(--dsw-alias-border-l2);margin:16px 0;background:var(--dsw-alias-bg-base)}
.wl-frame{display:block;width:100%;height:480px;margin:16px 0;border:1px solid var(--dsw-alias-border-l2);border-radius:12px;background:var(--dsw-alias-bg-base)}
.wl-pre{margin:16px 0;padding:17px;border-radius:12px;background:var(--dsw-alias-bg-layer-2);white-space:pre-wrap;overflow-wrap:anywhere;font:12px/1.8 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;max-height:380px;overflow:auto;color:var(--dsw-alias-label-primary)}
.wl-version{border-top:1px solid var(--dsw-alias-border-l2);padding:16px 0 2px;margin-top:16px}
.wl-version:first-of-type{border-top:0;margin-top:4px;padding-top:2px}
.wl-version-head{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.wl-version-head strong{font-size:14px;font-weight:500}
.wl-version-meta{color:var(--dsw-alias-label-secondary);font-size:11px;margin-top:5px;display:flex;gap:10px;flex-wrap:wrap}
.wl-sha{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:11px;color:var(--dsw-alias-label-secondary);word-break:break-all}
.wl-review{border-top:1px solid var(--dsw-alias-border-l2);padding:12px 0 0;margin-top:12px}
.wl-review:first-child{border-top:0;margin-top:0;padding-top:0}
.wl-review-head{display:flex;align-items:center;gap:8px;flex-wrap:wrap;font-size:12px}
.wl-review-note{margin:6px 0 0;color:var(--dsw-alias-label-secondary);white-space:pre-wrap;font-size:12px;line-height:1.7}
.wl-chipbar{display:flex;gap:8px;flex-wrap:wrap;margin:18px 0}
.wl-chip{appearance:none;border:0;background:none;color:var(--dsw-alias-label-secondary);border-radius:9px;font:inherit;font-size:12px;padding:7px 10px;cursor:pointer}
.wl-chip:hover,.wl-chip[aria-pressed="true"]{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}
.wl-company{padding:0}
.wl-company-name{font-size:18px;font-weight:550;margin:0 0 6px}
.wl-company-name.empty{color:var(--dsw-alias-label-secondary);font-weight:500}
.wl-divider{height:1px;background:var(--dsw-alias-border-l2);margin:18px 0}
.wl-split{display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end}
.wl-split > *{flex:1;min-width:120px}
@media(max-width:820px){.wl-content{width:calc(100% - 64px);margin-top:35px}.wl-tabs{gap:23px}.wl-heading h2{font-size:22px}}
@media(max-width:600px){.wl-content{width:calc(100% - 44px);margin:29px auto 45px}.wl-title{font-size:24px}.wl-tabs{gap:23px;margin-bottom:26px}.wl-tabs .wl-tab{font-size:13px}.wl-heading{gap:13px;flex-wrap:wrap;margin-bottom:20px}.wl-heading .wl-btn:not(.rt-Button){padding:8px 14px;font-size:12px}.wl-heading h2{font-size:21px}.wl-heading p{font-size:12px}.wl-toolbar{gap:8px}.wl-search{padding:11px}.wl-search input{font-size:16px}.wl-row{padding:16px 0;gap:12px}.wl-row.with-thumb{grid-template-columns:46px minmax(0,1fr) 14px}.wl-row-thumb{width:46px;height:56px;border-radius:10px}.wl-row-title{font-size:15px}.wl-row-snippet{font-size:12px;-webkit-line-clamp:1}.wl-row-meta{font-size:10px}.wl-detail-title{font-size:22px}.wl-description{font-size:14px}.wl-section{padding:22px 0;margin-top:20px}.wl-card:not(.rt-Card){padding:22px 0;margin-top:20px}.wl-field input:not(.rt-TextFieldInput),.wl-field select,.wl-field textarea:not(.rt-TextAreaInput){font-size:16px}.wl-field-row{grid-template-columns:1fr;gap:0}.wl-facts{grid-template-columns:78px minmax(0,1fr);gap:10px;font-size:13px}.wl-detail-action{position:sticky;bottom:0;padding:12px 0 13px;background:var(--dsw-alias-bg-base);box-shadow:0 -10px 16px color-mix(in srgb,var(--dsw-alias-bg-base) 85%,transparent);z-index:2}.wl-detail-action .wl-btn:not(.rt-Button){width:100%}.wl-form-actions{position:sticky;bottom:0;background:var(--dsw-alias-bg-base);padding:12px 0 13px}.wl-form-actions .wl-btn:not(.rt-Button).primary{flex:1}.wl-gallery{grid-template-columns:repeat(auto-fill,minmax(120px,1fr))}.wl-frame{height:380px}}
`;

    // ---------------------------------------------------------------------
    // Transport

    function queryString(params) {
      const entries = Object.entries(params).filter(([, value]) => value !== undefined && value !== null && value !== '');
      if (!entries.length) return '';
      return `?${new URLSearchParams(Object.fromEntries(entries.map(([key, value]) => [key, String(value)]))).toString()}`;
    }

    async function request(pathname, init = {}) {
      const { body, ...rest } = init;
      const response = await fetch(`${API}${pathname}`, {
        credentials: 'same-origin',
        cache: 'no-store',
        ...rest,
        headers: {
          accept: 'application/json',
          ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        },
        body,
      });
      let payload = null;
      try {
        payload = await response.json();
      } catch {
        payload = null;
      }
      if (!response.ok || !payload || payload.ok !== true) {
        const error = new Error(
          response.status === 401
            ? '资料库需要已登录的 Harness 页面。请在 Harness 窗口中打开页面后重试。'
            : payload?.error?.message || `HTTP ${response.status}`,
        );
        error.code = payload?.error?.code || `HTTP_${response.status}`;
        error.status = response.status;
        throw error;
      }
      return payload.data;
    }

    const api = {
      status: () => request('/state'),
      company: () => request('/company'),
      saveCompany: body => request('/company', { method: 'PATCH', body: JSON.stringify(body) }),
      products: params => request(`/products${queryString(params || {})}`),
      product: id => request(`/products/${encodeURIComponent(id)}`),
      createProduct: changes => request('/products', { method: 'POST', body: JSON.stringify(changes) }),
      updateProduct: (id, body) => request(`/products/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(body) }),
      documents: params => request(`/documents${queryString(params || {})}`),
      document: id => request(`/documents/${encodeURIComponent(id)}`),
      createDocument: body => request('/documents', { method: 'POST', body: JSON.stringify(body) }),
      updateDocument: (id, body) => request(`/documents/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(body) }),
      addVersion: (id, body) => request(`/documents/${encodeURIComponent(id)}/versions`, { method: 'POST', body: JSON.stringify(body) }),
      review: (id, version, body) => request(`/documents/${encodeURIComponent(id)}/versions/${version}/reviews`, { method: 'POST', body: JSON.stringify(body) }),
      addImage: (id, body) => request(`/products/${encodeURIComponent(id)}/images`, { method: 'POST', body: JSON.stringify(body) }),
      updateImage: (id, imageId, body) => request(`/products/${encodeURIComponent(id)}/images/${encodeURIComponent(imageId)}`, { method: 'PATCH', body: JSON.stringify(body) }),
      removeImage: (id, imageId, body) => request(`/products/${encodeURIComponent(id)}/images/${encodeURIComponent(imageId)}/remove`, { method: 'POST', body: JSON.stringify(body) }),
    };

    function fileToBase64(file) {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () => reject(new Error('文件读取失败。'));
        reader.onload = () => {
          const result = typeof reader.result === 'string' ? reader.result : '';
          const comma = result.indexOf(',');
          resolve(comma >= 0 ? result.slice(comma + 1) : '');
        };
        reader.readAsDataURL(file);
      });
    }

    async function fetchStoredBlob(pathname) {
      const response = await fetch(`${API}${pathname}`, {
        credentials: 'same-origin',
        cache: 'no-store',
        headers: { accept: '*/*' },
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response.blob();
    }

    async function openStoredFile(pathname, fileName, download = false) {
      const blob = await fetchStoredBlob(pathname);
      if (typeof URL?.createObjectURL !== 'function') return;
      const url = URL.createObjectURL(blob);
      if (download) {
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = fileName || 'file';
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
      } else {
        window.open(url, '_blank', 'noopener');
      }
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    }

    function useBlobUrl(pathname) {
      const [url, setUrl] = useState('');
      useEffect(() => {
        if (!pathname) return undefined;
        let alive = true;
        let objectUrl = '';
        (async () => {
          try {
            const blob = await fetchStoredBlob(pathname);
            if (!alive || typeof URL?.createObjectURL !== 'function') return;
            objectUrl = URL.createObjectURL(blob);
            setUrl(objectUrl);
          } catch {
            // The tile keeps its text fallback.
          }
        })();
        return () => {
          alive = false;
          if (objectUrl) URL.revokeObjectURL(objectUrl);
        };
      }, [pathname]);
      return url;
    }

    // ---------------------------------------------------------------------
    // Small presentational helpers

    const cx = (...values) => values.filter(Boolean).join(' ');

    function useAsync(loader, deps) {
      const [state, setState] = useState({ phase: 'loading', value: null, error: null });
      const [nonce, setNonce] = useState(0);
      const reload = useCallback(() => setNonce(value => value + 1), []);
      useEffect(() => {
        let alive = true;
        setState(current => ({ ...current, phase: 'loading', error: null }));
        loader()
          .then(value => {
            if (alive) setState({ phase: 'ready', value, error: null });
          })
          .catch(error => {
            if (alive) setState({ phase: 'error', value: null, error });
          });
        return () => {
          alive = false;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [...deps, nonce]);
      return { ...state, reload };
    }

    function formatDate(value) {
      if (!value) return '';
      const date = new Date(value);
      if (Number.isNaN(date.getTime())) return String(value);
      const pad = number => String(number).padStart(2, '0');
      return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
    }

    function formatBytes(value) {
      if (!Number.isFinite(value)) return '';
      if (value < 1024) return `${value} B`;
      if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KiB`;
      return `${(value / 1024 / 1024).toFixed(1)} MiB`;
    }

    function statusTag(status, t) {
      if (status === 'archived') return h('span', { className: 'wl-tag idle' }, t('product.status.archived'));
      return h('span', { className: 'wl-tag' }, t('product.status.draft'));
    }

    function reviewTag(state, t) {
      if (state === 'verified') return h('span', { className: 'wl-tag ok dot' }, t('document.review.verified'));
      if (state === 'rejected') return h('span', { className: 'wl-tag bad dot' }, t('document.review.rejected'));
      return h('span', { className: 'wl-tag warn dot' }, t('document.review.unreviewed'));
    }

    function readinessTag(overall, t) {
      const key = overall === 'ready_for_review' ? 'ok' : overall === 'needs_review' ? 'warn' : 'bad';
      const label = overall === 'ready_for_review' ? t('readiness.ready_for_review') : overall === 'needs_review' ? t('readiness.needs_review') : t('readiness.incomplete');
      return h('span', { className: `wl-tag ${key} dot` }, label);
    }

    function checkLabel(status, t) {
      return t(`check.${status}`);
    }

    function Empty({ title, hint, t }) {
      return h(
        'div',
        { className: 'wl-empty' },
        h('span', { className: 'wl-empty-mark', 'aria-hidden': 'true' }, h(IconBooks, { size: 22 })),
        h('strong', null, title),
        hint ? h('p', null, hint) : null,
      );
    }

    function Loading({ label }) {
      return h('p', { className: 'wl-loading', role: 'status' }, label);
    }

    function ErrorNote({ error, onRetry, t }) {
      if (!error) return null;
      return h(
        'div',
        { className: 'wl-error', role: 'alert' },
        h('div', null, error.message || t('error.generic')),
        onRetry
          ? h('div', { style: { marginTop: '6px' } }, h(LibraryButton, { type: 'button', className: 'wl-btn small', onClick: onRetry }, t('action.retry')))
          : null,
      );
    }

    // ---------------------------------------------------------------------
    // Icons (inline, currentColor, no external assets)

    function IconBooks({ size = 18 }) {
      return h(
        'svg',
        { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': 'true' },
        h('path', { d: 'M4 4.75h3.1v14.5H4z' }),
        h('path', { d: 'M8.9 4.75h3.1v14.5H8.9z' }),
        h('path', { d: 'm13.9 5.9 3-.8 3.4 13.6-3 .8z' }),
      );
    }

    function IconSearch({ size = 14 }) {
      return h(
        'svg',
        { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', 'aria-hidden': 'true' },
        h('circle', { cx: 11, cy: 11, r: 6.2 }),
        h('path', { d: 'm16 16 4 4' }),
      );
    }

    function IconPlus({ size = 14 }) {
      return h(
        'svg',
        { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', 'aria-hidden': 'true' },
        h('path', { d: 'M12 5v14M5 12h14' }),
      );
    }

    function IconImage({ size = 18 }) {
      return h(
        'svg',
        { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': 'true' },
        h('rect', { x: 3.5, y: 4.5, width: 17, height: 15, rx: 2.5 }),
        h('circle', { cx: 9, cy: 10, r: 1.5 }),
        h('path', { d: 'm5 17 4.5-4.5 3 3 2.5-2.5L19 17' }),
      );
    }

    function IconBack({ size = 16 }) {
      return h(
        'svg',
        { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': 'true' },
        h('path', { d: 'm14.5 5-7 7 7 7' }),
      );
    }

    function IconChevron({ size = 18 }) {
      return h(
        'svg',
        { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': 'true' },
        h('path', { d: 'm9.5 5 7 7-7 7' }),
      );
    }

    function LibraryIcon({ size = 18 }) {
      return h(IconBooks, { size });
    }

    // ---------------------------------------------------------------------
    // Panel

    function LibraryPanel(props) {
      const { t } = props;
      const [tab, setTab] = useState('products');
      const [route, setRoute] = useState({ page: 'list' });
      const [query, setQuery] = useState('');
      const [slot, setSlot] = useState('');
      const [snapshot, setSnapshot] = useState(null);
      const [phase, setPhase] = useState('loading');
      const [error, setError] = useState(null);
      const [notice, setNotice] = useState(null);
      const [detailNonce, setDetailNonce] = useState(0);
      const pageRef = useRef(null);

      const load = useCallback(async () => {
        setPhase('loading');
        try {
          const [status, company, products, documents] = await Promise.all([api.status(), api.company(), api.products({ limit: 200 }), api.documents({ limit: 200 })]);
          setSnapshot({ status, company, products, documents });
          setPhase('ready');
          setError(null);
        } catch (cause) {
          setError(cause);
          setPhase('error');
        }
      }, []);

      useEffect(() => {
        void load();
      }, [load]);

      useEffect(() => {
        const navigate = target => {
          if (!target || !['documents', 'products', 'productNew', 'product'].includes(target.page)) return;
          if (target.page === 'product' && typeof target.id !== 'string') return;
          setTab(target.page === 'documents' ? 'company' : 'products');
          setQuery(''); setNotice(null);
          setRoute(['documents', 'products'].includes(target.page) ? { page: 'list' } : { page: target.page, id: target.id });
          window.sessionStorage.removeItem('workspace-library-navigation');
        };
        const receive = event => navigate(event.detail);
        window.addEventListener('workspace-library:navigate', receive);
        try { navigate(JSON.parse(window.sessionStorage.getItem('workspace-library-navigation'))); } catch { /* No pending navigation. */ }
        return () => window.removeEventListener('workspace-library:navigate', receive);
      }, []);

      useEffect(() => {
        const node = pageRef.current;
        if (node) node.scrollTop = 0;
      }, [route, detailNonce]);

      const refreshAfter = useCallback(async () => {
        setDetailNonce(value => value + 1);
        await load();
      }, [load]);

      const products = snapshot?.products.items || [];
      const documents = snapshot?.documents.items || [];
      const company = snapshot?.company || null;

      const filteredProducts = useMemo(() => {
        const needle = query.trim().toLowerCase();
        if (!needle) return products;
        return products.filter(product => [product.name, product.description, product.category].filter(Boolean).join('\n').toLowerCase().includes(needle));
      }, [products, query]);

      const filteredDocuments = useMemo(() => {
        const needle = query.trim().toLowerCase();
        return documents.filter(document => (!slot || document.slotKey === slot) && (!needle || [document.title, ...(document.tags || [])].join('\n').toLowerCase().includes(needle)));
      }, [documents, query, slot]);

      const go = next => {
        setNotice(null);
        setRoute(next);
      };
      const goList = () => go({ page: 'list' });

      function switchTab(next) {
        setTab(next);
        setQuery('');
        setNotice(null);
        setRoute({ page: 'list' });
      }

      const back = (() => {
        switch (route.page) {
          case 'product':
          case 'productNew':
            return { label: t('tab.products'), to: { page: 'list' } };
          case 'productEdit':
            return { label: t('tab.products'), to: route.id ? { page: 'product', id: route.id } : { page: 'list' } };
          case 'document':
          case 'documentNew':
            return { label: t('tab.company'), to: { page: 'list' } };
          case 'documentVersion':
            return { label: t('tab.company'), to: { page: 'document', id: route.id } };
          default:
            return null;
        }
      })();

      let detail = null;
      switch (route.page) {
        case 'product':
          detail = h(ProductDetail, {
            key: `product-${route.id}-${detailNonce}`,
            t,
            id: route.id,
            documents,
            onEdit: product => go({ page: 'productEdit', id: product.id, product }),
          });
          break;
        case 'productNew':
          detail = h(ProductEditor, {
            key: 'product-new',
            t,
            product: null,
            documents,
            onCancel: goList,
            onSaved: async id => {
              await refreshAfter();
              if (id) go({ page: 'product', id });
              else goList();
            },
          });
          break;
        case 'productEdit':
          detail = h(ProductEditor, {
            key: `product-edit-${route.id}-${detailNonce}`,
            t,
            product: route.product || null,
            documents,
            onCancel: () => (route.id ? go({ page: 'product', id: route.id }) : goList()),
            onSaved: async id => {
              await refreshAfter();
              if (id) go({ page: 'product', id });
              else goList();
            },
          });
          break;
        case 'document':
          detail = h(DocumentDetail, {
            key: `document-${route.id}-${detailNonce}`,
            t,
            id: route.id,
            onAddVersion: document => go({ page: 'documentVersion', id: document.id, document }),
            onChanged: refreshAfter,
          });
          break;
        case 'documentNew':
          detail = h(DocumentEditor, {
            key: 'document-new',
            t,
            document: null,
            versionMode: false,
            onCancel: goList,
            onSaved: async id => {
              await refreshAfter();
              if (id) go({ page: 'document', id });
              else goList();
            },
          });
          break;
        case 'documentVersion':
          detail = h(DocumentEditor, {
            key: `document-version-${route.id}-${detailNonce}`,
            t,
            document: route.document || null,
            versionMode: true,
            onCancel: () => go({ page: 'document', id: route.id }),
            onSaved: async id => {
              await refreshAfter();
              if (id) go({ page: 'document', id });
              else goList();
            },
          });
          break;
        default:
          detail = null;
      }

      let listBody = null;
      if (phase === 'loading' && !snapshot) listBody = h(Loading, { label: t('state.loading') });
      else if (phase === 'error' && !snapshot) listBody = h('div', null, h(ErrorNote, { error, onRetry: () => void load(), t }));
      else if (tab === 'products')
        listBody = h(ProductPane, {
          t,
          products: filteredProducts,
          total: products.length,
          query,
          onQuery: setQuery,
          onSelect: id => go({ page: 'product', id }),
          onCreate: () => go({ page: 'productNew' }),
          onRefresh: () => void load(),
          refreshing: phase === 'loading',
        });
      else
        listBody = h(CompanyPane, {
          t,
          company,
          documents: filteredDocuments,
          total: documents.length,
          slotCounts: snapshot?.documents.slotCounts || {},
          slot,
          onSlot: setSlot,
          query,
          onQuery: setQuery,
          onSelect: id => go({ page: 'document', id }),
          onCreate: () => go({ page: 'documentNew' }),
          onCompanySaved: async () => {
            setNotice(t('notice.saved'));
            await refreshAfter();
          },
        });

      return h(
        'section',
        { className: 'wl-page', 'aria-label': t('panel'), ref: pageRef },
        h('style', null, styles),
        h(
          'div',
          { className: 'wl-content' },
          notice ? h('div', { className: 'wl-notice', role: 'status' }, notice) : null,
          route.page === 'list'
            ? [
                h(
                  'header',
                  { key: 'title', className: 'wl-library-title' },
                  h('span', { className: 'wl-eyebrow' }, t('eyebrow')),
                  h('h1', { className: 'wl-title' }, t('title')),
                  h('p', { className: 'wl-subtitle' }, t('subtitle')),
                ),
                h(
                  'nav',
                  { key: 'tabs', className: 'wl-tabs', role: 'tablist', 'aria-label': t('title') },
                  [['products', t('tab.products')], ['company', t('tab.company')]].map(([key, label]) =>
                    h(LibraryButton,
                      { key, type: 'button', role: 'tab', className: 'wl-tab', 'aria-selected': tab === key, onClick: () => switchTab(key) },
                      label,
                    ),
                  ),
                ),
                h('div', { key: 'body' }, listBody),
              ]
            : [
                back
                  ? h(LibraryButton,
                      { key: 'back', type: 'button', className: 'wl-back', onClick: () => go(back.to) },
                      h(IconBack, { size: 16 }),
                      back.label,
                    )
                  : null,
                h('div', { key: 'page' }, detail),
              ],
        ),
      );
    }

    function ProductRowThumb({ productId, imageId }) {
      const url = useBlobUrl(imageId ? `/products/${encodeURIComponent(productId)}/images/${encodeURIComponent(imageId)}` : '');
      return h(
        'span',
        { className: `wl-row-thumb${url ? '' : ' empty'}` },
        url ? h('img', { src: url, alt: '' }) : h(IconImage, { size: 20 }),
      );
    }

    function ProductPane({ t, products, total, query, onQuery, onSelect, onCreate, onRefresh, refreshing }) {
      return h(
        'div',
        null,
        h(
          'div',
          { className: 'wl-heading' },
          h('div', null, h('span', { className: 'wl-count' }, `${total} ${t('count.products')}${query ? ` · ${products.length} / ${total}` : ''}`)),
          h(
            'div',
            { className: 'wl-detail-actions' },
            h(LibraryButton, { type: 'button', className: 'wl-btn ghost small', onClick: onRefresh, disabled: refreshing }, t('action.refresh')),
            h(LibraryButton, { type: 'button', className: 'wl-btn primary', onClick: onCreate }, h(IconPlus, { size: 14 }), t('action.newProduct')),
          ),
        ),
        h(
          'div',
          { className: 'wl-toolbar' },
          h(
            'label',
            { className: 'wl-search' },
            h(IconSearch, { size: 15 }),
            h(LibraryInput, {
              type: 'search',
              value: query,
              placeholder: t('search.products'),
              'aria-label': t('search.products'),
              onChange: event => onQuery(event.target.value),
            }),
          ),
        ),
        h(
          'div',
          { className: 'wl-list' },
          products.length
            ? products.map(product =>
                h(LibraryButton,
                  { key: product.id, type: 'button', className: 'wl-row with-thumb', onClick: () => onSelect(product.id) },
                  h(ProductRowThumb, { productId: product.id, imageId: product.primaryImageId }),
                  h(
                    'span',
                    { className: 'wl-row-body' },
                    h('span', { className: 'wl-row-title' }, product.name || '—'),
                    product.description ? h('span', { className: 'wl-row-snippet' }, product.description) : null,
                    h(
                      'span',
                      { className: 'wl-row-meta' },
                      h('span', null, product.category || t('product.emptyCategory')),
                      h('span', { 'aria-hidden': 'true' }, '·'),
                      h('span', null, product.status === 'archived' ? t('product.status.archived') : t('product.status.draft')),
                      readinessTag(product.readiness, t),
                    ),
                  ),
                  h('span', { className: 'wl-row-chevron' }, h(IconChevron, { size: 18 })),
                ),
              )
            : h(Empty, {
                t,
                title: query ? t('state.noProductMatch') : t('state.emptyProducts'),
                hint: query ? t('state.noProductMatchHint') : t('state.emptyProductsHint'),
              }),
        ),
      );
    }

    function ProductImageTile({ t, productId, image }) {
      const url = useBlobUrl(`/products/${encodeURIComponent(productId)}/images/${encodeURIComponent(image.id)}`);
      return h(
        'figure',
        { className: 'wl-image' },
        url
          ? h('img', { src: url, alt: image.alt || image.fileName, loading: 'lazy' })
          : h('div', { className: 'wl-image-fallback' }, h(IconImage, { size: 20 }), h('span', null, image.fileName)),
        image.isPrimary ? h('figcaption', null, t('image.primary')) : null,
      );
    }

    function ProductImageEditorCard({ t, productId, image, index, total, busy, onUpdate, onRemove }) {
      const url = useBlobUrl(`/products/${encodeURIComponent(productId)}/images/${encodeURIComponent(image.id)}`);
      const [alt, setAlt] = useState(image.alt || '');
      useEffect(() => {
        setAlt(image.alt || '');
      }, [image.alt]);
      return h(
        'div',
        { className: 'wl-image-card' },
        h('div', { className: 'wl-image-thumb' }, url ? h('img', { src: url, alt: image.alt || image.fileName }) : h('span', null, image.fileName)),
        h(LibraryInput, {
          value: alt,
          maxLength: 1000,
          'aria-label': t('image.alt'),
          disabled: busy,
          onChange: event => setAlt(event.target.value),
          onBlur: () => {
            if (alt !== image.alt) onUpdate({ alt });
          },
        }),
        h(
          'div',
          { className: 'wl-image-actions' },
          image.isPrimary
            ? h('span', { className: 'wl-tag ok' }, t('image.primary'))
            : h(LibraryButton, { type: 'button', className: 'wl-btn small', disabled: busy, onClick: () => onUpdate({ isPrimary: true }) }, t('image.setPrimary')),
          h(LibraryButton, { type: 'button', className: 'wl-btn small', disabled: busy || index === 0, onClick: () => onUpdate({ order: index - 1 }) }, t('image.up')),
          h(LibraryButton, { type: 'button', className: 'wl-btn small', disabled: busy || index === total - 1, onClick: () => onUpdate({ order: index + 1 }) }, t('image.down')),
          h(LibraryButton, { type: 'button', className: 'wl-btn small danger', disabled: busy, onClick: onRemove }, t('image.remove')),
        ),
      );
    }

    function ProductDetail({ t, id, documents, onEdit }) {
      const resource = useAsync(() => api.product(id), [id]);
      if (resource.phase === 'loading') return h(Loading, { label: t('state.loading') });
      if (resource.phase === 'error') return h('div', null, h(ErrorNote, { error: resource.error, onRetry: resource.reload, t }));
      const { product, readiness } = resource.value;
      const documentTitle = documentId => documents.find(document => document.id === documentId)?.title || documentId;

      return h(
        'div',
        null,
        h(
          'div',
          { className: 'wl-detail-head' },
          h(
            'div',
            null,
            h('span', { className: 'wl-tag' }, product.status === 'archived' ? t('product.status.archived') : t('product.tag.draft')),
            h('h2', { className: 'wl-detail-title' }, product.name),
            h('p', { className: 'wl-detail-sub' }, `${t('product.revision')} ${product.revision} · ${formatDate(product.updatedAt)} · ${product.category || t('product.emptyCategory')}`),
          ),
        ),
        product.images && product.images.length
          ? h('div', { className: 'wl-gallery' }, product.images.map(image => h(ProductImageTile, { key: image.id, t, productId: product.id, image })))
          : h('div', { className: 'wl-image-empty' }, h(IconImage, { size: 24 }), h('p', null, t('image.empty'))),
        h('p', { className: 'wl-description' }, product.description || t('product.emptyDescription')),
        h(
          'section',
          { className: 'wl-section' },
          h('div', { className: 'wl-subheading' }, h('h3', null, t('readiness.title')), readinessTag(readiness.overall, t)),
          h('p', { className: 'wl-help' }, t('readiness.hint')),
          h(
            'ul',
            { className: 'wl-checks' },
            readiness.checks.map(check =>
              h(
                'li',
                { key: check.key },
                h('span', { className: `wl-check-status ${check.status}` }, checkLabel(check.status, t)),
                h('div', { className: 'wl-check-body' }, h('strong', null, check.label), h('p', null, check.message)),
              ),
            ),
          ),
        ),
        h(
          'section',
          { className: 'wl-section' },
          h('div', { className: 'wl-subheading' }, h('h3', null, t('sku.title')), h('span', { className: 'wl-tag' }, `${product.skus.length} SKU`)),
          product.skus.length
            ? product.skus.map(sku =>
                h(
                  'div',
                  { key: sku.id, className: 'wl-sku' },
                  h(
                    'div',
                    { className: 'wl-version-head' },
                    h('strong', null, sku.code),
                    sku.unit ? h('span', { className: 'wl-tag' }, sku.unit) : null,
                    sku.moq ? h('span', { className: 'wl-tag' }, `MOQ ${sku.moq}`) : null,
                    sku.leadTimeDays ? h('span', { className: 'wl-tag' }, `${sku.leadTimeDays} ${t('sku.lead')}`) : null,
                  ),
                  h(
                    'dl',
                    { className: 'wl-facts' },
                    h('dt', null, t('sku.pricing')),
                    h(
                      'dd',
                      null,
                      sku.pricingMode === 'on_request'
                        ? t('sku.pricing.on_request')
                        : sku.pricingMode === 'tiered'
                          ? (sku.priceTiers || []).map(tier => `${tier.minQuantity}${sku.unit ? ` ${sku.unit}` : ''} · ${tier.unitPrice} ${tier.currency}`).join('\n') || '—'
                          : t('sku.pricing.unset'),
                      sku.pricingNote ? `\n${sku.pricingNote}` : '',
                    ),
                    sku.specs.length ? h('dt', null, t('sku.spec.key')) : null,
                    sku.specs.length ? h('dd', null, sku.specs.map(spec => `${spec.key}：${spec.value}`).join('\n')) : null,
                  ),
                ),
              )
            : h('p', { className: 'wl-help' }, t('sku.empty')),
        ),
        h(
          'section',
          { className: 'wl-section' },
          h('h3', null, t('supply.title')),
          h(
            'dl',
            { className: 'wl-facts' },
            SUPPLY_FIELDS.flatMap(([key, label]) => [h('dt', { key: `${key}-l` }, label), h('dd', { key: `${key}-v` }, product.supply?.[key] || t('supply.empty'))]),
          ),
        ),
        h(
          'section',
          { className: 'wl-section' },
          h('div', { className: 'wl-subheading' }, h('h3', null, t('documents.title')), h('span', { className: 'wl-tag' }, String(product.documents.length))),
          h('p', { className: 'wl-help' }, t('documents.hint')),
          product.documents.length
            ? product.documents.map(reference =>
                h(
                  'div',
                  { key: `${reference.documentId}-${reference.documentVersion}`, className: 'wl-sku' },
                  h(
                    'div',
                    { className: 'wl-version-head' },
                    h('strong', null, documentTitle(reference.documentId)),
                    h('span', { className: 'wl-tag' }, `v${reference.documentVersion}`),
                  ),
                  reference.purpose ? h('p', { className: 'wl-help' }, reference.purpose) : null,
                ),
              )
            : h('p', { className: 'wl-help' }, t('documents.empty')),
        ),
        h(
          'div',
          { className: 'wl-detail-action' },
          h(LibraryButton, { type: 'button', className: 'wl-btn primary', onClick: () => onEdit(product) }, t('action.edit')),
        ),
      );
    }

    function emptyProductDraft() {
      return {
        name: '',
        description: '',
        category: '',
        status: 'draft',
        skus: [],
        images: [],
        supply: { packaging: '', samplePolicy: '', paymentTerms: '', shippingTerms: '', capacityNote: '' },
        documents: [],
      };
    }

    function toDraft(product) {
      if (!product) return emptyProductDraft();
      return {
        name: product.name || '',
        description: product.description || '',
        category: product.category || '',
        status: product.status || 'draft',
        skus: (product.skus || []).map(sku => ({
          ...sku,
          specs: (sku.specs || []).map(spec => ({ ...spec })),
          priceTiers: (sku.priceTiers || []).map(tier => ({ ...tier })),
        })),
        images: (product.images || []).map(image => ({ ...image })),
        supply: { ...emptyProductDraft().supply, ...(product.supply || {}) },
        documents: (product.documents || []).map(reference => ({ ...reference })),
      };
    }

    function ProductEditor({ t, product, documents, onCancel, onSaved, admin = false, onDirtyChange, onBusy }) {
      const [draft, setDraft] = useState(() => toDraft(product));
      const [busy, setBusy] = useState(false);
      const [imageBusy, setImageBusy] = useState(false);
      const [baseRevision, setBaseRevision] = useState(product?.revision ?? null);
      const [error, setError] = useState(null);
      const patch = changes => setDraft(current => ({ ...current, ...changes }));
      useEffect(() => { onBusy?.(busy || imageBusy); return () => onBusy?.(false); }, [busy, imageBusy]);
      const dirty = JSON.stringify({ ...draft, images: [] }) !== JSON.stringify({ ...toDraft(product), images: [] });
      useEffect(() => { onDirtyChange?.(dirty); }, [dirty, onDirtyChange]);
      useEffect(() => {
        if (!dirty) return;
        const warn = event => { event.preventDefault(); event.returnValue = ''; };
        window.addEventListener('beforeunload', warn);
        return () => window.removeEventListener('beforeunload', warn);
      }, [dirty]);

      async function uploadImage(file) {
        if (!product || imageBusy) return;
        if (!IMAGE_TYPES.includes(file.type)) {
          setError(new Error(t('image.hint')));
          return;
        }
        if (file.size > MAX_FILE_BYTES) {
          setError(new Error(t('file.tooLarge').replace('{size}', String(Math.floor(MAX_FILE_BYTES / 1024 / 1024)))));
          return;
        }
        setImageBusy(true);
        setError(null);
        try {
          const dataBase64 = await fileToBase64(file);
          const result = await api.addImage(product.id, {
            expectedRevision: baseRevision,
            fileName: file.name,
            mimeType: file.type,
            dataBase64,
            alt: file.name,
          });
          setBaseRevision(result.product.revision);
          setDraft(current => ({ ...current, images: result.product.images }));
        } catch (cause) {
          setError(cause);
        } finally {
          setImageBusy(false);
        }
      }

      async function updateImage(imageId, changes) {
        if (!product || imageBusy) return;
        setImageBusy(true);
        setError(null);
        try {
          const result = await api.updateImage(product.id, imageId, { expectedRevision: baseRevision, ...changes });
          setBaseRevision(result.product.revision);
          setDraft(current => ({ ...current, images: result.product.images }));
        } catch (cause) {
          setError(cause);
        } finally {
          setImageBusy(false);
        }
      }

      async function removeImage(imageId) {
        if (!product || imageBusy) return;
        setImageBusy(true);
        setError(null);
        try {
          const result = await api.removeImage(product.id, imageId, { expectedRevision: baseRevision });
          setBaseRevision(result.product.revision);
          setDraft(current => ({ ...current, images: result.product.images }));
        } catch (cause) {
          setError(cause);
        } finally {
          setImageBusy(false);
        }
      }

      function patchSku(index, changes) {
        setDraft(current => ({ ...current, skus: current.skus.map((sku, at) => (at === index ? { ...sku, ...changes } : sku)) }));
      }

      function addSku() {
        setDraft(current => ({
          ...current,
          skus: [...current.skus, { code: '', unit: '', moq: null, leadTimeDays: null, pricingMode: 'unset', pricingNote: '', priceTiers: [], specs: [] }],
        }));
      }

      function removeSku(index) {
        setDraft(current => ({ ...current, skus: current.skus.filter((_, at) => at !== index) }));
      }

      async function submit(event) {
        event.preventDefault();
        if (busy) return;
        setBusy(true);
        setError(null);
        try {
          const changes = {
            name: draft.name.trim(),
            description: draft.description,
            category: draft.category,
            status: draft.status,
            skus: draft.skus.map(sku => ({
              ...(sku.id ? { id: sku.id } : {}),
              code: sku.code,
              unit: sku.unit,
              moq: sku.moq === '' ? null : sku.moq,
              leadTimeDays: sku.leadTimeDays === '' ? null : sku.leadTimeDays,
              pricingMode: sku.pricingMode,
              pricingNote: sku.pricingNote,
              priceTiers: (sku.priceTiers || []).map(tier => ({ minQuantity: tier.minQuantity, unitPrice: tier.unitPrice, currency: tier.currency || 'CNY' })),
              specs: (sku.specs || []).map(spec => ({ key: spec.key, value: spec.value })),
            })),
            supply: draft.supply,
            documents: draft.documents,
          };
          const saved = product
            ? await api.updateProduct(product.id, { expectedRevision: baseRevision, changes })
            : await api.createProduct(changes);
          await onSaved(saved.id || product?.id);
        } catch (cause) {
          setError(cause);
        } finally {
          setBusy(false);
        }
      }

      const availableDocuments = documents || [];

      const editor = h(
        'form',
        { className: `wl-form wl-editor${admin ? ' wl-admin-editor' : ''}`, onSubmit: submit },
        admin ? null : h('div', { className: 'wl-detail-head' }, h('h2', { className: 'wl-detail-title' }, product ? t('editor.editProduct') : t('editor.newProduct'))),
        h(LibraryCard,
          { className: 'wl-card wl-product-identity' },
          h(
            'div',
            { className: 'wl-form' },
            h('div', { className: 'wl-field' }, h('label', null, t('product.name')), h(LibraryInput, { required: true, maxLength: 200, value: draft.name, onChange: event => patch({ name: event.target.value }) })),
            h('div', { className: 'wl-field' }, h('label', null, t('product.description')), h(LibraryTextArea, { rows: 4, maxLength: 8000, value: draft.description, onChange: event => patch({ description: event.target.value }) })),
            admin ? null : h(
              'div',
              { className: 'wl-field-row' },
              h('div', { className: 'wl-field' }, h('label', null, t('product.category')), h(LibraryInput, { maxLength: 200, value: draft.category, onChange: event => patch({ category: event.target.value }) })),
              h(
                'div',
                { className: 'wl-field' },
                h('label', null, t('product.status')),
                h(
                  'select',
                  { value: draft.status, onChange: event => patch({ status: event.target.value }) },
                  h('option', { value: 'draft' }, t('product.status.draft')),
                  h('option', { value: 'archived' }, t('product.status.archived')),
                ),
              ),
            ),
          ),
        ),
        h(LibraryCard,
          { className: 'wl-card wl-product-variants' },
          h(
            'div',
            { className: 'wl-card-head' },
            h('h3', null, t('sku.title')),
            h(LibraryButton, { type: 'button', className: 'wl-btn small', onClick: addSku, disabled: draft.skus.length >= 100 }, t('sku.add')),
          ),
          draft.skus.length ? null : h('p', { className: 'wl-help' }, t('sku.empty')),
          draft.skus.map((sku, index) =>
            h(
              'div',
              { key: index, className: 'wl-sku' },
              h(
                'div',
                { className: 'wl-sku-head' },
                h('strong', null, sku.code || `${t('sku.code')} ${index + 1}`),
                h(LibraryButton, { type: 'button', className: 'wl-btn small danger', onClick: () => removeSku(index) }, t('sku.remove')),
              ),
              h(
                'div',
                { className: 'wl-field-row' },
                h('div', { className: 'wl-field' }, h('label', null, t('sku.code')), h(LibraryInput, { required: true, maxLength: 100, value: sku.code, onChange: event => patchSku(index, { code: event.target.value }) })),
                h('div', { className: 'wl-field' }, h('label', null, t('sku.unit')), h(LibraryInput, { maxLength: 100, placeholder: t('sku.unitHint'), value: sku.unit, onChange: event => patchSku(index, { unit: event.target.value }) })),
                h('div', { className: 'wl-field' }, h('label', null, t('sku.moq')), h(LibraryInput, { type: 'number', min: 1, value: sku.moq ?? '', onChange: event => patchSku(index, { moq: event.target.value ? Number(event.target.value) : null }) })),
                h('div', { className: 'wl-field' }, h('label', null, t('sku.lead')), h(LibraryInput, { type: 'number', min: 1, max: 36500, value: sku.leadTimeDays ?? '', onChange: event => patchSku(index, { leadTimeDays: event.target.value ? Number(event.target.value) : null }) })),
              ),
              h(
                'div',
                { className: 'wl-field-row', style: { marginTop: '8px' } },
                h(
                  'div',
                  { className: 'wl-field' },
                  h('label', null, t('sku.pricing')),
                  h(
                    'select',
                    { value: sku.pricingMode, onChange: event => patchSku(index, { pricingMode: event.target.value, priceTiers: event.target.value === 'tiered' ? sku.priceTiers : [] }) },
                    h('option', { value: 'unset' }, t('sku.pricing.unset')),
                    h('option', { value: 'tiered' }, t('sku.pricing.tiered')),
                    h('option', { value: 'on_request' }, t('sku.pricing.on_request')),
                  ),
                ),
                h('div', { className: 'wl-field' }, h('label', null, t('sku.pricing.note')), h(LibraryInput, { maxLength: 500, value: sku.pricingNote, onChange: event => patchSku(index, { pricingNote: event.target.value }) })),
              ),
              sku.pricingMode === 'tiered'
                ? h(
                    'div',
                    null,
                    (sku.priceTiers || []).map((tier, tierIndex) =>
                      h(
                        'div',
                        { key: tierIndex, className: 'wl-tier-row' },
                        h(LibraryInput, { type: 'number', min: 1, 'aria-label': t('sku.tier.min'), placeholder: t('sku.tier.min'), value: tier.minQuantity ?? '', onChange: event => patchSku(index, { priceTiers: sku.priceTiers.map((entry, at) => (at === tierIndex ? { ...entry, minQuantity: Number(event.target.value) } : entry)) }) }),
                        h(LibraryInput, { 'aria-label': t('sku.tier.price'), placeholder: t('sku.tier.price'), value: tier.unitPrice ?? '', onChange: event => patchSku(index, { priceTiers: sku.priceTiers.map((entry, at) => (at === tierIndex ? { ...entry, unitPrice: event.target.value } : entry)) }) }),
                        h(LibraryInput, { 'aria-label': t('sku.tier.currency'), placeholder: 'CNY', maxLength: 8, value: tier.currency ?? 'CNY', onChange: event => patchSku(index, { priceTiers: sku.priceTiers.map((entry, at) => (at === tierIndex ? { ...entry, currency: event.target.value } : entry)) }) }),
                        h(LibraryButton, { type: 'button', className: 'wl-btn small danger', onClick: () => patchSku(index, { priceTiers: sku.priceTiers.filter((_, at) => at !== tierIndex) }) }, '×'),
                      ),
                    ),
                    h(LibraryButton, { type: 'button', className: 'wl-btn small', style: { marginTop: '6px' }, onClick: () => patchSku(index, { priceTiers: [...(sku.priceTiers || []), { minQuantity: 1, unitPrice: '', currency: 'CNY' }] }) }, t('sku.tier.add')),
                  )
                : null,
              h(
                'div',
                { style: { marginTop: '8px' } },
                h('div', { className: 'wl-inline', style: { justifyContent: 'space-between' } }, h('span', { className: 'wl-help' }, t('sku.spec.key')), h(LibraryButton, { type: 'button', className: 'wl-btn small', onClick: () => patchSku(index, { specs: [...(sku.specs || []), { key: '', value: '' }] }) }, t('sku.spec.add'))),
                (sku.specs || []).map((spec, specIndex) =>
                  h(
                    'div',
                    { key: specIndex, className: 'wl-spec-row' },
                    h(LibraryInput, { 'aria-label': t('sku.spec.key'), placeholder: t('sku.spec.key'), value: spec.key, onChange: event => patchSku(index, { specs: sku.specs.map((entry, at) => (at === specIndex ? { ...entry, key: event.target.value } : entry)) }) }),
                    h(LibraryInput, { 'aria-label': t('sku.spec.value'), placeholder: t('sku.spec.value'), value: spec.value, onChange: event => patchSku(index, { specs: sku.specs.map((entry, at) => (at === specIndex ? { ...entry, value: event.target.value } : entry)) }) }),
                    h(LibraryButton, { type: 'button', className: 'wl-btn small danger', onClick: () => patchSku(index, { specs: sku.specs.filter((_, at) => at !== specIndex) }) }, '×'),
                  ),
                ),
              ),
            ),
          ),
        ),
        h(LibraryCard,
          { className: 'wl-card wl-product-supply' },
          h('div', { className: 'wl-card-head' }, h('h3', null, t('supply.title'))),
          h(
            'div',
            { className: 'wl-form' },
            SUPPLY_FIELDS.map(([key, label]) =>
              h(
                'div',
                { key, className: 'wl-field' },
                h('label', null, label),
                h(LibraryTextArea, { rows: 2, maxLength: 4000, value: draft.supply[key] || '', onChange: event => patch({ supply: { ...draft.supply, [key]: event.target.value } }) }),
              ),
            ),
          ),
        ),
        h(LibraryCard,
          { className: 'wl-card wl-product-media' },
          h(
            'div',
            { className: 'wl-card-head' },
            h('h3', null, t('image.title')),
            product
              ? h(
                  'label',
                  { className: 'wl-btn small' },
                  imageBusy ? t('editor.uploading') : t('image.add'),
                  h(LibraryInput, {
                    type: 'file',
                    accept: IMAGE_TYPES.join(','),
                    style: { display: 'none' },
                    disabled: imageBusy,
                    onChange: event => {
                      const file = event.target.files?.[0];
                      event.target.value = '';
                      if (file) void uploadImage(file);
                    },
                  }),
                )
              : null,
          ),
          product
            ? draft.images.length
              ? h(
                  'div',
                  { className: 'wl-image-grid' },
                  draft.images.map((image, index) =>
                    h(ProductImageEditorCard, {
                      key: image.id,
                      t,
                      productId: product.id,
                      image,
                      index,
                      total: draft.images.length,
                      busy: imageBusy,
                      onUpdate: changes => void updateImage(image.id, changes),
                      onRemove: () => void removeImage(image.id),
                    }),
                  ),
                )
              : h('p', { className: 'wl-help' }, t('image.empty'))
            : h('p', { className: 'wl-help' }, t('image.saveFirst')),
          h('p', { className: 'wl-help' }, t('image.hint')),
        ),
        h(LibraryCard,
          { className: 'wl-card wl-product-documents' },
          h('div', { className: 'wl-card-head' }, h('h3', null, t('documents.title'))),
          h('p', { className: 'wl-help' }, t('documents.hint')),
          draft.documents.length
            ? draft.documents.map((reference, index) =>
                h(
                  'div',
                  { key: `${reference.documentId}-${reference.documentVersion}`, className: 'wl-version' },
                  h(
                    'div',
                    { className: 'wl-version-head' },
                    h('strong', null, availableDocuments.find(document => document.id === reference.documentId)?.title || reference.documentId),
                    h('span', { className: 'wl-tag' }, `v${reference.documentVersion}`),
                    h(LibraryButton, { type: 'button', className: 'wl-btn small danger', onClick: () => patch({ documents: draft.documents.filter((_, at) => at !== index) }) }, t('documents.remove')),
                  ),
                  h(
                    'div',
                    { className: 'wl-field', style: { marginTop: '6px' } },
                    h('label', null, t('documents.purpose')),
                    h(LibraryInput, { maxLength: 1000, value: reference.purpose || '', onChange: event => patch({ documents: draft.documents.map((entry, at) => (at === index ? { ...entry, purpose: event.target.value } : entry)) }) }),
                  ),
                ),
              )
            : h('p', { className: 'wl-help' }, t('documents.empty')),
          h(DocumentPicker, {
            t,
            documents: availableDocuments,
            onAdd: reference => {
              if (draft.documents.some(entry => entry.documentId === reference.documentId && entry.documentVersion === reference.documentVersion)) return;
              patch({ documents: [...draft.documents, reference] });
            },
            disabled: draft.documents.length >= 50,
          }),
        ),
        admin ? h(LibraryCard, { className: 'wl-card wl-product-organization' },
          h('div', { className: 'wl-card-head' }, h('h3', null, '商品组织与状态')),
            h(
              'div',
              { className: 'wl-field-row' },
              h('div', { className: 'wl-field' }, h('label', null, t('product.category')), h(LibraryInput, { maxLength: 200, value: draft.category, onChange: event => patch({ category: event.target.value }) })),
              h(
                'div',
                { className: 'wl-field' },
                h('label', null, t('product.status')),
                h(
                  'select',
                  { value: draft.status, onChange: event => patch({ status: event.target.value }) },
                  h('option', { value: 'draft' }, t('product.status.draft')),
                  h('option', { value: 'archived' }, t('product.status.archived')),
                ),
              ),
            )
        ) : null,
        h(ErrorNote, { error, t }),
        h(
          'div',
          { className: 'wl-form-actions' },
          admin ? h('span', { className: 'wl-save-state', role: 'status' }, busy ? '正在保存…' : dirty ? '有未保存的更改' : product ? '商品资料已保存' : '新商品') : null,
          h(LibraryButton, { type: 'button', className: 'wl-btn', onClick: onCancel }, t('action.cancel')),
          h(LibraryButton, { type: 'submit', className: 'wl-btn primary', disabled: busy || imageBusy || !draft.name.trim() || (admin && product && !dirty) }, busy ? t('editor.saving') : t('editor.saveProduct')),
        ),
      );
      if (!admin) return editor;
      const children = React.Children.toArray(editor.props.children);
      const card = name => children.find(child => child.props?.className === `wl-card wl-product-${name}`);
      const other = children.filter(child => !child.props?.className?.startsWith('wl-card wl-product-'));
      return React.cloneElement(editor, {}, h('div', { className: 'wl-admin-grid' },
        h('div', { className: 'wl-admin-primary' }, card('identity'), card('media'), card('variants')),
        h('aside', { className: 'wl-admin-secondary', 'aria-label': '商品状态与供货资料' }, card('organization'), card('supply'), card('documents'))), ...other);
    }

    function DocumentPicker({ t, documents, onAdd, disabled }) {
      const [documentId, setDocumentId] = useState('');
      const [version, setVersion] = useState(1);
      const [purpose, setPurpose] = useState('');
      const selected = documents.find(document => document.id === documentId);
      return h(
        'div',
        { className: 'wl-form', style: { marginTop: '10px' } },
        h(
          'div',
          { className: 'wl-field-row' },
          h(
            'div',
            { className: 'wl-field' },
            h('label', null, t('documents.pick')),
            h(
              'select',
              {
                value: documentId,
                onChange: event => {
                  const next = documents.find(document => document.id === event.target.value);
                  setDocumentId(event.target.value);
                  setVersion(next ? next.currentVersion : 1);
                },
              },
              h('option', { value: '' }, t('documents.choose')),
              documents.map(document => h('option', { key: document.id, value: document.id }, `${document.title} · ${document.slotLabel} · v${document.currentVersion}`)),
            ),
          ),
          selected
            ? h(
                'div',
                { className: 'wl-field' },
                h('label', null, t('documents.version')),
                h(
                  'select',
                  { value: version, onChange: event => setVersion(Number(event.target.value)) },
                  Array.from({ length: selected.currentVersion }, (_, index) => selected.currentVersion - index).map(value =>
                    h('option', { key: value, value }, `v${value}${value === selected.currentVersion ? ` · ${t('documents.versionCurrent')}` : ` · ${t('documents.versionHistory')}`}`),
                  ),
                ),
              )
            : null,
        ),
        selected
          ? h(
              'div',
              { className: 'wl-field-row' },
              h('div', { className: 'wl-field' }, h('label', null, t('documents.purpose')), h(LibraryInput, { maxLength: 1000, value: purpose, onChange: event => setPurpose(event.target.value) })),
              h(
                'div',
                { className: 'wl-field', style: { justifyContent: 'flex-end' } },
                h(LibraryButton,
                  {
                    type: 'button',
                    className: 'wl-btn',
                    disabled: disabled,
                    onClick: () => {
                      onAdd({ documentId: selected.id, documentVersion: version, purpose });
                      setDocumentId('');
                      setPurpose('');
                    },
                  },
                  t('documents.add'),
                ),
              ),
            )
          : null,
        documents.length ? null : h('p', { className: 'wl-help' }, t('documents.empty')),
      );
    }

    // ---------------------------------------------------------------------
    // Company and documents

    function CompanyPane({ t, company, documents, total, slotCounts, slot, onSlot, query, onQuery, onSelect, onCreate, onCompanySaved }) {
      return h(
        'div',
        null,
        h(
          'div',
          { className: 'wl-heading' },
          h('div', null, h('h2', null, t('tab.company')), h('p', null, t('company.subtitle'))),
          h(LibraryButton, { type: 'button', className: 'wl-btn primary', onClick: onCreate }, h(IconPlus, { size: 14 }), t('action.newDocument')),
        ),
        h(CompanyCard, { t, company, onSaved: onCompanySaved }),
        h(
          'section',
          { className: 'wl-section' },
          h('div', { className: 'wl-subheading' }, h('h3', null, t('company.files')), h('span', { className: 'wl-tag' }, String(total))),
          h(
            'div',
            { className: 'wl-chipbar' },
            [['', t('document.slot.all')], ...SLOTS].map(([key, label]) =>
              h(LibraryButton,
                { key: key || 'all', type: 'button', className: 'wl-chip', 'aria-pressed': slot === key, onClick: () => onSlot(key) },
                `${label}${key && slotCounts[key] ? ` ${slotCounts[key]}` : ''}`,
              ),
            ),
          ),
          h(
            'label',
            { className: 'wl-search', style: { marginBottom: '16px' } },
            h(IconSearch, { size: 15 }),
            h(LibraryInput, { type: 'search', value: query, placeholder: t('search.documents'), 'aria-label': t('search.documents'), onChange: event => onQuery(event.target.value) }),
          ),
          h(
            'div',
            { className: 'wl-list' },
            documents.length
              ? documents.map(document =>
                  h(LibraryButton,
                    { key: document.id, type: 'button', className: 'wl-row', onClick: () => onSelect(document.id) },
                    h(
                      'span',
                      { className: 'wl-row-body' },
                      h('span', { className: 'wl-row-main' }, h('span', { className: 'wl-row-title' }, document.title), reviewTag(document.reviewState, t)),
                      h(
                        'span',
                        { className: 'wl-row-meta' },
                        h('span', null, document.slotLabel),
                        h('span', { 'aria-hidden': 'true' }, '·'),
                        h('span', null, `v${document.currentVersion}`),
                        h('span', { 'aria-hidden': 'true' }, '·'),
                        h('span', null, formatDate(document.updatedAt)),
                      ),
                    ),
                    h('span', { className: 'wl-row-chevron' }, h(IconChevron, { size: 18 })),
                  ),
                )
              : h(Empty, {
                  t,
                  title: query || slot ? t('state.noDocumentMatch') : t('state.emptyDocuments'),
                  hint: query || slot ? t('state.noProductMatchHint') : t('state.emptyDocumentsHint'),
                }),
          ),
        ),
      );
    }

    function CompanyCard({ t, company, onSaved, onDirtyChange, onBusy }) {
      const [draft, setDraft] = useState(() => ({
        legalName: company?.legalName || '',
        displayName: company?.displayName || '',
        description: company?.description || '',
      }));
      const [busy, setBusy] = useState(false);
      const [error, setError] = useState(null);

      const dirty = ['legalName', 'displayName', 'description'].some(key => draft[key] !== (company?.[key] || ''));
      useEffect(() => { onDirtyChange?.(dirty); return () => onDirtyChange?.(false); }, [dirty]);
      useEffect(() => { onBusy?.(busy); return () => onBusy?.(false); }, [busy]);
      useEffect(() => {
        setDraft({
          legalName: company?.legalName || '',
          displayName: company?.displayName || '',
          description: company?.description || '',
        });
      }, [company?.revision]);

      async function submit(event) {
        event.preventDefault();
        if (busy) return;
        setBusy(true);
        setError(null);
        try {
          await api.saveCompany({ expectedRevision: company.revision, changes: draft });
          await onSaved();
        } catch (cause) {
          setError(cause);
        } finally {
          setBusy(false);
        }
      }

      return h(
        'section',
        { className: 'wl-section' },
        h('h3', null, t('company.base')),
        h(
          'form',
          { className: 'wl-form', onSubmit: submit },
          h('div', { className: 'wl-field' }, h('label', null, t('company.displayName')), h(LibraryInput, { maxLength: 200, value: draft.displayName, onChange: event => setDraft({ ...draft, displayName: event.target.value }) })),
          h('div', { className: 'wl-field' }, h('label', null, t('company.legalName')), h(LibraryInput, { maxLength: 200, value: draft.legalName, onChange: event => setDraft({ ...draft, legalName: event.target.value }) })),
          h('div', { className: 'wl-field' }, h('label', null, t('company.description')), h(LibraryTextArea, { rows: 4, maxLength: 4000, value: draft.description, onChange: event => setDraft({ ...draft, description: event.target.value }) })),
          h(ErrorNote, { error, t }),
          h(
            'div',
            { className: 'wl-form-actions' },
            h('span', { className: 'wl-help', style: { marginRight: 'auto', marginTop: 0, marginBottom: 0 } }, `${t('product.revision')} ${company?.revision ?? 0} · ${formatDate(company?.updatedAt)}`),
            h(LibraryButton, { type: 'submit', className: 'wl-btn primary', disabled: busy }, busy ? t('editor.saving') : t('action.save')),
          ),
        ),
      );
    }

    function DocumentFilePreview({ pathname, mimeType, fileName }) {
      const url = useBlobUrl(pathname);
      if (!url) return null;
      if (mimeType === 'application/pdf') return h('iframe', { className: 'wl-frame', src: url, title: fileName });
      if (String(mimeType).startsWith('image/')) return h('img', { className: 'wl-thumb', src: url, alt: fileName });
      return null;
    }

    function DocumentMetaEditor({ t, document, onCancel, onSaved, onDirtyChange, onBusy }) {
      const ui = React.useContext(SurfaceUI);
      const [draft, setDraft] = useState({ title: document.title, slotKey: document.slotKey, tags: (document.tags || []).join(', ') });
      const [busy, setBusy] = useState(false);
      const [error, setError] = useState(null);

      const dirty = draft.title !== document.title || draft.slotKey !== document.slotKey || draft.tags !== (document.tags || []).join(', ');
      useEffect(() => { onDirtyChange?.(dirty); return () => onDirtyChange?.(false); }, [dirty]);
      useEffect(() => { onBusy?.(busy); return () => onBusy?.(false); }, [busy]);
      async function submit(event) {
        event.preventDefault();
        if (busy) return;
        setBusy(true);
        setError(null);
        try {
          await api.updateDocument(document.id, {
            expectedRevision: document.revision,
            changes: {
              title: draft.title,
              slotKey: draft.slotKey,
              tags: draft.tags.split(/[,，]/u).map(tag => tag.trim()).filter(Boolean),
            },
          });
          await onSaved();
        } catch (cause) {
          setError(cause);
        } finally {
          setBusy(false);
        }
      }

      return h(
        'form',
        { className: 'wl-form wl-editor', onSubmit: submit },
        h('div', { className: 'wl-detail-head' }, h('h2', { className: 'wl-detail-title' }, t('metadata.title'))),
        h(LibraryCard,
          { className: 'wl-card' },
          h(
            'div',
            { className: 'wl-form' },
            h('div', { className: 'wl-field' }, h('label', null, t('document.title')), h(LibraryInput, { required: true, maxLength: 200, value: draft.title, onChange: event => setDraft({ ...draft, title: event.target.value }) })),
            h(
              'div',
              { className: 'wl-field-row' },
              h(
                'div',
                { className: 'wl-field' },
                h('label', null, t('document.slot')),
                h('select', { value: draft.slotKey, onChange: event => setDraft({ ...draft, slotKey: event.target.value }) }, SLOTS.map(([key, label]) => h('option', { key, value: key }, label))),
              ),
              h('div', { className: 'wl-field' }, h('label', null, t('document.tags')), h(LibraryInput, { maxLength: 400, placeholder: t('metadata.tagsHint'), value: draft.tags, onChange: event => setDraft({ ...draft, tags: event.target.value }) })),
            ),
          ),
        ),
        h(ErrorNote, { error, t }),
        h(
          'div',
          { className: 'wl-form-actions' },
          h(LibraryButton, { type: 'button', className: 'wl-btn', disabled: busy, onClick: async () => { if (!onDirtyChange || !dirty || await (ui?.confirmDiscard?.() ?? window.confirm('放弃尚未保存的修改？'))) onCancel(); } }, t('action.cancel')),
          h(LibraryButton, { type: 'submit', className: 'wl-btn primary', disabled: busy || !draft.title.trim() }, busy ? t('editor.saving') : t('action.save')),
        ),
      );
    }

    function DocumentDetail({ t, id, onAddVersion, onChanged, onDirtyChange, onBusy, admin = false }) {
      const resource = useAsync(() => api.document(id), [id]);
      const [openVersion, setOpenVersion] = useState(null);
      const [editingInfo, setEditingInfo] = useState(false);
      const [note, setNote] = useState('');
      const [busy, setBusy] = useState(false);
      const [error, setError] = useState(null);

      useEffect(() => { onBusy?.(busy); return () => onBusy?.(false); }, [busy]);
      if (resource.phase === 'loading') return h(Loading, { label: t('state.loading') });
      if (resource.phase === 'error') return h('div', null, h(ErrorNote, { error: resource.error, onRetry: resource.reload, t }));

      const { document, reviewState } = resource.value;
      const current = document.versions.find(version => version.version === document.currentVersion);

      if (editingInfo) {
        return h(DocumentMetaEditor, {
          t,
          document,
          onDirtyChange, onBusy,
          onCancel: () => setEditingInfo(false),
          onSaved: async () => {
            setEditingInfo(false);
            await onChanged();
          },
        });
      }

      async function review(decision) {
        if (busy) return;
        setBusy(true);
        setError(null);
        try {
          await api.review(document.id, document.currentVersion, { expectedRevision: document.revision, decision, note });
          setNote('');
          await onChanged();
        } catch (cause) {
          setError(cause);
        } finally {
          setBusy(false);
        }
      }

      async function toggleStatus() {
        if (busy) return;
        setBusy(true);
        setError(null);
        try {
          await api.updateDocument(document.id, {
            expectedRevision: document.revision,
            changes: { status: document.status === 'active' ? 'archived' : 'active' },
          });
          await onChanged();
        } catch (cause) {
          setError(cause);
        } finally {
          setBusy(false);
        }
      }

      return h(
        'div',
        null,
        h(
          'div',
          { className: 'wl-detail-head' },
          h(
            'div',
            null,
            h(
              'div',
              { className: 'wl-inline' },
              h('span', { className: 'wl-tag' }, document.slotKey === 'other' ? t('document.slot.all') : SLOTS.find(([key]) => key === document.slotKey)?.[1] || document.slotKey),
              !admin ? reviewTag(reviewState, t) : null,
              document.status === 'archived' ? h('span', { className: 'wl-tag idle' }, t('document.status.archived')) : null,
            ),
            h('h2', { className: 'wl-detail-title' }, document.title),
            h('p', { className: 'wl-detail-sub' }, `${t('product.revision')} ${document.revision} · ${t('document.current').replace('{version}', String(document.currentVersion))} · ${formatDate(document.updatedAt)}`),
          ),
          h(
            'div',
            { className: 'wl-detail-actions' },
            h(LibraryButton, { type: 'button', className: 'wl-btn', onClick: () => setEditingInfo(true) }, t('document.editInfo')),
            h(LibraryButton, { type: 'button', className: 'wl-btn', onClick: () => onAddVersion(document) }, t('document.addVersion')),
            h(LibraryButton, { type: 'button', className: 'wl-btn', onClick: toggleStatus, disabled: busy }, document.status === 'active' ? t('document.archive') : t('document.restore')),
          ),
        ),
        document.tags?.length ? h('div', { className: 'wl-inline', style: { marginTop: '6px' } }, document.tags.map(tag => h('span', { key: tag, className: 'wl-tag' }, tag))) : null,
        !admin ? h(LibraryCard,
          { className: 'wl-card' },
          h('div', { className: 'wl-card-head' }, h('h3', null, t('document.review')), reviewTag(reviewState, t)),
          h('p', { className: 'wl-help' }, t('document.review.hint')),
          h(
            'div',
            { className: 'wl-field', style: { marginTop: '10px' } },
            h('label', null, t('document.review.note')),
            h(LibraryInput, { maxLength: 2000, value: note, onChange: event => setNote(event.target.value) }),
          ),
          h(
            'div',
            { className: 'wl-form-actions', style: { justifyContent: 'flex-start' } },
            h(LibraryButton, { type: 'button', className: 'wl-btn primary', disabled: busy, onClick: () => void review('verified') }, t('document.verify')),
            h(LibraryButton, { type: 'button', className: 'wl-btn danger', disabled: busy, onClick: () => void review('rejected') }, t('document.reject')),
          ),
          h(ErrorNote, { error, t }),
        ) : h(ErrorNote, { error, t }),
        h(LibraryCard,
          { className: 'wl-card' },
          h('div', { className: 'wl-card-head' }, h('h3', null, t('document.versions')), h('span', { className: 'wl-tag' }, `${document.versions.length}`)),
          [...document.versions].reverse().map(version =>
            h(
              'div',
              { key: version.version, className: 'wl-version' },
              h(
                'div',
                { className: 'wl-version-head' },
                h('strong', null, `v${version.version}`),
                version.version === document.currentVersion ? h('span', { className: 'wl-tag ok' }, t('documents.versionCurrent')) : h('span', { className: 'wl-tag' }, t('documents.versionHistory')),
                h('span', { className: 'wl-tag' }, version.fileName),
                h('span', { className: 'wl-tag' }, formatBytes(version.bytes)),
                version.attachment
                  ? [
                      h(LibraryButton,
                        { key: 'open', type: 'button', className: 'wl-btn small', onClick: () => void openStoredFile(`/documents/${encodeURIComponent(document.id)}/versions/${version.version}/file`, version.fileName).catch(cause => setError(cause)) },
                        t('document.openFile'),
                      ),
                      h(LibraryButton,
                        { key: 'download', type: 'button', className: 'wl-btn small', onClick: () => void openStoredFile(`/documents/${encodeURIComponent(document.id)}/versions/${version.version}/file`, version.fileName, true).catch(cause => setError(cause)) },
                        t('document.download'),
                      ),
                    ]
                  : h(LibraryButton,
                      { type: 'button', className: 'wl-btn small', onClick: () => setOpenVersion(openVersion === version.version ? null : version.version) },
                      openVersion === version.version ? t('document.hidePreview') : t('document.preview'),
                    ),
              ),
              h('div', { className: 'wl-version-meta' }, h('span', null, formatDate(version.createdAt)), !admin ? h('span', { className: 'wl-sha' }, `sha256 ${version.sha256.slice(0, 16)}…`) : null),
              version.certificate && version.certificate.expiryMode !== 'unknown'
                ? h('p', { className: 'wl-help' }, `${version.certificate.number || '—'} · ${version.certificate.issuer || '—'} · ${version.certificate.expiryMode === 'no_expiry' ? t('cert.no_expiry') : `${version.certificate.validFrom || ''} → ${version.certificate.validUntil || ''}`}`)
                : null,
              version.attachment && (String(version.mimeType).startsWith('image/') || version.mimeType === 'application/pdf')
                ? h(DocumentFilePreview, {
                    pathname: `/documents/${encodeURIComponent(document.id)}/versions/${version.version}/file`,
                    mimeType: version.mimeType,
                    fileName: version.fileName,
                  })
                : null,
              !version.attachment ? h('p', { className: 'wl-help' }, t('document.textOnly')) : null,
              openVersion === version.version ? h('pre', { className: 'wl-pre' }, version.content) : null,
            ),
          ),
          !admin ? h('div', { className: 'wl-version-meta', style: { marginTop: '10px' } }, h('span', { className: 'wl-sha' }, `sha256 ${current ? current.sha256 : ''}`)) : null,
        ),
        !admin ? h(LibraryCard,
          { className: 'wl-card' },
          h('div', { className: 'wl-card-head' }, h('h3', null, t('document.reviews')), h('span', { className: 'wl-tag' }, `${document.reviews.length}`)),
          document.reviews.length
            ? [...document.reviews].reverse().map(entry =>
                h(
                  'div',
                  { key: entry.id, className: 'wl-review' },
                  h(
                    'div',
                    { className: 'wl-review-head' },
                    reviewTag(entry.decision, t),
                    h('strong', null, `v${entry.documentVersion}`),
                    h('span', { className: 'wl-help' }, `${t('document.review.reviewedBy')} ${entry.reviewedBy} · ${formatDate(entry.reviewedAt)}`),
                  ),
                  entry.note ? h('p', { className: 'wl-review-note' }, entry.note) : null,
                ),
              )
            : h('p', { className: 'wl-help' }, t('document.noReviews')),
        ) : null,
      );
    }

    function DocumentEditor({ t, document, versionMode, onCancel, onSaved, onDirtyChange, onBusy }) {
      const ui = React.useContext(SurfaceUI);
      const creating = !document;
      const certificateSlot = CERT_SLOTS.includes(document?.slotKey || 'other');
      const [draft, setDraft] = useState(() => ({
        title: document?.title || '',
        slotKey: document?.slotKey || 'other',
        tags: (document?.tags || []).join(', '),
        fileName: '',
        content: '',
        certificate: { number: '', issuer: '', scope: '', validFrom: '', validUntil: '', expiryMode: 'unknown', expiryNote: '' },
      }));
      const [busy, setBusy] = useState(false);
      const [mode, setMode] = useState('file');
      const [file, setFile] = useState(null);
      const [error, setError] = useState(null);
      const initialDraft = useRef(JSON.stringify(draft));
      const dirty = !!file || JSON.stringify(draft) !== initialDraft.current;
      useEffect(() => { onDirtyChange?.(dirty); return () => onDirtyChange?.(false); }, [dirty]);
      useEffect(() => { onBusy?.(busy); return () => onBusy?.(false); }, [busy]);
      const patch = changes => setDraft(current => ({ ...current, ...changes }));
      const showCertificate = creating ? CERT_SLOTS.includes(draft.slotKey) : certificateSlot;

      async function submit(event) {
        event.preventDefault();
        if (busy) return;
        setBusy(true);
        setError(null);
        try {
          const certificate = showCertificate
            ? {
                ...draft.certificate,
                validFrom: draft.certificate.validFrom || null,
                validUntil: draft.certificate.validUntil || null,
              }
            : undefined;
          let payload;
          if (mode === 'file') {
            if (!file) throw new Error(t('file.none'));
            if (file.size > MAX_FILE_BYTES) throw new Error(t('file.tooLarge').replace('{size}', String(Math.floor(MAX_FILE_BYTES / 1024 / 1024))));
            payload = { fileName: file.name || draft.fileName, mimeType: file.type, dataBase64: await fileToBase64(file) };
          } else {
            payload = { fileName: draft.fileName, content: draft.content };
          }
          const version = { ...payload, ...(certificate ? { certificate } : {}) };
          let saved;
          if (creating) {
            saved = await api.createDocument({
              title: draft.title,
              slotKey: draft.slotKey,
              tags: draft.tags.split(/[,，]/u).map(tag => tag.trim()).filter(Boolean),
              ...version,
            });
          } else {
            saved = await api.addVersion(document.id, version);
          }
          await onSaved(saved.id || document.id);
        } catch (cause) {
          setError(cause);
        } finally {
          setBusy(false);
        }
      }

      return h(
        'form',
        { className: 'wl-form wl-editor', onSubmit: submit },
        h(
          'div',
          { className: 'wl-detail-head' },
          h('h2', { className: 'wl-detail-title' }, creating ? t('editor.newDocument') : t('editor.newVersion')),
          !creating ? h('p', { className: 'wl-help' }, t('editor.versionHint')) : null,
        ),
        creating
          ? h(LibraryCard,
              { className: 'wl-card' },
              h(
                'div',
                { className: 'wl-form' },
                h('div', { className: 'wl-field' }, h('label', null, t('document.title')), h(LibraryInput, { required: true, maxLength: 200, value: draft.title, onChange: event => patch({ title: event.target.value }) })),
                h(
                  'div',
                  { className: 'wl-field-row' },
                  h(
                    'div',
                    { className: 'wl-field' },
                    h('label', null, t('document.slot')),
                    h('select', { value: draft.slotKey, onChange: event => patch({ slotKey: event.target.value }) }, SLOTS.map(([key, label]) => h('option', { key, value: key }, label))),
                  ),
                  h('div', { className: 'wl-field' }, h('label', null, t('document.tags')), h(LibraryInput, { maxLength: 400, placeholder: t('document.tagsHint'), value: draft.tags, onChange: event => patch({ tags: event.target.value }) })),
                ),
              ),
            )
          : null,
        h(LibraryCard,
          { className: 'wl-card' },
          h(
            'div',
            { className: 'wl-form' },
            h(
              'div',
              { className: 'wl-seg', role: 'group', 'aria-label': t('document.content') },
              [['file', t('editor.modeFile')], ['text', t('editor.modeText')]].map(([value, label]) =>
                h(LibraryButton,
                  { key: value, type: 'button', className: 'wl-seg-btn', 'aria-pressed': mode === value, onClick: () => setMode(value) },
                  label,
                ),
              ),
            ),
            mode === 'file'
              ? [
                  h(
                    'div',
                    { key: 'file', className: 'wl-field' },
                    h('label', null, t('file.choose')),
                    h(LibraryInput, {
                      type: 'file',
                      disabled: busy,
                      onChange: event => {
                        setFile(event.target.files?.[0] || null);
                      },
                    }),
                    h('p', { className: 'wl-help' }, file ? `${file.name} · ${formatBytes(file.size)}` : t('file.none')),
                    h('p', { className: 'wl-help' }, t('editor.attachHint')),
                  ),
                ]
              : [
                  h(
                    'div',
                    { key: 'name', className: 'wl-field' },
                    h('label', null, t('document.fileName')),
                    h(LibraryInput, { maxLength: 200, placeholder: '资料说明.txt', value: draft.fileName, onChange: event => patch({ fileName: event.target.value }) }),
                  ),
                  h(
                    'div',
                    { key: 'content', className: 'wl-field' },
                    h('label', null, `${t('document.content')} (${t('editor.required')})`),
                    h(LibraryTextArea, { required: mode === 'text', rows: 10, maxLength: 20000, value: draft.content, onChange: event => patch({ content: event.target.value }) }),
                  ),
                ],
          ),
        ),
        showCertificate
          ? h(LibraryCard,
              { className: 'wl-card' },
              h('div', { className: 'wl-card-head' }, h('h3', null, t('document.certificate'))),
              h('p', { className: 'wl-help' }, t('cert.hint')),
              h(
                'div',
                { className: 'wl-form' },
                h(
                  'div',
                  { className: 'wl-field-row' },
                  h('div', { className: 'wl-field' }, h('label', null, t('cert.number')), h(LibraryInput, { maxLength: 200, value: draft.certificate.number, onChange: event => patch({ certificate: { ...draft.certificate, number: event.target.value } }) })),
                  h('div', { className: 'wl-field' }, h('label', null, t('cert.issuer')), h(LibraryInput, { maxLength: 200, value: draft.certificate.issuer, onChange: event => patch({ certificate: { ...draft.certificate, issuer: event.target.value } }) })),
                ),
                h('div', { className: 'wl-field' }, h('label', null, t('cert.scope')), h(LibraryInput, { maxLength: 500, value: draft.certificate.scope, onChange: event => patch({ certificate: { ...draft.certificate, scope: event.target.value } }) })),
                h(
                  'div',
                  { className: 'wl-field-row' },
                  h(
                    'div',
                    { className: 'wl-field' },
                    h('label', null, t('cert.expiryMode')),
                    h(
                      'select',
                      { value: draft.certificate.expiryMode, onChange: event => patch({ certificate: { ...draft.certificate, expiryMode: event.target.value } }) },
                      h('option', { value: 'unknown' }, t('cert.unknown')),
                      h('option', { value: 'dated' }, t('cert.dated')),
                      h('option', { value: 'no_expiry' }, t('cert.no_expiry')),
                    ),
                  ),
                  h('div', { className: 'wl-field' }, h('label', null, t('cert.validFrom')), h(LibraryInput, { type: 'date', value: draft.certificate.validFrom || '', onChange: event => patch({ certificate: { ...draft.certificate, validFrom: event.target.value } }) })),
                  h('div', { className: 'wl-field' }, h('label', null, t('cert.validUntil')), h(LibraryInput, { type: 'date', value: draft.certificate.validUntil || '', onChange: event => patch({ certificate: { ...draft.certificate, validUntil: event.target.value } }) })),
                ),
                h('div', { className: 'wl-field' }, h('label', null, t('cert.expiryNote')), h(LibraryInput, { maxLength: 500, value: draft.certificate.expiryNote, onChange: event => patch({ certificate: { ...draft.certificate, expiryNote: event.target.value } }) })),
              ),
            )
          : null,
        h(ErrorNote, { error, t }),
        h(
          'div',
          { className: 'wl-form-actions' },
          h(LibraryButton, { type: 'button', className: 'wl-btn', disabled: busy, onClick: async () => { if (!versionMode || !onDirtyChange || !dirty || await (ui?.confirmDiscard?.() ?? window.confirm('放弃尚未保存的修改？'))) onCancel(); } }, t('action.cancel')),
          h(LibraryButton, { type: 'submit', className: 'wl-btn primary', disabled: busy || (creating && !draft.title.trim()) || (mode === 'file' ? !file : !draft.content.trim()) }, busy ? t('editor.saving') : creating ? t('editor.saveDocument') : t('editor.saveVersion')),
        ),
      );
    }

    function ProductEditorSurface({ productId, onClose, onSaved, onDirtyChange, onBusy }) {
      const [data, setData] = useState(null), [error, setError] = useState(null);
      useEffect(() => {
        let active = true;
        Promise.all([productId ? api.product(productId) : Promise.resolve(null), api.documents({ limit: 200 })])
          .then(([result, documents]) => { if (active) setData({ product: result?.product, documents: documents.items }); })
          .catch(cause => { if (active) setError(cause); });
        return () => { active = false; };
      }, [productId]);
      const terms = { 'product.name': '商品名称', 'product.description': '商品描述', 'image.title': '商品图片', 'image.saveFirst': '先保存商品，再上传图片。', 'editor.saveProduct': '保存商品' };
      const t = key => terms[key] || zh[key] || key;
      return h('div', { className: 'wl-admin-surface', style: { '--wl-accent': '#303030', '--wl-accent-ink': '#fff' } },
        h('style', null, styles),
        error ? h(ErrorNote, { error, t }) : data ? h(ProductEditor, { key: productId || 'new', t, product: data.product,
          documents: data.documents, admin: true, onCancel: onClose, onSaved, onDirtyChange, onBusy }) : h('p', { role: 'status' }, '正在读取商品资料…'));
    }

    function FileSurface({ documentId, creating = false, onClose, onSaved, onDirtyChange, onBusy }) {
      const [versionDocument, setVersionDocument] = useState(null), [revision, refresh] = useState(0);
      const t = key => zh[key] || key;
      return h('div', { className: 'wl-admin-surface wl-admin-file' }, h('style', null, styles),
        creating || versionDocument ? h(DocumentEditor, { t, document: versionDocument, versionMode: !!versionDocument,
          onDirtyChange, onBusy, onCancel: () => { if (versionDocument) setVersionDocument(null); else onClose(); },
          onSaved: async id => { setVersionDocument(null); refresh(v => v + 1); onDirtyChange?.(false); onSaved?.(id); } })
          : h(DocumentDetail, { key: `${documentId}:${revision}`, t, id: documentId, onDirtyChange, onBusy, admin: true,
            onAddVersion: document => setVersionDocument(document), onChanged: async () => { refresh(v => v + 1); onSaved?.(documentId); } }));
    }
    function CompanySettingsSurface({ onDirtyChange, onBusy, onSaved }) {
      const resource = useAsync(() => api.company(), []), t = key => zh[key] || key;
      return h('div', { className: 'wl-admin-surface wl-admin-company' }, h('style', null, styles),
        resource.phase === 'loading' ? h(Loading, { label: '正在读取店铺信息…' })
          : resource.phase === 'error' ? h(ErrorNote, { error: resource.error, onRetry: resource.reload, t })
          : h(CompanyCard, { t, company: resource.value, onDirtyChange, onBusy,
            onSaved: async () => { onDirtyChange?.(false); await resource.reload(); onSaved?.(); } }));
    }

    // ---------------------------------------------------------------------
    // Plugin

    const inject = ['slots', 'locale', 'inputTriggers', 'uiSession'];

    // The native composer owns chips, draft persistence, cancellation and final user-message logging.
    function createReferenceSource(t) {
      const pinOf = value => {
        const row = typeof value === 'string' ? JSON.parse(value) : value;
        if (!row || typeof row.documentId !== 'string' || !/^doc_[a-f0-9-]{36}$/u.test(row.documentId)
          || !Number.isSafeInteger(row.version) || row.version < 1 || typeof row.sha256 !== 'string'
          || !/^[a-f0-9]{64}$/u.test(row.sha256)) throw new Error(t('error.generic'));
        return { documentId: row.documentId, version: row.version, sha256: row.sha256 };
      };
      return {
        trigger: '@', name: 'workspace-library', order: -10, showGroupTitle: false,
        async candidates(_session, { query, signal }) {
          const result = await request(`/references${queryString({ q: query, limit: 50 })}`, { signal });
          return result.items.map(item => ({
            name: `${item.title} v${item.version}`, label: `${item.title} · v${item.version}`,
            description: `${item.fileName} · ${t(`document.review.${item.reviewState}`)}`,
            section: t('reference.group'), icon: 'file',
            value: JSON.stringify({ pin: pinOf(item), label: `${item.title} · v${item.version}` }),
          }));
        },
        onPick({ candidate }) {
          const selected = JSON.parse(candidate.value);
          const pin = pinOf(selected.pin);
          const ref = JSON.stringify(pin);
          return { insert: { source: 'workspace-library', ref, label: selected.label, appearance: 'file', clipboardText: `@library:${pin.documentId}:v${pin.version}` } };
        },
        codec: {
          clipboardText(ref) { const pin = pinOf(ref); return `@library:${pin.documentId}:v${pin.version}`; },
          async serialize(ref, signal) {
            const pin = pinOf(ref);
            await request('/references/check', { method: 'POST', body: JSON.stringify({ references: [pin] }), signal });
            return `[workspace_library_reference ${JSON.stringify(pin)}; read with workspace_library_references before using its contents]`;
          },
        },
      };
    }

    function ReferenceButton({ t, inputActions, useInput, openLibraryReferences }) {
      const input = useInput(value => value);
      return h(LibraryButton, {
        type: 'button', title: t('reference.hint'),
        disabled: input.phase !== 'plain',
        onMouseDown: event => event.preventDefault(),
        onClick: () => {
          const span = inputActions.captureInsertion();
          openLibraryReferences({ span, position: input.draft.slice(0, span.start).trim() === '' ? 'leading' : 'inline' });
        },
        style: { background: 'transparent', color: 'var(--dsw-alias-label-secondary)', border: '1px solid var(--dsw-alias-border-main)', borderRadius: '8px', padding: '3px 8px', fontSize: '12px', cursor: 'pointer' },
      }, t('reference.insert'));
    }

    function apply(ctx) {
      ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'workspace-library: dictionaries');
      const t = ctx.locale.bind(NS);
      ctx.effect(() => ctx.inputTriggers.registerSource(createReferenceSource(t)), 'workspace-library: native document references');
      ctx.effect(() => ctx.uiSession.provide({
        props: ['openLibraryReferences'],
        resolve: binding => ({ props: {
          openLibraryReferences: ({ span, position }) => ctx.inputTriggers.sessionOf(binding.ctx).toggleSource('workspace-library', {
            trigger: '@', query: '', quoted: false, position, span,
          }),
        } }),
      }), 'workspace-library: native reference launcher');
      ctx.effect(() => ctx.slots.inject('conversation.input.left', () =>
        ctx.slots.register({ name: 'conversation.input.left', id: 'workspace-library', order: -10, locale: NS }, ReferenceButton)),
      'workspace-library: composer reference action');

      ctx.effect(() => ctx.slots.inject('sidebar.panellist', () =>
        ctx.slots.register({ name: 'sidebar.panellist', id: PANEL_ID, order: 30, locale: NS, label: () => t('panel') }, LibraryIcon)),
      'workspace-library: sidebar');
      ctx.effect(() => ctx.slots.inject('main', () =>
        ctx.slots.register({ name: 'main', key: PANEL_ID, locale: NS }, LibraryPanel)),
      'workspace-library: panel');
    }

    return { apply, inject, createReferenceSource, ProductEditorSurface: withSurfaceUI(ProductEditorSurface), FileSurface: withSurfaceUI(FileSurface), CompanySettingsSurface: withSurfaceUI(CompanySettingsSurface) };
  },
});
