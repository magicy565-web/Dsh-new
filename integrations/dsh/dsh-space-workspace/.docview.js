    function DocumentView({ t, item, onClose, onUpdated, onTrash, onOpenItem, toast }) {
      const isPage = item.kind === 'page';
      const isSite = item.kind === 'site';
      const [draft, setDraft] = useState({ title: item.title, body: item.body || '' });
      const [dirty, setDirty] = useState(false);
      const [saving, setSaving] = useState(false);
      const [shareOpen, setShareOpen] = useState(false);
      const [commentsOpen, setCommentsOpen] = useState(false);
      const [fileMenu, setFileMenu] = useState(false);
      const [insertMenu, setInsertMenu] = useState(false);
      const [info, setInfo] = useState(null);
      const [memberName, setMemberName] = useState('');
      const [comment, setComment] = useState('');
      const [message, setMessage] = useState('');
      const titleRef = useRef(null);
      const bodyRef = useRef(null);
      const messageRef = useRef(null);
      const imageInputRef = useRef(null);
      const fileInputRef = useRef(null);

      useEffect(() => {
        setDraft({ title: item.title, body: item.body || '' });
        setDirty(false);
        setShareOpen(false);
        setCommentsOpen(false);
        setFileMenu(false);
        setInsertMenu(false);
        setInfo(null);
      }, [item.id]);

      async function save() {
        if (!dirty || saving) return item;
        setSaving(true);
        try {
          const updated = await api.updateItem(item.id, { title: draft.title, body: draft.body });
          setDraft({ title: updated.title, body: updated.body || '' });
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

      async function patch(changes) {
        try {
          const updated = await api.updateItem(item.id, changes);
          onUpdated(updated);
          return updated;
        } catch (error) {
          toast(error.message || t('toast.error'));
          return null;
        }
      }

      function insertText(text) {
        const body = draft.body;
        const start = bodyRef.current ? bodyRef.current.selectionStart : body.length;
        const end = bodyRef.current ? bodyRef.current.selectionEnd : body.length;
        const next = `${body.slice(0, start)}${text}${body.slice(end)}`;
        setDraft({ ...draft, body: next });
        setDirty(true);
        requestAnimationFrame(() => {
          if (bodyRef.current) {
            const cursor = start + text.length;
            bodyRef.current.focus();
            bodyRef.current.setSelectionRange(cursor, cursor);
          }
        });
      }

      async function uploadInto(fileList, kind) {
        const files = Array.from(fileList || []);
        if (!files.length) return;
        for (const file of files) {
          try {
            const created = await api.createItem({
              kind,
              title: file.name,
              meta: { ext: (file.name.split('.').pop() || '').toLowerCase(), size: formatBytes(file.size), mime: file.type || '' },
            });
            insertText(kind === 'image' ? `![${file.name}](image:${created.id})\n` : `[${file.name}](file:${created.id})\n`);
          } catch (error) {
            toast(error.message || t('toast.error'));
          }
        }
      }

      function downloadMarkdown() {
        const source = `# ${draft.title}\n\n${draft.body}`;
        const blob = new Blob([source], { type: 'text/markdown;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = `${draft.title || 'page'}.md`;
        anchor.click();
        URL.revokeObjectURL(url);
        setFileMenu(false);
      }

      async function toggleStar() {
        await patch({ starred: !item.starred });
      }

      async function setAccess(shared) {
        await patch({ shared });
      }

      async function addMember(event) {
        event.preventDefault();
        if (!memberName.trim()) return;
        try {
          const updated = await api.addMember(item.id, memberName.trim());
          setMemberName('');
          onUpdated(updated);
        } catch (error) {
          toast(error.message || t('toast.error'));
        }
      }

      async function copyLink() {
        const link = `${location.origin}${location.pathname}#space/${item.id}`;
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

      async function createSubpage() {
        setInsertMenu(false);
        try {
          const created = await api.createItem({ kind: 'page', title: '子页面', parentId: item.id });
          onOpenItem(created);
        } catch (error) {
          toast(error.message || t('toast.error'));
        }
      }

      const fileItems = [
        ['menu.show', () => { setFileMenu(false); titleRef.current?.focus(); }],
        ['menu.rename', () => { setFileMenu(false); titleRef.current?.focus(); titleRef.current?.select(); }],
        [`menu.${item.pinned ? 'unpin' : 'pin'}`, () => { setFileMenu(false); void patch({ pinned: !item.pinned }); }],
        ['menu.delete', () => { setFileMenu(false); onTrash(item); }],
        ['page.share', () => { setFileMenu(false); setShareOpen(true); }],
        ['menu.copyMarkdown', downloadMarkdown],
        ['menu.editors', () => { setFileMenu(false); setInfo('editors'); }],
        ['menu.activity', () => { setFileMenu(false); setInfo('activity'); }],
      ];

      const insertItems = [
        ['generate', t('insert.generate'), t('insert.generateHint'), 'star', () => { setInsertMenu(false); setMessage(t('insert.generateHint')); messageRef.current?.focus(); }],
        ['visual', t('insert.visual'), t('insert.visualHint'), 'grid', () => { setInsertMenu(false); toast(t('toast.soon').replace('{name}', t('insert.visual'))); }],
        ['subpage', t('insert.subpage'), t('insert.subpageHint'), 'page', createSubpage],
        ['image', t('insert.image'), t('insert.imageHint'), 'image', () => { setInsertMenu(false); imageInputRef.current?.click(); }],
        ['file', t('insert.file'), t('insert.fileHint'), 'file', () => { setInsertMenu(false); fileInputRef.current?.click(); }],
        ['heading', t('insert.heading'), '', 'page', () => { setInsertMenu(false); insertText('\n## 标题\n'); }],
        ['list', t('insert.list'), '', 'list', () => { setInsertMenu(false); insertText('\n- 列表项\n'); }],
        ['todo', t('insert.todo'), '', 'check', () => { setInsertMenu(false); insertText('\n- [ ] 待办事项\n'); }],
        ['divider', t('insert.divider'), '', 'menu', () => { setInsertMenu(false); insertText('\n---\n'); }],
        ['code', t('insert.code'), '', 'file', () => { setInsertMenu(false); insertText('\n```\n\n```\n'); }],
      ];

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
              h(Icon, { name: isPage ? 'page' : isSite ? 'site' : 'file', size: 15 }),
              h(
                'button',
                { type: 'button', className: 'sp-doc-title-btn', onClick: () => setFileMenu(open => !open) },
                h('strong', null, item.title),
                h(Icon, { name: 'chevron', size: 13 }),
              ),
              h('button', { type: 'button', className: `sp-icon-btn${item.starred ? ' starred' : ''}`, title: item.starred ? t('page.unstar') : t('page.star'), onClick: () => void toggleStar() }, h(Icon, { name: 'star', size: 15 })),
              isPage ? h('button', { type: 'button', className: 'sp-icon-btn', title: t('menu.insert'), onClick: () => setInsertMenu(open => !open) }, h(Icon, { name: 'plus', size: 15 })) : null,
            ),
            fileMenu
              ? h(
                  'div',
                  { className: 'sp-filemenu' },
                  fileItems.map(([key, action]) => h('button', { key, type: 'button', onClick: action }, t(key))),
                )
              : null,
            insertMenu
              ? h(
                  'div',
                  { className: 'sp-insert' },
                  ['generate', 'create', 'media', 'basic'].map((group, groupIndex) =>
                    h(
                      'div',
                      { key: group, className: 'sp-insert-group' },
                      h('div', { className: 'sp-insert-label' }, t(`insert.${group}`)),
                      insertItems
                        .filter((_, index) => (groupIndex === 0 ? index < 2 : groupIndex === 1 ? index === 2 : groupIndex === 2 ? index === 3 || index === 4 : index > 4))
                        .map(([key, label, hint, icon, action]) =>
                          h(
                            'button',
                            { key, type: 'button', className: 'sp-insert-item', onClick: action },
                            h(Icon, { name: icon, size: 15 }),
                            h('span', null, h('strong', null, label), hint ? h('small', null, hint) : null),
                          ),
                        ),
                    ),
                  ),
                )
              : null,
            h('span', { className: `sp-save-status${dirty ? ' dirty' : ''}` }, saving ? t('save.saving') : dirty ? t('save.dirty') : t('save.saved')),
            dirty ? h('button', { type: 'button', className: 'sp-btn small dark', onClick: () => void save() }, t('action.save')) : null,
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
                      h(
                        'form',
                        { className: 'sp-member-form', onSubmit: addMember },
                        h('input', { value: memberName, placeholder: t('share.addMember'), onChange: event => setMemberName(event.target.value) }),
                        h('button', { type: 'submit', className: 'sp-btn small dark', disabled: !memberName.trim() }, t('share.addMember')),
                      ),
                      h(
                        'div',
                        { className: 'sp-members' },
                        h('div', { className: 'sp-share-row' }, h('span', { className: 'sp-avatar small' }, 'U'), h('span', null, 'local'), h('em', null, t('share.owner'))),
                        item.members.map(member => h('div', { key: member.id, className: 'sp-share-row' }, h('span', { className: 'sp-avatar small' }, member.name.slice(0, 1).toUpperCase()), h('span', null, member.name), h('em', null, t('share.member', '成员')))),
                      ),
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
            h('div', { className: 'sp-doc-icon' }, h(Icon, { name: isPage ? 'page' : isSite ? 'site' : 'file', size: 20 })),
            h('input', {
              ref: titleRef,
              className: 'sp-doc-title-input',
              value: draft.title,
              maxLength: 200,
              'aria-label': t('document.title'),
              onChange: event => {
                setDraft({ ...draft, title: event.target.value });
                setDirty(true);
              },
              onBlur: () => void save(),
            }),
            isPage
              ? h('textarea', {
                  ref: bodyRef,
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
                  isSite ? h('dt', null, t('site.shared')) : null,
                  isSite ? h('dd', null, item.meta?.visibility || t('site.self')) : null,
                  h('dt', null, t('item.updated')),
                  h('dd', null, new Date(item.updatedAt).toLocaleString()),
                ),
            isSite
              ? h(
                  'div',
                  { className: 'sp-terms' },
                  h('strong', null, t('site.terms')),
                  h('p', null, t('site.termsHint')),
                  h('ul', null, h('li', null, '你需对自己的网站以及访客提交的任何内容负责'), h('li', null, '如收集个人数据，请了解应承担的责任'), h('li', null, '平台可能会移除违反政策的网站')),
                  h('button', { type: 'button', className: 'sp-btn small', onClick: () => toast(t('site.termsRead')) }, t('site.termsRead')),
                  h('button', { type: 'button', className: 'sp-btn small dark', onClick: () => toast(t('site.termsContinue')) }, t('site.termsContinue')),
                )
              : null,
            isPage
              ? h(
                  'div',
                  { className: 'sp-chat' },
                  item.messages.length ? h('div', { className: 'sp-messages' }, item.messages.map(entry => h('div', { key: entry.id, className: 'sp-message' }, entry.text))) : null,
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
          info
            ? h(
                'div',
                { className: 'sp-info' },
                h('strong', null, info === 'editors' ? t('menu.editors') : t('menu.activity')),
                info === 'editors'
                  ? h('div', null, h('p', null, '本地用户 · 所有者'), h('p', null, `${t('item.updated')} ${new Date(item.updatedAt).toLocaleString()}`))
                  : item.comments.length || item.messages.length
                    ? h('div', null, item.comments.map(entry => h('p', { key: entry.id }, `评论 · ${entry.text}`)), item.messages.map(entry => h('p', { key: entry.id }, `聊天 · ${entry.text}`)))
                    : h('p', { className: 'sp-help' }, t('comment.empty')),
                h('button', { type: 'button', className: 'sp-btn small', onClick: () => setInfo(null) }, t('share.done')),
              )
            : null,
          h('input', { type: 'file', accept: 'image/*', multiple: true, ref: imageInputRef, style: { display: 'none' }, onChange: event => { const files = event.target.files; event.target.value = ''; void uploadInto(files, 'image'); } }),
          h('input', { type: 'file', multiple: true, ref: fileInputRef, style: { display: 'none' }, onChange: event => { const files = event.target.files; event.target.value = ''; void uploadInto(files, 'file'); } }),
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

