import { presentSupplierPreview } from '../../shared/supplier-view';
import type { SupplierPreview } from '../../shared/supplier-view';
Component({
  options: { styleIsolation: 'shared' },
  properties: {
    preview: { type: Object, value: null, observer(raw: WechatMiniprogram.IAnyObject) {
      if (!raw) { this.setData({ view: null, error: '' }); return; }
      try { this.setData({ view: presentSupplierPreview(raw as SupplierPreview), error: '' }); }
      catch (error) { this.setData({ view: null, error: error instanceof Error ? error.message : '原商品预览无法读取。' }); }
    } },
  },
  data: { view: null as ReturnType<typeof presentSupplierPreview> | null, error: '' },
});
