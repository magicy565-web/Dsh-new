import { listingFieldText, publicListingFields, supplierFieldLabels } from '../../shared/supplier-view';
import type { SupplierProfile, PublicListingField } from '../../shared/supplier-view';
type Scope = { id: string; revision: number; profile: SupplierProfile };
const currentScopes = new WeakMap<object, string>();
Component({
  options: { styleIsolation: 'shared' },
  properties: {
    scope: { type: Object, value: null, observer(raw: WechatMiniprogram.IAnyObject) {
      const scope = raw as Scope | null;
      if (!scope) { currentScopes.delete(this); this.setData({ target: null, fields: [], selected: [], error: '' }); return; }
      if (!scope.id || !Number.isInteger(scope.revision) || scope.revision < 1 || !scope.profile || !Array.isArray(scope.profile.images)) { this.setData({ target: null, fields: [], selected: [], error: '原商品范围无法核对，请重新读取。' }); return; }
      const identity = JSON.stringify(scope);
      if (identity !== currentScopes.get(this)) { currentScopes.set(this, identity); this.setData({ selected: [], error: '' }); }
      this.setData({ target: scope, fields: publicListingFields.map(field => ({ field, label: supplierFieldLabels[field], content: listingFieldText(scope.profile, field), checked: this.data.selected.includes(field) })) });
    } },
    busy: { type: Boolean, value: false }, uncertain: { type: Boolean, value: false }, serverError: { type: String, value: '' },
  },
  data: { target: null as Scope | null, fields: [] as { field: PublicListingField; label: string; content: string; checked: boolean }[], selected: [] as PublicListingField[], error: '' },
  methods: {
    select(event: WechatMiniprogram.CheckboxGroupChange) {
      if (this.data.busy || this.data.uncertain || !this.data.target) return;
      const selected = publicListingFields.filter(field => event.detail.value.includes(field));
      this.setData({ selected, fields: this.data.fields.map(item => ({ ...item, checked: selected.includes(item.field) })), error: '' });
    },
    confirm() {
      if (this.data.busy || this.data.uncertain || !this.data.target) return;
      if (!this.data.selected.length) { this.setData({ error: '请选择本次商品预览包含的准确字段。' }); return; }
      this.triggerEvent('preview', { id: this.data.target.id, expectedRevision: this.data.target.revision, confirmed: true, publicFields: [...this.data.selected] });
    },
    close() { if (!this.data.busy) { currentScopes.delete(this); this.setData({ selected: [] }); this.triggerEvent('close'); } },
  },
});
