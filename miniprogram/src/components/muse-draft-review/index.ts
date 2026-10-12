import { DraftReview, draftPresentation } from '../../shared/muse-draft-view';
import type { DraftPresentation } from '../../shared/muse-draft-view';
const reviews = new WeakMap<object, DraftReview>();
const controller = (component: object) => { let review = reviews.get(component); if (!review) { review = new DraftReview(); reviews.set(component, review); } return review; };
Component({
  options: { styleIsolation: 'shared' },
  properties: {
    draft: { type: Object, value: null, observer(raw: WechatMiniprogram.IAnyObject) {
      const value = raw as DraftPresentation | null;
      const review = controller(this);
      if (!value) { review.close(); this.setData({ view: null, budgetConfirmed: false, deadlineConfirmed: false, publicConfirmed: false, error: '' }); return; }
      const current = review.value;
      if (!current || current.draftHash !== value.draftHash || current.revision !== value.revision || current.id !== value.id || current.conversationId !== value.conversationId || current.phase !== value.phase) {
        review.open(value); this.setData({ budgetConfirmed: false, deadlineConfirmed: false, publicConfirmed: false, error: '' });
      }
      this.setData({ view: draftPresentation(value) });
    } },
    busy: { type: Boolean, value: false },
    uncertain: { type: Boolean, value: false },
    serverError: { type: String, value: '' },
  },
  data: { view: null as ReturnType<typeof draftPresentation> | null, budgetConfirmed: false, deadlineConfirmed: false, publicConfirmed: false, error: '' },
  methods: {
    consent(event: WechatMiniprogram.CheckboxGroupChange) {
      if (this.data.busy || this.data.uncertain) return;
      const review = controller(this); review.confirm(event.detail.value);
      this.setData({ budgetConfirmed: review.budgetConfirmed, deadlineConfirmed: review.deadlineConfirmed, publicConfirmed: review.publicDataConfirmed, error: '' });
    },
    prepare() {
      if (this.data.busy || this.data.uncertain || !this.data.view) return;
      try { const target = controller(this).validate(this.data.view); this.triggerEvent('prepare', { ...target, budgetConfirmed: true, deadlineConfirmed: true, publicDataConfirmed: true }); }
      catch (error) { this.setData({ error: error instanceof Error ? error.message : '请重新核对草案范围。' }); }
    },
    edit() { if (!this.data.busy && !this.data.uncertain && this.data.view) { const target = this.data.view; controller(this).close(); this.triggerEvent('edit', { id: target.id, revision: target.revision, draftHash: target.draftHash }); } },
    reject() { if (!this.data.busy && !this.data.uncertain && this.data.view) this.triggerEvent('reject', { id: this.data.view.id, revision: this.data.view.revision, draftHash: this.data.view.draftHash }); },
    close() { if (!this.data.busy) { controller(this).close(); this.setData({ budgetConfirmed: false, deadlineConfirmed: false, publicConfirmed: false }); this.triggerEvent('close'); } },
  },
});
