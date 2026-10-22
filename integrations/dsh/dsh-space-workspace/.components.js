    function TaskModal({ t, presetTitle = '', onClose, onCreated, toast }) {
      const [draft, setDraft] = useState({ title: presetTitle, goal: '', frequency: 'daily' });
      const [busy, setBusy] = useState(false);

      async function submit(event) {
        event.preventDefault();
        if (!draft.title.trim() || busy) return;
        setBusy(true);
        try {
          await api.createTask({ title: draft.title.trim(), goal: draft.goal, frequency: draft.frequency });
          toast(t('save.saved'));
          onCreated();
        } catch (error) {
          toast(error.message || t('toast.error'));
        } finally {
          setBusy(false);
        }
      }

      return h(
        'div',
        { className: 'sp-modal-backdrop', onClick: event => { if (event.target === event.currentTarget) onClose(); } },
        h(
          'form',
          { className: 'sp-modal', onSubmit: submit },
          h('h2', null, t('task.modal.title')),
          h('label', null, t('task.title'), h('input', { value: draft.title, maxLength: 200, placeholder: t('task.title'), onChange: event => setDraft({ ...draft, title: event.target.value }) })),
          h('label', null, t('task.goal'), h('textarea', { rows: 3, value: draft.goal, maxLength: 4000, placeholder: t('task.goal'), onChange: event => setDraft({ ...draft, goal: event.target.value }) })),
          h(
            'label',
            null,
            t('task.frequency'),
            h(
              'select',
              { value: draft.frequency, onChange: event => setDraft({ ...draft, frequency: event.target.value }) },
              h('option', { value: 'once' }, t('task.freq.once')),
              h('option', { value: 'hourly' }, t('task.freq.hourly')),
              h('option', { value: 'daily' }, t('task.freq.daily')),
              h('option', { value: 'weekly' }, t('task.freq.weekly')),
            ),
          ),
          h(
            'div',
            { className: 'sp-modal-actions' },
            h('button', { type: 'button', className: 'sp-btn', onClick: onClose }, t('task.cancel')),
            h('button', { type: 'submit', className: 'sp-btn dark', disabled: busy || !draft.title.trim() }, busy ? t('save.saving') : t('task.save')),
          ),
        ),
      );
    }

    function ScheduledView({ t, tasks, openSignal = 0, onChanged, toast }) {
      const [modal, setModal] = useState(null);
      const [lastSignal, setLastSignal] = useState(openSignal);
      if (openSignal !== lastSignal) {
        setLastSignal(openSignal);
        setModal({ title: '' });
      }

      async function setStatus(task, status) {
        try {
          await api.updateTask(task.id, status);
          await onChanged();
        } catch (error) {
          toast(error.message || t('toast.error'));
        }
      }

      return h(
        'div',
        null,
        h(
          'div',
          { className: 'sp-sched-head' },
          h(Icon, { name: 'clock', size: 22 }),
          h('h2', null, t('scheduled.cta')),
          h('p', null, t('scheduled.desc')),
          h('button', { type: 'button', className: 'sp-btn dark', onClick: () => setModal({ title: '' }) }, h(Icon, { name: 'plus', size: 14 }), t('task.new')),
        ),
        tasks.length
          ? h(
              'div',
              { className: 'sp-task-list' },
              tasks.map(task =>
                h(
                  'div',
                  { key: task.id, className: 'sp-task-row' },
                  h(
                    'div',
                    { className: 'sp-task-info' },
                    h('strong', null, task.title),
                    h('small', null, `${task.frequency === 'weekly' ? t('task.freq.weekly') : task.frequency === 'hourly' ? t('task.freq.hourly') : task.frequency === 'once' ? t('task.freq.once') : t('task.freq.daily')} · ${t(`task.status.${task.status}`)}`),
                  ),
                  task.status === 'completed'
                    ? h('span', { className: 'sp-tag' }, t('task.status.completed'))
                    : h(
                        'button',
                        { type: 'button', className: 'sp-btn small', onClick: () => void setStatus(task, task.status === 'paused' ? 'active' : 'paused') },
                        task.status === 'paused' ? t('task.resume') : t('task.pause'),
                      ),
                ),
              ),
            )
          : null,
        h(
          'div',
          { className: 'sp-sched-grid' },
          [t('scheduled.t1'), t('scheduled.t2'), t('scheduled.t3'), t('scheduled.t4'), t('scheduled.t5'), t('scheduled.t6')].map(label =>
            h(
              'button',
              { key: label, type: 'button', className: 'sp-sched-card', onClick: () => setModal({ title: label }) },
              h('strong', null, label),
              h('p', null, t('scheduled.cardHint')),
            ),
          ),
        ),
        modal
          ? h(TaskModal, {
              t,
              presetTitle: modal.title,
              toast,
              onClose: () => setModal(null),
              onCreated: async () => {
                setModal(null);
                await onChanged();
              },
            })
          : null,
      );
    }

    function DocumentView({ t, item, onClose, onUpdated, toast }) {
      const isPage = item.kind === 'page';
      const [draft, setDraft] = useState({ title: item.title, body: item.body || '' });
      const [dirty, setDirty] = useState(false);
      const [saving, setSaving] = useState(false);
      const [shareOpen, setShareOpen] = useState(false);
      const [commentsOpen, setCommentsOpen] = useState(false);
      const [comment, setComment] = useState('');
      const [message, setMessage] = useState('');
      const messageRef = useRef(null);

      useEffect(() => {
        setDraft({ title: item.title, body: item.body || '' });
        setDirty(false);
        setShareOpen(false);
        setCommentsOpen(false);
      }, [item.id]);

      async function save() {
        if (!dirty || saving) return item;
        setSaving(true);
        try {
          const updated = await api.updateItem(item.id, { title: draft.title, body: draft.body });
          setDirty(false);
          onUpdated(updated);
          return updated;
        } catch (error) {
          toast(error.message || t('toast.error'));
          return item;
        } finally {
          setSaving(false);
        }
      }

      async function toggleStar() {
        try {
          const updated = await api.updateItem(item.id, { starred: !item.starred });
          onUpdated(updated);
        } catch (error) {
          toast(error.message || t('toast.error'));
        }
      }

      async function setAccess(shared) {
        try {
          const updated = await api.updateItem(item.id, { shared });
          onUpdated(updated);
        } catch (error) {
          toast(error.message || t('toast.error'));
        }
      }

      async function copyLink() {
        const link = `${location.origin}/space/${item.id}`;
        try {
          if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(link);
          else throw new Error('clipboard');
          toast(t('share.copied'));
        } catch {
          toast(link);
        }
      }

      async function sendComment(event) {
        event.preventDefault();
        if (!comment.trim()) return;
        try {
          const updated = await api.addComment(item.id, comment.trim());
          setComment('');
          onUpdated(updated);
        } catch (error) {
          toast(error.message || t('toast.error'));
        }
      }

      async function sendMessage(event) {
        event.preventDefault();
        if (!message.trim()) return;
        try {
          const updated = await api.addMessage(item.id, message.trim());
          setMessage('');
          onUpdated(updated);
        } catch (error) {
          toast(error.message || t('toast.error'));
        }
      }

      function prefillAutomation() {
        setMessage('Pages  Manage the schedules for this page');
        messageRef.current?.focus();
      }

      return h(
        'div',
        { className: 'sp-doc-wrap' },
        h(
          'div',
          { className: 'sp-docpane' },
          h(
            'div',
            { className: 'sp-docbar' },
            h(
              'div',
              { className: 'sp-docpill' },
              h(Icon, { name: isPage ? 'page' : 'file', size: 15 }),
              h('strong', null, item.title),
              h('button', { type: 'button', className: `sp-icon-btn${item.starred ? ' starred' : ''}`, title: item.starred ? t('page.unstar') : t('page.star'), onClick: () => void toggleStar() }, h(Icon, { name: 'star', size: 15 })),
              isPage ? h('button', { type: 'button', className: 'sp-icon-btn', title: t('menu.space'), onClick: () => toast(t('toast.soon').replace('{name}', t('menu.space'))) }, h(Icon, { name: 'grid', size: 15 })) : null,
            ),
            h('span', { className: `sp-save-status${dirty ? ' dirty' : ''}` }, saving ? t('save.saving') : dirty ? t('save.dirty') : t('save.saved')),
            dirty ? h('button', { type: 'button', className: 'sp-btn small dark', onClick: () => void save() }, t('action.save', '保存')) : null,
            h(
              'div',
              { className: 'sp-docactions' },
              isPage ? h('button', { type: 'button', className: 'sp-icon-btn', title: t('page.automation'), onClick: prefillAutomation }, h(Icon, { name: 'clock', size: 16 })) : null,
              h('button', { type: 'button', className: 'sp-icon-btn', title: t('comment.title'), onClick: () => setCommentsOpen(open => !open) }, h(Icon, { name: 'message', size: 16 })),
              h(
                'div',
                { className: 'sp-share-wrap' },
                h('button', { type: 'button', className: 'sp-icon-btn', title: t('page.share'), onClick: () => setShareOpen(open => !open) }, h(Icon, { name: 'share', size: 16 })),
                shareOpen
                  ? h(
                      'div',
                      { className: 'sp-share' },
                      h('strong', null, t('share.title').replace('{name}', item.title)),
                      h('label', null, t('share.access'), h('select', { value: item.shared ? 'link' : 'invited', onChange: event => void setAccess(event.target.value === 'link') }, h('option', { value: 'invited' }, t('share.invited')), h('option', { value: 'link' }, t('share.link')))),
                      h('div', { className: 'sp-share-row' }, h('span', { className: 'sp-avatar small' }, 'U'), h('span', null, 'local'), h('em', null, t('share.owner'))),
                      h(
                        'div',
                        { className: 'sp-share-actions' },
                        h('button', { type: 'button', className: 'sp-btn small', onClick: () => void copyLink() }, t('share.copy')),
                        h('button', { type: 'button', className: 'sp-btn small dark', onClick: () => setShareOpen(false) }, t('share.done')),
                      ),
                    )
                  : null,
              ),
              h('button', { type: 'button', className: 'sp-icon-btn', title: t('page.close'), onClick: () => void save().then(() => onClose()) }, h(Icon, { name: 'close', size: 16 })),
            ),
          ),
          h(
            'div',
            { className: 'sp-doc' },
            h('div', { className: 'sp-doc-icon' }, h(Icon, { name: isPage ? 'page' : 'file', size: 20 })),
            h('input', {
              className: 'sp-doc-title-input',
              value: draft.title,
              maxLength: 200,
              'aria-label': t('document.title', '标题'),
              onChange: event => {
                setDraft({ ...draft, title: event.target.value });
                setDirty(true);
              },
              onBlur: () => void save(),
            }),
            isPage
              ? h('textarea', {
                  className: 'sp-doc-body-input',
                  value: draft.body,
                  maxLength: 20000,
                  placeholder: t('page.emptyBody'),
                  onChange: event => {
                    setDraft({ ...draft, body: event.target.value });
                    setDirty(true);
                  },
                  onBlur: () => void save(),
                })
              : h(
                  'dl',
                  { className: 'sp-meta-list' },
                  h('dt', null, t('item.type')),
                  h('dd', null, t(`item.${item.kind}`)),
                  item.meta?.size ? h('dt', null, t('item.size')) : null,
                  item.meta?.size ? h('dd', null, item.meta.size) : null,
                  h('dt', null, t('item.updated')),
                  h('dd', null, new Date(item.updatedAt).toLocaleString()),
                ),
            isPage
              ? h(
                  'div',
                  { className: 'sp-chat' },
                  item.messages.length
                    ? h('div', { className: 'sp-messages' }, item.messages.map(entry => h('div', { key: entry.id, className: 'sp-message' }, entry.text)))
                    : null,
                  h(
                    'form',
                    { className: 'sp-workform', onSubmit: sendMessage },
                    h(Icon, { name: 'plus', size: 16 }),
                    h('input', { ref: messageRef, value: message, placeholder: t('page.workPlaceholder'), onChange: event => setMessage(event.target.value) }),
                    h('button', { type: 'submit', className: 'sp-work-send', disabled: !message.trim(), title: t('comment.send') }, h(Icon, { name: 'arrow', size: 16 })),
                  ),
                )
              : null,
          ),
        ),
        commentsOpen
          ? h(
              'aside',
              { className: 'sp-comments' },
              h('div', { className: 'sp-comments-head' }, h('strong', null, t('comment.title')), h('span', null, String(item.comments.length))),
              item.comments.length
                ? h('div', { className: 'sp-comment-list' }, item.comments.map(entry => h('div', { key: entry.id, className: 'sp-comment' }, h('strong', null, entry.author), h('p', null, entry.text), h('small', null, new Date(entry.at).toLocaleString()))))
                : h('p', { className: 'sp-help' }, t('comment.empty')),
              h(
                'form',
                { className: 'sp-comment-form', onSubmit: sendComment },
                h('input', { value: comment, placeholder: t('comment.placeholder'), onChange: event => setComment(event.target.value) }),
                h('button', { type: 'submit', className: 'sp-btn small dark', disabled: !comment.trim() }, t('comment.send')),
              ),
            )
          : null,
      );
    }

