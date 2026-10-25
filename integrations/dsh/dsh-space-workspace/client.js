// Space workspace Client half — a ChatGPT-style Space surface.
//
// Renders the full shell (left rail, space sidebar, content column) inside one
// Harness main panel. Styling follows the reference design: monochrome, system
// font, thin borders, pill search and a black primary action.
window.__ModuleLoader__.load({
  id: 'dsh-space-workspace',
  factory(require) {
    const React = require('react');
    const h = React.createElement;
    const { useCallback, useEffect, useMemo, useRef, useState } = React;

    const NS = 'space-workspace';
    const API = '/space-api';
    const PANEL_ID = 'space';

    const zh = {
      'panel': '空间',
      'space': '空间',
      'newPage': '新建页面',
      'nav.all': '全部',
      'nav.pages': '页面',
      'nav.sites': '站点',
      'nav.images': '图像',
      'nav.drive': 'Google Drive',
      'nav.trash': '回收站',
      'label.recent': '最近',
      'label.expand': '展开显示',
      'label.space': '空间',
      'usage.title': '用量信息 · 示例',
      'usage.desc': '可在这里查看剩余额度与重置时间',
      'usage.add': '添加额度',
      'usage.upgrade': '升级',
      'search': '搜索',
      'new': '新建',
      'tabs.recommended': '推荐',
      'tabs.starred': '收藏',
      'tabs.mine': '你的内容',
      'tabs.shared': '与你共享',
      'tabs.all': '全部',
      'tabs.projects': '您的项目',
      'tabs.sharedPages': '与您共享',
      'start': '开始使用',
      'template.intro': '页面使用入门',
      'template.todo': '待办清单',
      'template.tracker': '项目跟踪表',
      'template.weekly': '每周更新',
      'table.name': '名称',
      'table.time': '上次活动时间',
      'view.filter': '筛选',
      'view.grid': '网格视图',
      'view.list': '列表视图',
      'empty.title': '这里还没有内容',
      'empty.hint': '用「新建」开始，或从模板创建一个页面。',
      'empty.trash': '回收站是空的',
      'empty.section': '这个空间还没有内容',
      'empty.search': '没有匹配的内容',
      'menu.page': '页面',
      'menu.presentation': '演示文稿',
      'menu.spreadsheet': '电子表格',
      'menu.site': '网站',
      'menu.image': '图像',
      'menu.folder': '文件夹',
      'menu.space': '空间',
      'menu.templates': '从模板开始',
      'menu.upload': '上传文件',
      'menu.plugins': '连接插件',
      'menu.soon': '即将推出',
      'page.star': '收藏',
      'page.unstar': '取消收藏',
      'page.share': '分享',
      'page.comment': '评论',
      'page.automation': '页面自动化',
      'page.workPlaceholder': '使用 ChatGPT Work',
      'page.close': '关闭',
      'page.emptyBody': '这是一个空页面。P1 将在这里提供编辑器。',
      'scheduled.title': '定时任务',
      'scheduled.new': '新建任务',
      'scheduled.upcoming': '即将执行',
      'scheduled.desc': 'ChatGPT 可以帮你处理持续性任务，让你无需亲力亲为。',
      'scheduled.cta': '安排任务',
      'scheduled.cardHint': '选择模板，为持续性工作设置时间与目标。',
      'scheduled.t1': 'Update me on the news',
      'scheduled.t2': '邮件监控',
      'scheduled.t3': 'Agent Workspace 研究雷达',
      'scheduled.t4': '每周膳食计划',
      'scheduled.t5': '每周更新财务状况',
      'scheduled.t6': '为出行查找航班',
      'scheduled.paused': '已暂停 · 示例',
      'scheduled.done': '已完成 · 示例',
      'toast.soon': '{name} 将在后续版本提供。',
      'toast.share': '分享弹窗将在 P2 提供。',
      'toast.comment': '评论将在 P2 提供。',
      'toast.automation': '页面自动化将在 P2 提供。',
      'toast.file': '文件预览将在 P4 提供。',
      'toast.filter': '筛选将在 P1 提供。',
      'toast.usage': '这是原型示例，不会产生费用。',
      'toast.error': '操作没有完成。',
      'toast.uploaded': '已添加 {count} 个文件。',
      'save.saving': '保存中…',
      'save.dirty': '未保存',
      'save.saved': '已保存',
      'action.save': '保存',
      'document.title': '页面标题',
      'share.title': '分享“{name}”',
      'share.access': '链接访问权限',
      'share.invited': '仅限受邀者',
      'share.link': '拥有链接的人',
      'share.copy': '复制链接',
      'share.done': '完成',
      'share.copied': '链接已复制。',
      'share.owner': '所有者',
      'share.addMember': '添加成员',
      'share.member': '成员',
      'comment.title': '评论',
      'comment.empty': '还没有评论。',
      'comment.placeholder': '写下评论…',
      'comment.send': '发送',
      'item.type': '类型',
      'item.size': '大小',
      'item.updated': '更新时间',
      'item.page': '页面',
      'item.file': '文件',
      'item.site': '站点',
      'item.image': '图像',
      'item.folder': '文件夹',
      'item.space': '空间',
      'item.drive': '云端文件',
      'task.modal.title': '新建任务',
      'task.title': '任务名称',
      'task.goal': '目标 / 提示',
      'task.frequency': '频率',
      'task.freq.once': '一次',
      'task.freq.hourly': '每小时',
      'task.freq.daily': '每天',
      'task.freq.weekly': '每周',
      'task.save': '创建任务',
      'task.cancel': '取消',
      'task.pause': '暂停',
      'task.resume': '恢复',
      'task.status.active': '进行中',
      'task.status.paused': '已暂停',
      'task.status.completed': '已完成',
      'task.new': '新建任务',
      'task.settings': '设置定时任务',
      'task.repeat': '重复',
      'task.time': '时间',
      'task.timezone': '时区',
      'task.end': '结束重复',
      'task.end.never': '永不',
      'task.end.date': '日期',
      'task.end.count': '次数',
      'task.advanced': '高级',
      'task.newChat': '每次运行时都开启新聊天',
      'task.repeat.hourly': '每小时',
      'task.repeat.daily': '每天',
      'task.repeat.weekdays': '工作日',
      'task.repeat.weekly': '每周',
      'task.repeat.monthly': '每月',
      'task.repeat.custom': '自定义',
      'task.toggle': '重复执行任务',
      'filter.title': '文件类型',
      'filter.all': '全部',
      'filter.page': '页面',
      'filter.image': '图像',
      'filter.doc': '文档',
      'filter.sheet': '电子表格',
      'filter.deck': '演示文稿',
      'filter.pdf': 'PDF 文件',
      'menu.show': '显示页面',
      'menu.rename': '重命名',
      'menu.pin': '置顶',
      'menu.unpin': '取消置顶',
      'menu.delete': '删除',
      'menu.copyMarkdown': '以 Markdown 格式下载',
      'menu.editors': '显示编辑者信息',
      'menu.activity': '页面动态',
      'menu.insert': '插入',
      'insert.generate': '生成',
      'insert.generateHint': '描述您想写的内容',
      'insert.visual': '可视化',
      'insert.visualHint': '创建交互式可视化内容',
      'insert.create': '创建',
      'insert.subpage': '页面',
      'insert.subpageHint': '在当前页面中创建子页面',
      'insert.media': '媒体',
      'insert.image': '图像',
      'insert.imageHint': '上传或生成图像',
      'insert.file': '文件',
      'insert.fileHint': '上传文件以供下载',
      'insert.basic': '基础',
      'insert.heading': '标题',
      'insert.list': '列表',
      'insert.todo': '待办',
      'insert.divider': '分割线',
      'insert.code': '代码',
      'insert.agent': '智能体说明',
      'insert.agentHint': '为页面添加智能体说明',
      'insert.h1': '标题 1',
      'insert.h2': '标题 2',
      'insert.h3': '标题 3',
      'insert.numbered': '编号列表',
      'insert.quote': '引用',
      'insert.table': '表格',
      'insert.linkPage': '链接到页面',
      'insert.callout': '提示',
      'insert.highlight': '高亮块',
      'menu.copy': '复制',
      'label.collapse': '收起',
      'share.invitedHint': '已有访问权限的用户可以使用此链接',
      'share.members': '谁有访问权限',
      'share.exampleUser': '示例用户',
      'task.custom': '自定义重复',
      'task.customHint': '例如：每两周的周一',
      'block.paragraph': '正文',
      'block.h1': '标题 1',
      'block.h2': '标题 2',
      'block.h3': '标题 3',
      'block.bulleted': '列表',
      'block.numbered': '编号列表',
      'block.todo': '待办',
      'block.quote': '引用',
      'block.code': '代码',
      'block.callout': '提示',
      'block.highlight': '高亮',
      'block.table': '表格',
      'block.divider': '分割线',
      'block.add': '添加块',
      'block.menu': '块菜单',
      'block.convert': '转换为',
      'block.moveUp': '上移',
      'block.moveDown': '下移',
      'block.duplicate': '复制',
      'block.delete': '删除',
      'block.addBelow': '下方添加',
      'block.placeholder': '输入 / 使用命令',
      'search.type.all': '全部',
      'search.type.chat': '聊天',
      'search.type.image': '图像',
      'search.type.doc': '文档',
      'search.type.page': '页面',
      'search.type.project': '项目',
      'site.shared': '共享对象',
      'site.self': '仅自己可见',
      'site.share': '共享',
      'site.edit': '编辑',
      'site.analytics': '分析',
      'site.settings': '设置',
      'site.terms': '站点使用条款',
      'site.termsHint': '创建或发布网站前，请先阅读这些条款',
      'site.termsRead': '阅读 ChatGPT 站点条款',
      'site.termsContinue': '继续（此复原不执行接受）',
      'site.analyticsTitle': '站点分析',
      'site.analyticsEmpty': '暂无访问数据。',
      'trash.title': '回收站',
      'trash.files': '文件',
      'trash.pages': '页面',
      'trash.empty': '回收站为空',
      'trash.hint': '移至回收站的项目将在 30 天后永久删除',
      'trash.restore': '恢复',
      'trash.delete': '永久删除',
      'trash.moved': '已移至回收站。',
      'notify.title': '通知',
      'notify.empty': '暂无通知',
      'notify.hint': '当某人与您分享内容或提及时，你会收到通知。',
      'search.recent': '最近聊天',
      'rail.home': '主页',
      'rail.spaces': '空间',
      'rail.scheduled': '定时任务',
      'rail.comments': '评论',
      'rail.more': '更多',
      'rail.profile': '账户',
    };

    const en = {
      'panel': 'Space',
      'space': 'Space',
      'newPage': 'New page',
      'nav.all': 'All',
      'nav.pages': 'Pages',
      'nav.sites': 'Sites',
      'nav.images': 'Images',
      'nav.drive': 'Google Drive',
      'nav.trash': 'Trash',
      'label.recent': 'Recent',
      'label.expand': 'Show more',
      'label.space': 'Space',
      'usage.title': 'Usage · example',
      'usage.desc': 'Check remaining balance and reset time here.',
      'usage.add': 'Add credits',
      'usage.upgrade': 'Upgrade',
      'search': 'Search',
      'new': 'New',
      'tabs.recommended': 'Recommended',
      'tabs.starred': 'Starred',
      'tabs.mine': 'Your content',
      'tabs.shared': 'Shared with you',
      'tabs.all': 'All',
      'tabs.projects': 'Your projects',
      'tabs.sharedPages': 'Shared with you',
      'start': 'Get started',
      'template.intro': 'Page basics',
      'template.todo': 'To-do list',
      'template.tracker': 'Project tracker',
      'template.weekly': 'Weekly update',
      'table.name': 'Name',
      'table.time': 'Last active',
      'view.filter': 'Filter',
      'view.grid': 'Grid view',
      'view.list': 'List view',
      'empty.title': 'Nothing here yet',
      'empty.hint': 'Start with New, or create a page from a template.',
      'empty.trash': 'Trash is empty',
      'empty.section': 'This space has no content yet',
      'empty.search': 'No matching content',
      'menu.page': 'Page',
      'menu.presentation': 'Presentation',
      'menu.spreadsheet': 'Spreadsheet',
      'menu.site': 'Site',
      'menu.image': 'Image',
      'menu.folder': 'Folder',
      'menu.space': 'Space',
      'menu.templates': 'Start from template',
      'menu.upload': 'Upload file',
      'menu.plugins': 'Connect plugins',
      'menu.soon': 'Coming soon',
      'page.star': 'Star',
      'page.unstar': 'Unstar',
      'page.share': 'Share',
      'page.comment': 'Comment',
      'page.automation': 'Page automation',
      'page.workPlaceholder': 'Work with ChatGPT',
      'page.close': 'Close',
      'page.emptyBody': 'This page is empty. The editor arrives in P1.',
      'scheduled.title': 'Scheduled tasks',
      'scheduled.new': 'New task',
      'scheduled.upcoming': 'Upcoming',
      'scheduled.desc': 'ChatGPT can handle recurring work so you do not have to.',
      'scheduled.cta': 'Schedule a task',
      'scheduled.cardHint': 'Pick a template, then set the time and goal.',
      'scheduled.t1': 'Update me on the news',
      'scheduled.t2': 'Inbox monitoring',
      'scheduled.t3': 'Agent Workspace research radar',
      'scheduled.t4': 'Weekly meal plan',
      'scheduled.t5': 'Weekly finance update',
      'scheduled.t6': 'Find flights for a trip',
      'scheduled.paused': 'Paused · example',
      'scheduled.done': 'Completed · example',
      'toast.soon': '{name} is coming in a later version.',
      'toast.share': 'Sharing arrives in P2.',
      'toast.comment': 'Comments arrive in P2.',
      'toast.automation': 'Page automation arrives in P2.',
      'toast.file': 'File preview arrives in P4.',
      'toast.filter': 'Filters arrive in P1.',
      'toast.usage': 'This is prototype data; it does not spend anything.',
      'toast.error': 'The operation did not complete.',
      'toast.uploaded': 'Added {count} file(s).',
      'save.saving': 'Saving…',
      'save.dirty': 'Unsaved',
      'save.saved': 'Saved',
      'action.save': 'Save',
      'document.title': 'Page title',
      'share.title': 'Share “{name}”',
      'share.access': 'Link access',
      'share.invited': 'Invited people only',
      'share.link': 'Anyone with the link',
      'share.copy': 'Copy link',
      'share.done': 'Done',
      'share.copied': 'Link copied.',
      'share.owner': 'Owner',
      'share.addMember': 'Add member',
      'share.member': 'Member',
      'comment.title': 'Comments',
      'comment.empty': 'No comments yet.',
      'comment.placeholder': 'Write a comment…',
      'comment.send': 'Send',
      'item.type': 'Type',
      'item.size': 'Size',
      'item.updated': 'Updated',
      'item.page': 'Page',
      'item.file': 'File',
      'item.site': 'Site',
      'item.image': 'Image',
      'item.folder': 'Folder',
      'item.space': 'Space',
      'item.drive': 'Cloud file',
      'task.modal.title': 'New task',
      'task.title': 'Task name',
      'task.goal': 'Goal / prompt',
      'task.frequency': 'Frequency',
      'task.freq.once': 'Once',
      'task.freq.hourly': 'Hourly',
      'task.freq.daily': 'Daily',
      'task.freq.weekly': 'Weekly',
      'task.save': 'Create task',
      'task.cancel': 'Cancel',
      'task.pause': 'Pause',
      'task.resume': 'Resume',
      'task.status.active': 'Active',
      'task.status.paused': 'Paused',
      'task.status.completed': 'Completed',
      'task.new': 'New task',
      'task.settings': 'Set a scheduled task',
      'task.repeat': 'Repeat',
      'task.time': 'Time',
      'task.timezone': 'Time zone',
      'task.end': 'End repeat',
      'task.end.never': 'Never',
      'task.end.date': 'On date',
      'task.end.count': 'After',
      'task.advanced': 'Advanced',
      'task.newChat': 'Start a new chat each run',
      'task.repeat.hourly': 'Hourly',
      'task.repeat.daily': 'Daily',
      'task.repeat.weekdays': 'Weekdays',
      'task.repeat.weekly': 'Weekly',
      'task.repeat.monthly': 'Monthly',
      'task.repeat.custom': 'Custom',
      'task.toggle': 'Repeat this task',
      'filter.title': 'File type',
      'filter.all': 'All',
      'filter.page': 'Pages',
      'filter.image': 'Images',
      'filter.doc': 'Documents',
      'filter.sheet': 'Spreadsheets',
      'filter.deck': 'Presentations',
      'filter.pdf': 'PDF files',
      'menu.show': 'Show page',
      'menu.rename': 'Rename',
      'menu.pin': 'Pin',
      'menu.unpin': 'Unpin',
      'menu.delete': 'Delete',
      'menu.copyMarkdown': 'Download as Markdown',
      'menu.editors': 'Show editor info',
      'menu.activity': 'Page activity',
      'menu.insert': 'Insert',
      'insert.generate': 'Generate',
      'insert.generateHint': 'Describe what you want to write',
      'insert.visual': 'Visualize',
      'insert.visualHint': 'Create interactive visual content',
      'insert.create': 'Create',
      'insert.subpage': 'Page',
      'insert.subpageHint': 'Create a subpage in this page',
      'insert.media': 'Media',
      'insert.image': 'Image',
      'insert.imageHint': 'Upload or generate an image',
      'insert.file': 'File',
      'insert.fileHint': 'Upload a file for download',
      'insert.basic': 'Basic',
      'insert.heading': 'Heading',
      'insert.list': 'List',
      'insert.todo': 'To-do',
      'insert.divider': 'Divider',
      'insert.code': 'Code',
      'insert.agent': 'Agent instructions',
      'insert.agentHint': 'Add agent instructions to this page',
      'insert.h1': 'Heading 1',
      'insert.h2': 'Heading 2',
      'insert.h3': 'Heading 3',
      'insert.numbered': 'Numbered list',
      'insert.quote': 'Quote',
      'insert.table': 'Table',
      'insert.linkPage': 'Link to page',
      'insert.callout': 'Callout',
      'insert.highlight': 'Highlight block',
      'menu.copy': 'Copy',
      'label.collapse': 'Collapse',
      'share.invitedHint': 'People who already have access can use this link',
      'share.members': 'Who has access',
      'share.exampleUser': 'Example user',
      'task.custom': 'Custom repeat',
      'task.customHint': 'For example: every other Monday',
      'block.paragraph': 'Paragraph',
      'block.h1': 'Heading 1',
      'block.h2': 'Heading 2',
      'block.h3': 'Heading 3',
      'block.bulleted': 'List',
      'block.numbered': 'Numbered list',
      'block.todo': 'To-do',
      'block.quote': 'Quote',
      'block.code': 'Code',
      'block.callout': 'Callout',
      'block.highlight': 'Highlight',
      'block.table': 'Table',
      'block.divider': 'Divider',
      'block.add': 'Add block',
      'block.menu': 'Block menu',
      'block.convert': 'Turn into',
      'block.moveUp': 'Move up',
      'block.moveDown': 'Move down',
      'block.duplicate': 'Duplicate',
      'block.delete': 'Delete',
      'block.addBelow': 'Add below',
      'block.placeholder': 'Type / for commands',
      'search.type.all': 'All',
      'search.type.chat': 'Chats',
      'search.type.image': 'Images',
      'search.type.doc': 'Documents',
      'search.type.page': 'Pages',
      'search.type.project': 'Projects',
      'site.shared': 'Shared with',
      'site.self': 'Only me',
      'site.share': 'Share',
      'site.edit': 'Edit',
      'site.analytics': 'Analytics',
      'site.settings': 'Settings',
      'site.terms': 'Site terms',
      'site.termsHint': 'Read these terms before creating or publishing a site',
      'site.termsRead': 'Read the ChatGPT site terms',
      'site.termsContinue': 'Continue (this reproduction does not accept)',
      'site.analyticsTitle': 'Site analytics',
      'site.analyticsEmpty': 'No traffic data yet.',
      'trash.title': 'Trash',
      'trash.files': 'Files',
      'trash.pages': 'Pages',
      'trash.empty': 'Trash is empty',
      'trash.hint': 'Items in trash are permanently deleted after 30 days',
      'trash.restore': 'Restore',
      'trash.delete': 'Delete forever',
      'trash.moved': 'Moved to trash.',
      'notify.title': 'Notifications',
      'notify.empty': 'No notifications',
      'notify.hint': 'You will be notified when someone shares content with you or mentions you.',
      'search.recent': 'Recent chats',
      'rail.home': 'Home',
      'rail.spaces': 'Spaces',
      'rail.scheduled': 'Scheduled tasks',
      'rail.comments': 'Comments',
      'rail.more': 'More',
      'rail.profile': 'Account',
    };

    const styles = `
.sp-page{display:flex;height:100%;min-height:0;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font-family:Inter,-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;font-size:13px;line-height:1.5;--sp-border:var(--dsw-alias-border-l2);--sp-muted:var(--dsw-alias-label-secondary);--sp-soft:var(--dsw-alias-bg-layer-2);--sp-ink:var(--dsw-alias-label-primary)}
.sp-rail{width:64px;flex:0 0 64px;display:flex;flex-direction:column;align-items:center;padding:16px 0 18px;border-right:1px solid var(--sp-border);gap:6px}
.sp-rail-btn{width:38px;height:38px;border:0;background:none;border-radius:10px;display:flex;align-items:center;justify-content:center;color:var(--sp-muted);cursor:pointer}
.sp-rail-btn:hover{background:var(--sp-soft);color:var(--sp-ink)}
.sp-rail-btn.active{background:var(--sp-soft);color:var(--sp-ink)}
.sp-rail-spacer{flex:1}
.sp-sidebar{width:300px;flex:0 0 300px;display:flex;flex-direction:column;min-height:0;border-right:1px solid var(--sp-border);padding:14px 12px 16px;overflow:auto}
.sp-side-head{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:4px 6px 14px}
.sp-side-title{font-size:15px;font-weight:600;letter-spacing:.1px}
.sp-side-actions{display:flex;align-items:center;gap:2px}
.sp-icon-btn{width:28px;height:28px;border:0;background:none;border-radius:8px;display:inline-flex;align-items:center;justify-content:center;color:var(--sp-muted);cursor:pointer;padding:0}
.sp-icon-btn:hover{background:var(--sp-soft);color:var(--sp-ink)}
.sp-icon-btn.starred{color:var(--sp-ink)}
.sp-icon-btn.starred svg{fill:currentColor}
.sp-side-new{display:flex;align-items:center;gap:9px;width:100%;border:0;background:none;border-radius:8px;padding:8px 10px;font:inherit;font-size:13px;color:var(--sp-ink);cursor:pointer;text-align:left}
.sp-side-new:hover{background:var(--sp-soft)}
.sp-nav{display:flex;flex-direction:column;gap:1px;margin-top:6px}
.sp-nav-item{display:flex;align-items:center;gap:10px;width:100%;border:0;background:none;border-radius:8px;padding:8px 10px;font:inherit;font-size:13px;color:var(--sp-muted);cursor:pointer;text-align:left}
.sp-nav-item:hover{background:var(--sp-soft);color:var(--sp-ink)}
.sp-nav-item.active{background:var(--sp-soft);color:var(--sp-ink)}
.sp-nav-icon{width:16px;display:inline-flex;justify-content:center;color:var(--sp-muted)}
.sp-nav-item.active .sp-nav-icon,.sp-nav-item:hover .sp-nav-icon{color:var(--sp-ink)}
.sp-side-label{font-size:11.5px;color:var(--sp-muted);padding:16px 10px 6px}
.sp-recent{display:flex;flex-direction:column;gap:1px}
.sp-recent-item{display:flex;align-items:center;gap:9px;width:100%;border:0;background:none;border-radius:8px;padding:6px 10px;font:inherit;font-size:12.5px;color:var(--sp-muted);cursor:pointer;text-align:left}
.sp-recent-item:hover{background:var(--sp-soft);color:var(--sp-ink)}
.sp-recent-item span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.sp-expand{display:flex;align-items:center;gap:6px;border:0;background:none;color:var(--sp-muted);font:inherit;font-size:11.5px;padding:7px 10px;cursor:pointer}
.sp-expand:hover{color:var(--sp-ink)}
.sp-usage{margin-top:auto;border:1px solid var(--sp-border);border-radius:14px;padding:13px 14px;background:var(--dsw-alias-bg-base)}
.sp-usage strong{display:block;font-size:12.5px;font-weight:500}
.sp-usage p{margin:5px 0 12px;font-size:11px;line-height:1.6;color:var(--sp-muted)}
.sp-usage-actions{display:flex;gap:8px}
.sp-usage-actions button{flex:1;height:30px;border-radius:15px;border:1px solid var(--sp-border);background:var(--sp-soft);color:var(--sp-ink);font:inherit;font-size:11.5px;cursor:pointer}
.sp-usage-actions button.dark{background:var(--sp-ink);color:var(--dsw-alias-bg-base);border-color:var(--sp-ink)}
.sp-avatar{width:28px;height:28px;border-radius:50%;background:var(--sp-soft);color:var(--sp-muted);display:flex;align-items:center;justify-content:center;font-size:11px;border:1px solid var(--sp-border);margin:12px 0 0 4px}
.sp-main{flex:1;min-width:0;min-height:0;overflow:auto;padding:34px 38px 72px}
.sp-main-head{display:flex;align-items:center;gap:14px;flex-wrap:wrap}
.sp-main-title{font-size:26px;font-weight:600;letter-spacing:-.3px;margin:0;line-height:1.2}
.sp-head-spacer{flex:1}
.sp-search{display:flex;align-items:center;gap:8px;width:260px;height:38px;padding:0 14px;border-radius:19px;background:var(--sp-soft);color:var(--sp-muted)}
.sp-search input{flex:1;min-width:0;border:0;background:none;font:inherit;font-size:12.5px;color:var(--sp-ink);outline:none}
.sp-new-wrap{position:relative}
.sp-new-btn{display:inline-flex;align-items:center;gap:6px;height:38px;padding:0 18px;border:0;border-radius:19px;background:var(--sp-ink);color:var(--dsw-alias-bg-base);font:inherit;font-size:12.5px;font-weight:500;cursor:pointer}
.sp-new-btn:hover{opacity:.88}
.sp-menu{position:absolute;right:0;top:44px;width:272px;background:var(--dsw-alias-bg-overlay,var(--dsw-alias-bg-base));border:1px solid var(--sp-border);border-radius:14px;box-shadow:0 18px 48px rgba(0,0,0,.16);padding:6px;z-index:20}
.sp-menu button{display:flex;align-items:center;gap:10px;width:100%;border:0;background:none;border-radius:8px;padding:8px 10px;font:inherit;font-size:12.5px;color:var(--sp-ink);cursor:pointer;text-align:left}
.sp-menu button:hover{background:var(--sp-soft)}
.sp-menu .badge{margin-left:auto;font-size:10px;color:var(--sp-muted);border:1px solid var(--sp-border);border-radius:6px;padding:1px 5px}
.sp-menu hr{border:0;border-top:1px solid var(--sp-border);margin:5px 4px}
.sp-tabs{display:flex;align-items:center;gap:24px;margin-top:22px;border-bottom:1px solid var(--sp-border)}
.sp-tab{border:0;background:none;font:inherit;font-size:12.5px;color:var(--sp-muted);padding:9px 0 12px;cursor:pointer;border-bottom:2px solid transparent;margin-bottom:-1px}
.sp-tab:hover{color:var(--sp-ink)}
.sp-tab.active{color:var(--sp-ink);border-bottom-color:var(--sp-ink);font-weight:500}
.sp-view{display:flex;align-items:center;gap:4px;margin-left:auto}
.sp-view .sp-icon-btn{width:30px;height:30px}
.sp-view .sp-icon-btn.active{background:var(--sp-soft);color:var(--sp-ink)}
.sp-section{margin-top:24px}
.sp-section-title{font-size:12.5px;font-weight:500;margin:0 0 12px}
.sp-cards{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px}
.sp-card{border:1px solid var(--sp-border);border-radius:12px;background:var(--dsw-alias-bg-base);padding:14px;display:flex;flex-direction:column;gap:14px;cursor:pointer;text-align:left;font:inherit;color:var(--sp-ink)}
.sp-card:hover{background:var(--sp-soft)}
.sp-card span{font-size:12.5px;line-height:1.4}
.sp-card svg{color:var(--sp-muted)}
.sp-table{margin-top:24px}
.sp-thead,.sp-tr{display:grid;grid-template-columns:minmax(0,1fr) 150px;align-items:center}
.sp-thead{color:var(--sp-muted);font-size:11.5px;padding:0 10px 10px;border-bottom:1px solid var(--sp-border)}
.sp-tr{border:0;background:none;border-bottom:1px solid var(--sp-border);padding:13px 10px;font:inherit;font-size:12.5px;color:var(--sp-ink);cursor:pointer;text-align:left;width:100%}
.sp-tr:hover{background:var(--sp-soft)}
.sp-tr-name{display:flex;align-items:center;gap:10px;min-width:0}
.sp-tr-name span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.sp-tr-name svg{color:var(--sp-muted);flex:none}
.sp-tr-time{color:var(--sp-muted);font-size:11.5px}
.sp-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(170px,1fr));gap:12px;margin-top:24px}
.sp-grid-item{border:1px solid var(--sp-border);border-radius:12px;background:var(--dsw-alias-bg-base);padding:14px;display:flex;flex-direction:column;gap:12px;cursor:pointer;text-align:left;font:inherit;color:var(--sp-ink);min-width:0}
.sp-grid-item:hover{background:var(--sp-soft)}
.sp-grid-item span{font-size:12.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.sp-grid-item small{font-size:10.5px;color:var(--sp-muted)}
.sp-empty{padding:70px 12px;text-align:center;color:var(--sp-muted)}
.sp-empty strong{display:block;font-size:14px;font-weight:500;color:var(--sp-ink);margin-bottom:7px}
.sp-empty p{font-size:12px;margin:0}
.sp-toast{position:fixed;left:50%;bottom:26px;transform:translateX(-50%);background:var(--sp-ink);color:var(--dsw-alias-bg-base);font-size:12px;padding:9px 16px;border-radius:18px;box-shadow:0 10px 30px rgba(0,0,0,.2);z-index:60;max-width:80vw;text-align:center}
.sp-btn{height:32px;padding:0 14px;border:1px solid var(--sp-border);border-radius:16px;background:var(--sp-soft);color:var(--sp-ink);font:inherit;font-size:12px;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;gap:6px;white-space:nowrap}
.sp-btn:hover{background:var(--dsw-alias-bg-layer-1)}
.sp-btn.dark{background:var(--sp-ink);color:var(--dsw-alias-bg-base);border-color:var(--sp-ink)}
.sp-btn.small{height:28px;padding:0 12px;font-size:11.5px}
.sp-btn:disabled{opacity:.45;cursor:default}
.sp-save-status{font-size:11px;color:var(--sp-muted);margin-left:2px}
.sp-save-status.dirty{color:var(--dsw-alias-state-warn-primary)}
.sp-doc-wrap{display:flex;gap:0;min-height:100%}
.sp-docpane{flex:1;min-width:0}
.sp-doc-title-input{display:block;width:100%;box-sizing:border-box;border:0;background:none;color:var(--sp-ink);font:inherit;font-size:32px;font-weight:650;letter-spacing:-.5px;line-height:1.25;padding:0;margin:0 0 18px;outline:none}
.sp-doc-title-input::placeholder{color:var(--sp-muted)}
.sp-doc-body-input{display:block;width:100%;box-sizing:border-box;min-height:360px;border:0;border-left:2px solid var(--sp-soft);padding:0 0 0 18px;background:none;color:var(--sp-ink);font:inherit;font-size:14px;line-height:1.95;resize:vertical;outline:none}
.sp-doc-body-input::placeholder{color:var(--sp-muted)}
.sp-meta-list{display:grid;grid-template-columns:110px minmax(0,1fr);gap:10px 14px;font-size:12.5px;margin:0;padding:0 0 0 18px;border-left:2px solid var(--sp-soft)}
.sp-meta-list dt{color:var(--sp-muted);margin:0}
.sp-meta-list dd{margin:0;overflow-wrap:anywhere}
.sp-chat{margin-top:30px}
.sp-messages{display:flex;flex-direction:column;gap:8px;margin-bottom:14px}
.sp-message{align-self:flex-end;max-width:80%;background:var(--sp-soft);border-radius:14px 14px 4px 14px;padding:9px 13px;font-size:12.5px;color:var(--sp-ink);white-space:pre-wrap;overflow-wrap:anywhere}
.sp-workform{display:flex;align-items:center;gap:10px;height:56px;padding:0 12px 0 18px;border:1px solid var(--sp-border);border-radius:28px;background:var(--dsw-alias-bg-base)}
.sp-workform input{flex:1;min-width:0;border:0;background:none;font:inherit;font-size:13px;color:var(--sp-ink);outline:none}
.sp-workform input::placeholder{color:var(--sp-muted)}
.sp-work-send{width:34px;height:34px;flex:none;border-radius:50%;border:0;background:var(--sp-ink);color:var(--dsw-alias-bg-base);display:flex;align-items:center;justify-content:center;cursor:pointer}
.sp-work-send:disabled{opacity:.35;cursor:default}
.sp-comments{width:320px;flex:0 0 320px;border-left:1px solid var(--sp-border);padding:18px 16px;display:flex;flex-direction:column;gap:12px;min-height:0;overflow:auto}
.sp-comments-head{display:flex;align-items:center;justify-content:space-between;font-size:12.5px}
.sp-comments-head span{color:var(--sp-muted)}
.sp-comment-list{display:flex;flex-direction:column}
.sp-comment{border-bottom:1px solid var(--sp-border);padding:10px 0}
.sp-comment strong{font-size:12px;font-weight:500}
.sp-comment p{margin:4px 0;font-size:12.5px;line-height:1.7;white-space:pre-wrap}
.sp-comment small{font-size:10.5px;color:var(--sp-muted)}
.sp-comment-form{display:flex;gap:6px;margin-top:auto}
.sp-comment-form input{flex:1;min-width:0;height:32px;border:1px solid var(--sp-border);border-radius:8px;background:none;color:var(--sp-ink);font:inherit;font-size:12px;padding:0 10px;outline:none}
.sp-help{font-size:12px;color:var(--sp-muted)}
.sp-share-wrap{position:relative}
.sp-share{position:absolute;right:0;top:36px;width:300px;background:var(--dsw-alias-bg-overlay,var(--dsw-alias-bg-base));border:1px solid var(--sp-border);border-radius:14px;box-shadow:0 18px 48px rgba(0,0,0,.16);padding:14px;z-index:30;display:flex;flex-direction:column;gap:10px}
.sp-share strong{font-size:12.5px;font-weight:500}
.sp-share label{display:flex;flex-direction:column;gap:6px;font-size:11px;color:var(--sp-muted)}
.sp-share select{height:32px;border:1px solid var(--sp-border);border-radius:8px;background:var(--dsw-alias-bg-base);color:var(--sp-ink);font:inherit;font-size:12px;padding:0 8px}
.sp-share-row{display:flex;align-items:center;gap:8px;font-size:12px}
.sp-share-row em{margin-left:auto;font-style:normal;font-size:10.5px;color:var(--sp-muted)}
.sp-share-actions{display:flex;justify-content:flex-end;gap:8px}
.sp-avatar.small{width:24px;height:24px;margin:0;font-size:10px}
.sp-task-list{display:flex;flex-direction:column;gap:0;max-width:860px;margin:0 auto 24px;border-top:1px solid var(--sp-border)}
.sp-task-row{display:flex;align-items:center;gap:12px;padding:12px 4px;border-bottom:1px solid var(--sp-border)}
.sp-task-info{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px}
.sp-task-info strong{font-size:12.5px;font-weight:500}
.sp-task-info small{font-size:11px;color:var(--sp-muted)}
.sp-tag{font-size:10.5px;color:var(--sp-muted);border:1px solid var(--sp-border);border-radius:6px;padding:2px 6px}
.sp-modal-backdrop{position:fixed;inset:0;background:rgba(0,0,0,.35);display:flex;align-items:center;justify-content:center;z-index:70}
.sp-modal{width:min(420px,calc(100vw - 40px));background:var(--dsw-alias-bg-base);border:1px solid var(--sp-border);border-radius:16px;padding:20px;display:flex;flex-direction:column;gap:12px;box-shadow:0 24px 70px rgba(0,0,0,.28)}
.sp-modal h2{font-size:15px;font-weight:600;margin:0}
.sp-modal label{display:flex;flex-direction:column;gap:6px;font-size:11.5px;color:var(--sp-muted)}
.sp-modal input,.sp-modal textarea,.sp-modal select{border:1px solid var(--sp-border);border-radius:8px;background:none;color:var(--sp-ink);font:inherit;font-size:12.5px;padding:8px 10px;outline:none}
.sp-modal textarea{resize:vertical}
.sp-modal-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:4px}
.sp-sched-task{border:0;background:none;cursor:pointer;text-align:left;width:100%;align-items:flex-start}
.sp-sched-task:hover{background:var(--sp-soft);border-radius:8px}
.sp-sched-task-title{font-size:12px;color:var(--sp-ink);max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.sp-docbar{position:relative}
.sp-doc-title-btn{display:inline-flex;align-items:center;gap:4px;border:0;background:none;color:var(--sp-ink);font:inherit;font-size:12.5px;font-weight:500;max-width:280px;cursor:pointer;padding:2px 4px;border-radius:6px}
.sp-doc-title-btn:hover{background:var(--sp-soft)}
.sp-doc-title-btn strong{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.sp-filemenu{position:absolute;left:0;top:44px;width:230px;background:var(--dsw-alias-bg-overlay,var(--dsw-alias-bg-base));border:1px solid var(--sp-border);border-radius:12px;box-shadow:0 18px 48px rgba(0,0,0,.16);padding:6px;z-index:40;display:flex;flex-direction:column}
.sp-filemenu button{text-align:left;border:0;background:none;border-radius:7px;padding:8px 10px;font:inherit;font-size:12.5px;color:var(--sp-ink);cursor:pointer}
.sp-filemenu button:hover{background:var(--sp-soft)}
.sp-insert{position:absolute;left:80px;top:44px;width:300px;background:var(--dsw-alias-bg-overlay,var(--dsw-alias-bg-base));border:1px solid var(--sp-border);border-radius:14px;box-shadow:0 18px 48px rgba(0,0,0,.16);padding:8px;z-index:40;max-height:70vh;overflow:auto}
.sp-insert-group{padding:4px 0}
.sp-insert-label{font-size:10.5px;color:var(--sp-muted);padding:4px 10px}
.sp-insert-item{display:flex;align-items:flex-start;gap:10px;width:100%;border:0;background:none;border-radius:8px;padding:8px 10px;font:inherit;color:var(--sp-ink);cursor:pointer;text-align:left}
.sp-insert-item:hover{background:var(--sp-soft)}
.sp-insert-item strong{display:block;font-size:12.5px;font-weight:500}
.sp-insert-item small{display:block;font-size:10.5px;color:var(--sp-muted);margin-top:2px}
.sp-info{margin-top:18px;border:1px solid var(--sp-border);border-radius:12px;padding:14px;display:flex;flex-direction:column;gap:8px}
.sp-info p{margin:0;font-size:12px;color:var(--sp-muted)}
.sp-member-form{display:flex;gap:6px}
.sp-member-form input{flex:1;min-width:0;height:30px;border:1px solid var(--sp-border);border-radius:8px;background:none;color:var(--sp-ink);font:inherit;font-size:12px;padding:0 8px}
.sp-members{display:flex;flex-direction:column;gap:6px}
.sp-terms{margin-top:22px;border:1px solid var(--sp-border);border-radius:12px;padding:16px;display:flex;flex-direction:column;gap:10px}
.sp-terms strong{font-size:13px}
.sp-terms p{margin:0;font-size:12px;color:var(--sp-muted)}
.sp-terms ul{margin:0;padding-left:18px;font-size:12px;line-height:1.8;color:var(--sp-muted)}
.sp-terms .sp-btn{align-self:flex-start}
.sp-filter-wrap{position:relative}
.sp-filter{position:absolute;right:0;top:34px;width:190px;background:var(--dsw-alias-bg-overlay,var(--dsw-alias-bg-base));border:1px solid var(--sp-border);border-radius:12px;box-shadow:0 18px 48px rgba(0,0,0,.16);padding:6px;z-index:40}
.sp-filter-label{font-size:10.5px;color:var(--sp-muted);padding:6px 8px 4px}
.sp-filter-item{display:flex;justify-content:space-between;width:100%;border:0;background:none;border-radius:7px;padding:7px 8px;font:inherit;font-size:12px;color:var(--sp-ink);cursor:pointer;text-align:left}
.sp-filter-item:hover,.sp-filter-item.active{background:var(--sp-soft)}
.sp-notify-wrap{position:relative}
.sp-notify{position:absolute;right:0;top:34px;width:260px;background:var(--dsw-alias-bg-overlay,var(--dsw-alias-bg-base));border:1px solid var(--sp-border);border-radius:12px;padding:14px;box-shadow:0 18px 48px rgba(0,0,0,.16);z-index:50}
.sp-notify strong{font-size:12.5px;display:block;margin-bottom:6px}
.sp-notify p{font-size:11.5px;line-height:1.6;color:var(--sp-muted);margin:0}
.sp-sitemenu{position:fixed;right:36px;top:120px;width:170px;background:var(--dsw-alias-bg-overlay,var(--dsw-alias-bg-base));border:1px solid var(--sp-border);border-radius:12px;padding:10px;z-index:65;box-shadow:0 18px 48px rgba(0,0,0,.16);display:flex;flex-direction:column;gap:2px}
.sp-sitemenu strong{font-size:12px;padding:4px 8px 8px;border-bottom:1px solid var(--sp-border);margin-bottom:4px}
.sp-sitemenu button{text-align:left;border:0;background:none;border-radius:7px;padding:8px;font:inherit;font-size:12px;color:var(--sp-ink);cursor:pointer}
.sp-sitemenu button:hover{background:var(--sp-soft)}
.sp-site-table .sp-thead{grid-template-columns:minmax(0,1fr) 140px}
.sp-site-row{grid-template-columns:minmax(0,1fr) 140px 34px}
.sp-tr-button{border:0;background:none;text-align:left;cursor:pointer;padding:0;font:inherit;color:inherit}
.sp-tr-actions{display:flex;gap:6px;justify-content:flex-end}
.sp-task-overlay{position:fixed;inset:0;background:rgba(0,0,0,.28);display:flex;justify-content:flex-end;z-index:70}
.sp-task-panel{width:min(420px,100vw);height:100%;background:var(--dsw-alias-bg-base);border-left:1px solid var(--sp-border);padding:20px;display:flex;flex-direction:column;gap:12px;overflow:auto;box-shadow:-20px 0 60px rgba(0,0,0,.18)}
.sp-task-head{display:flex;align-items:center;justify-content:space-between}
.sp-task-head strong{font-size:14px}
.sp-task-panel label{display:flex;flex-direction:column;gap:6px;font-size:11.5px;color:var(--sp-muted)}
.sp-task-panel input,.sp-task-panel textarea,.sp-task-panel select{border:1px solid var(--sp-border);border-radius:8px;background:none;color:var(--sp-ink);font:inherit;font-size:12.5px;padding:8px 10px;outline:none}
.sp-task-fields{display:grid;grid-template-columns:1fr 1fr;gap:10px}
.sp-check{flex-direction:row!important;align-items:center;gap:8px!important;font-size:12px!important;color:var(--sp-ink)!important}
.sp-advanced-toggle{display:flex;align-items:center;justify-content:space-between;border:0;background:none;color:var(--sp-muted);font:inherit;font-size:12px;padding:8px 0;cursor:pointer;border-top:1px solid var(--sp-border)}
.sp-task-advanced{display:flex;flex-direction:column;gap:10px}
.sp-task-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:auto;padding-top:12px}
.sp-searchbox{position:fixed;left:50%;top:74px;transform:translateX(-50%);width:min(540px,calc(100vw - 40px));background:var(--dsw-alias-bg-overlay,var(--dsw-alias-bg-base));border:1px solid var(--sp-border);border-radius:14px;box-shadow:0 22px 60px rgba(0,0,0,.2);padding:8px;z-index:66;max-height:70vh;overflow:auto}
.sp-searchbox-head{display:flex;align-items:center;gap:8px;padding:4px 6px 8px;border-bottom:1px solid var(--sp-border);color:var(--sp-muted)}
.sp-searchbox-head input{flex:1;min-width:0;border:0;background:none;color:var(--sp-ink);font:inherit;font-size:13px;outline:none;padding:6px 0}
.sp-searchitem{display:flex;align-items:center;gap:9px;width:100%;border:0;background:none;border-radius:8px;padding:9px 8px;font:inherit;font-size:12.5px;color:var(--sp-ink);cursor:pointer;text-align:left}
.sp-searchitem:hover{background:var(--sp-soft)}
.sp-blocks{display:flex;flex-direction:column;gap:2px;padding-left:22px;position:relative}
.sp-block{display:flex;align-items:flex-start;gap:8px;position:relative;border-radius:6px;padding:2px 4px}
.sp-block:hover{background:var(--sp-soft)}
.sp-block-handle{position:absolute;left:-22px;top:4px;width:20px;height:22px;border:0;background:none;color:var(--sp-muted);cursor:pointer;opacity:.35;display:flex;align-items:center;justify-content:center;padding:0}
.sp-block:hover .sp-block-handle{opacity:1}
.sp-block-check{margin-top:7px;accent-color:var(--sp-ink)}
.sp-block-bullet,.sp-block-number{color:var(--sp-muted);font-size:14px;line-height:1.9;flex:none;min-width:14px}
.sp-block-input{flex:1;min-width:0;border:0;background:none;color:var(--sp-ink);font:inherit;font-size:14px;line-height:1.9;resize:none;outline:none;padding:2px 0;overflow:hidden}
.sp-block-input::placeholder{color:var(--sp-muted)}
.sp-block-input-h1{font-size:30px;font-weight:650;line-height:1.3;letter-spacing:-.4px}
.sp-block-input-h2{font-size:22px;font-weight:600;line-height:1.35}
.sp-block-input-h3{font-size:17px;font-weight:600}
.sp-block-input-code,.sp-block-input-table{font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:12.5px;background:var(--sp-soft);border-radius:8px;padding:10px}
.sp-block-input-quote{border-left:2px solid var(--sp-border);padding-left:12px;color:var(--sp-muted)}
.sp-block-callout .sp-block-input,.sp-block-highlight .sp-block-input{background:var(--sp-soft);border-radius:8px;padding:10px 12px}
.sp-block-divider{width:100%;border:0;border-top:1px solid var(--sp-border);margin:12px 0}
.sp-blockmenu{position:absolute;left:20px;top:30px;width:200px;max-height:320px;overflow:auto;background:var(--dsw-alias-bg-overlay,var(--dsw-alias-bg-base));border:1px solid var(--sp-border);border-radius:12px;box-shadow:0 18px 48px rgba(0,0,0,.16);padding:6px;z-index:40;display:flex;flex-direction:column}
.sp-blockmenu button{text-align:left;border:0;background:none;border-radius:7px;padding:7px 9px;font:inherit;font-size:12px;color:var(--sp-ink);cursor:pointer}
.sp-blockmenu button:hover{background:var(--sp-soft)}
.sp-blockmenu hr{border:0;border-top:1px solid var(--sp-border);margin:4px 2px}
.sp-slash-block{left:20px;top:30px}
.sp-add-block{display:flex;align-items:center;gap:6px;border:0;background:none;color:var(--sp-muted);font:inherit;font-size:12px;padding:8px 6px;cursor:pointer;align-self:flex-start}
.sp-add-block:hover{color:var(--sp-ink)}
.sp-menu-label{font-size:10.5px;color:var(--sp-muted);padding:8px 10px 4px;border-top:1px solid var(--sp-border);margin-top:4px}
.sp-share-btn{display:inline-flex;align-items:center;gap:6px;height:30px;padding:0 10px;border:0;background:none;border-radius:8px;color:var(--sp-ink);font:inherit;font-size:12px;cursor:pointer}
.sp-share-btn:hover{background:var(--sp-soft)}
.sp-share-hint{margin:0;font-size:10.5px;line-height:1.5;color:var(--sp-muted)}
.sp-share-label{font-size:11px;color:var(--sp-muted);margin-top:2px}
.sp-doc{position:relative}
.sp-slash{position:absolute;left:18px;top:120px;width:300px;max-height:320px;overflow:auto;background:var(--dsw-alias-bg-overlay,var(--dsw-alias-bg-base));border:1px solid var(--sp-border);border-radius:12px;box-shadow:0 18px 48px rgba(0,0,0,.16);padding:6px;z-index:35;display:flex;flex-direction:column}
.sp-slash button{display:flex;align-items:center;gap:9px;border:0;background:none;border-radius:7px;padding:8px 10px;font:inherit;font-size:12.5px;color:var(--sp-ink);cursor:pointer;text-align:left}
.sp-slash button:hover{background:var(--sp-soft)}
.sp-search-tabs{display:flex;gap:6px;padding:8px 6px 4px;flex-wrap:wrap}
.sp-search-tab{border:1px solid transparent;background:none;border-radius:7px;padding:4px 9px;font:inherit;font-size:11.5px;color:var(--sp-muted);cursor:pointer}
.sp-search-tab.active{background:var(--sp-soft);color:var(--sp-ink);border-color:var(--sp-border)}
.sp-reopen{position:fixed;left:74px;top:16px;width:32px;height:32px;border:1px solid var(--sp-border);border-radius:8px;background:var(--dsw-alias-bg-base);color:var(--sp-ink);display:flex;align-items:center;justify-content:center;cursor:pointer;z-index:50}
.sp-template-row{display:flex;align-items:center;gap:10px;border:1px solid var(--sp-border);border-radius:10px;background:none;padding:10px 12px;font:inherit;font-size:12.5px;color:var(--sp-ink);cursor:pointer;text-align:left}
.sp-template-row:hover{background:var(--sp-soft)}
.sp-docbar{display:flex;align-items:center;gap:12px;margin-bottom:26px;flex-wrap:wrap}
.sp-docpill{display:flex;align-items:center;gap:8px;height:36px;padding:0 12px;border:1px solid var(--sp-border);border-radius:18px;background:var(--dsw-alias-bg-base);min-width:0}
.sp-docpill strong{font-size:12.5px;font-weight:500;max-width:280px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.sp-docactions{display:flex;align-items:center;gap:4px;margin-left:auto}
.sp-doc{max-width:760px;margin:0 auto;padding-top:6px}
.sp-doc-icon{color:var(--sp-muted);margin-bottom:18px}
.sp-doc-title{font-size:32px;font-weight:650;letter-spacing:-.5px;line-height:1.25;margin:0 0 18px}
.sp-doc-body{border-left:2px solid var(--sp-soft);padding-left:18px;font-size:14px;line-height:1.95;color:var(--sp-muted);white-space:pre-wrap;overflow-wrap:anywhere}
.sp-doc-body.empty{color:var(--sp-muted);font-style:normal}
.sp-workbar{max-width:760px;margin:36px auto 0}
.sp-workinput{display:flex;align-items:center;gap:10px;width:100%;height:56px;padding:0 20px;border:1px solid var(--sp-border);border-radius:28px;background:var(--dsw-alias-bg-base);color:var(--sp-muted);font:inherit;font-size:13px;cursor:pointer;text-align:left}
.sp-workinput:hover{background:var(--sp-soft)}
.sp-workinput span{flex:1}
.sp-sched-head{text-align:center;padding:36px 0 26px;display:flex;flex-direction:column;align-items:center;gap:8px;color:var(--sp-muted)}
.sp-sched-head h2{font-size:15px;font-weight:500;color:var(--sp-ink);margin:0}
.sp-sched-head p{font-size:12px;margin:0}
.sp-sched-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px;max-width:860px;margin:0 auto}
.sp-sched-card{border:1px solid var(--sp-border);border-radius:12px;padding:16px 18px;background:var(--dsw-alias-bg-base);text-align:left;font:inherit;color:var(--sp-ink);cursor:pointer}
.sp-sched-card:hover{background:var(--sp-soft)}
.sp-sched-card strong{display:block;font-size:13px;font-weight:500;margin-bottom:8px}
.sp-sched-card p{margin:0;font-size:11.5px;line-height:1.6;color:var(--sp-muted)}
.sp-sched-task{display:flex;flex-direction:column;gap:2px;padding:5px 10px;font-size:12px;color:var(--sp-muted)}
.sp-sched-task small{font-size:10.5px;color:var(--sp-muted)}
@media(max-width:1000px){.sp-sidebar{width:260px;flex-basis:260px}.sp-main{padding:26px 24px 60px}.sp-cards{grid-template-columns:repeat(2,minmax(0,1fr))}}
@media(max-width:780px){.sp-rail{width:52px;flex-basis:52px}.sp-sidebar{display:none}.sp-main{padding:20px 18px 60px}.sp-search{width:180px}.sp-doc-title{font-size:26px}.sp-sched-grid{grid-template-columns:1fr}.sp-doc-body{font-size:13px}.sp-doc-wrap{flex-direction:column}.sp-comments{width:100%;flex:1 1 auto;border-left:0;border-top:1px solid var(--sp-border)}.sp-doc-title-input{font-size:26px}.sp-doc-body-input{min-height:240px}}
`;

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
        const error = new Error(response.status === 401 ? '空间需要已登录的 Harness 页面。' : payload?.error?.message || `HTTP ${response.status}`);
        error.code = payload?.error?.code || `HTTP_${response.status}`;
        throw error;
      }
      return payload.data;
    }

    const api = {
      state: (query = '') => request(`/state${query}`),
      item: id => request(`/items/${encodeURIComponent(id)}`),
      createPage: body => request('/pages', { method: 'POST', body: JSON.stringify(body) }),
      createItem: body => request('/items', { method: 'POST', body: JSON.stringify(body) }),
      updateItem: (id, body) => request(`/items/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(body) }),
      trashItem: id => request(`/items/${encodeURIComponent(id)}/trash`, { method: 'POST' }),
      restoreItem: id => request(`/items/${encodeURIComponent(id)}/restore`, { method: 'POST' }),
      deleteItem: id => request(`/items/${encodeURIComponent(id)}`, { method: 'DELETE' }),
      addMember: (id, name) => request(`/items/${encodeURIComponent(id)}/members`, { method: 'POST', body: JSON.stringify({ name }) }),
      addComment: (id, text) => request(`/items/${encodeURIComponent(id)}/comments`, { method: 'POST', body: JSON.stringify({ text }) }),
      addMessage: (id, text) => request(`/items/${encodeURIComponent(id)}/messages`, { method: 'POST', body: JSON.stringify({ text }) }),
      createTask: body => request('/tasks', { method: 'POST', body: JSON.stringify(body) }),
      updateTask: (id, body) => request(`/tasks/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(body) }),
    };

    function formatBytes(bytes) {
      if (!Number.isFinite(bytes) || bytes < 0) return '';
      if (bytes < 1024) return `${bytes} B`;
      if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
      return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
    }

    function relativeTime(value) {
      const time = new Date(value).getTime();
      if (!Number.isFinite(time)) return '';
      const minutes = Math.max(1, Math.round((Date.now() - time) / 60_000));
      if (minutes < 120) return `${minutes} 分`;
      const hours = Math.round(minutes / 60);
      if (hours < 24) return `${hours} 小时`;
      return `${Math.round(hours / 24)} 天`;
    }

    function Icon({ name, size = 16 }) {
      const common = {
        width: size,
        height: size,
        viewBox: '0 0 24 24',
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 1.5,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
        'aria-hidden': 'true',
      };
      switch (name) {
        case 'home':
          return h('svg', common, h('path', { d: 'M4 10.5 12 4l8 6.5V20a1 1 0 0 1-1 1h-5v-6H10v6H5a1 1 0 0 1-1-1z' }));
        case 'folder':
          return h('svg', common, h('path', { d: 'M3.5 7.5A1.5 1.5 0 0 1 5 6h4l2 2h8a1.5 1.5 0 0 1 1.5 1.5v8A1.5 1.5 0 0 1 19 19H5a1.5 1.5 0 0 1-1.5-1.5z' }));
        case 'clock':
          return h('svg', common, h('circle', { cx: 12, cy: 12, r: 8 }), h('path', { d: 'M12 8v4.5l3 1.5' }));
        case 'message':
          return h('svg', common, h('path', { d: 'M4 5.5h16v10H9l-5 4z' }));
        case 'dots':
          return h('svg', common, h('circle', { cx: 12, cy: 5.5, r: 1 }), h('circle', { cx: 12, cy: 12, r: 1 }), h('circle', { cx: 12, cy: 18.5, r: 1 }));
        case 'plus':
          return h('svg', common, h('path', { d: 'M12 5v14M5 12h14' }));
        case 'search':
          return h('svg', common, h('circle', { cx: 11, cy: 11, r: 6.2 }), h('path', { d: 'm16 16 4 4' }));
        case 'menu':
          return h('svg', common, h('path', { d: 'M4 7h16M4 12h16M4 17h16' }));
        case 'list':
          return h('svg', common, h('path', { d: 'M8 6h12M8 12h12M8 18h12' }), h('circle', { cx: 4.5, cy: 6, r: .6 }), h('circle', { cx: 4.5, cy: 12, r: .6 }), h('circle', { cx: 4.5, cy: 18, r: .6 }));
        case 'grid':
          return h('svg', common, h('rect', { x: 4, y: 4, width: 6.5, height: 6.5, rx: 1 }), h('rect', { x: 13.5, y: 4, width: 6.5, height: 6.5, rx: 1 }), h('rect', { x: 4, y: 13.5, width: 6.5, height: 6.5, rx: 1 }), h('rect', { x: 13.5, y: 13.5, width: 6.5, height: 6.5, rx: 1 }));
        case 'filter':
          return h('svg', common, h('path', { d: 'M4 7h16M7 12h10M10 17h4' }));
        case 'page':
          return h('svg', common, h('path', { d: 'M6 3.5h8l4 4V20a.5.5 0 0 1-.5.5h-11A.5.5 0 0 1 6 20z' }), h('path', { d: 'M14 3.5V8h4M9 12h6M9 15.5h6' }));
        case 'file':
          return h('svg', common, h('path', { d: 'M6 3.5h8l4 4V20a.5.5 0 0 1-.5.5h-11A.5.5 0 0 1 6 20z' }), h('path', { d: 'M14 3.5V8h4' }));
        case 'star':
          return h('svg', { ...common, fill: 'none' }, h('path', { d: 'm12 4 2.4 4.9 5.4.8-3.9 3.8.9 5.4-4.8-2.5-4.8 2.5.9-5.4L4.2 9.7l5.4-.8z' }));
        case 'share':
          return h('svg', common, h('circle', { cx: 7, cy: 12, r: 2.5 }), h('circle', { cx: 17, cy: 6, r: 2.5 }), h('circle', { cx: 17, cy: 18, r: 2.5 }), h('path', { d: 'm9.2 10.8 5.6-3.6M9.2 13.2l5.6 3.6' }));
        case 'close':
          return h('svg', common, h('path', { d: 'm6 6 12 12M18 6 6 18' }));
        case 'arrow':
          return h('svg', common, h('path', { d: 'M5 12h14M13 6l6 6-6 6' }));
        case 'chevron':
          return h('svg', common, h('path', { d: 'm6 9 6 6 6-6' }));
        case 'drive':
          return h('svg', common, h('path', { d: 'm9 4 7 12H4zM16 4l5 8M7 20h13' }));
        case 'site':
          return h('svg', common, h('rect', { x: 3.5, y: 4.5, width: 17, height: 15, rx: 2 }), h('path', { d: 'M3.5 9h17M7 6.5h.01M10 6.5h.01' }));
        case 'image':
          return h('svg', common, h('rect', { x: 3.5, y: 4.5, width: 17, height: 15, rx: 2 }), h('circle', { cx: 9, cy: 10, r: 1.5 }), h('path', { d: 'm5 17 4.5-4.5 3 3 2.5-2.5L19 17' }));
        case 'trash':
          return h('svg', common, h('path', { d: 'M5 7h14M9 7V5h6v2M7 7l1 13h8l1-13' }));
        case 'presentation':
          return h('svg', common, h('rect', { x: 3.5, y: 4.5, width: 17, height: 12, rx: 1.5 }), h('path', { d: 'M12 16.5V21M8 21h8' }));
        case 'sheet':
          return h('svg', common, h('rect', { x: 4, y: 4, width: 16, height: 16, rx: 1.5 }), h('path', { d: 'M4 10h16M10 4v16' }));
        case 'upload':
          return h('svg', common, h('path', { d: 'M12 16V5M7.5 9.5 12 5l4.5 4.5M5 19h14' }));
        case 'plug':
          return h('svg', common, h('path', { d: 'M9 7V4M15 7V4M7 7h10v5a5 5 0 0 1-10 0zM12 17v3' }));
        case 'space':
          return h('svg', common, h('rect', { x: 4, y: 4, width: 7, height: 7, rx: 1.5 }), h('rect', { x: 13, y: 4, width: 7, height: 7, rx: 1.5 }), h('rect', { x: 4, y: 13, width: 7, height: 7, rx: 1.5 }), h('path', { d: 'M17 13v7M13.5 16.5h7' }));
        default:
          return h('svg', common, h('circle', { cx: 12, cy: 12, r: 7 }));
      }
    }

    function SectionPlaceholder({ t, kind, onToast }) {
      if (kind === 'trash') {
        return h('div', { className: 'sp-empty' }, h('strong', null, t('empty.trash')), h('p', null, t('empty.hint')));
      }
      return h('div', { className: 'sp-empty' }, h('strong', null, t('empty.section')), h('p', null, t('empty.hint')));
    }

    function NewMenu({ t, onAction, onClose }) {
      const item = (key, icon, label, extra = {}) =>
        h(
          'button',
          { type: 'button', onClick: () => onAction(key, label) },
          h(Icon, { name: icon, size: 16 }),
          h('span', null, label),
          extra.soon ? h('span', { className: 'badge' }, t('menu.soon')) : null,
        );
      return h(
        'div',
        { className: 'sp-menu', role: 'menu' },
        item('page', 'page', t('menu.page')),
        item('presentation', 'presentation', t('menu.presentation'), { soon: true }),
        item('spreadsheet', 'sheet', t('menu.spreadsheet'), { soon: true }),
        item('site', 'site', t('menu.site')),
        h('hr'),
        item('image', 'image', t('menu.image')),
        item('folder', 'folder', t('menu.folder')),
        item('space', 'space', t('menu.space')),
        h('hr'),
        item('templates', 'grid', t('menu.templates')),
        item('upload', 'upload', t('menu.upload')),
        item('plugins', 'plug', t('menu.plugins')),
      );
    }

    function TaskPanel({ t, presetTitle = '', onClose, onCreated, toast }) {
      const [draft, setDraft] = useState({
        title: presetTitle,
        goal: '',
        repeat: 'daily',
        time: '09:00',
        timezone: 'Asia/Shanghai',
        endMode: 'never',
        endDate: '',
        endCount: 5,
        newChat: false,
        repeatEnabled: true,
        custom: '',
      });
      const [advanced, setAdvanced] = useState(false);
      const [busy, setBusy] = useState(false);

      async function submit(event) {
        event.preventDefault();
        if (!draft.title.trim() || busy) return;
        setBusy(true);
        try {
          await api.createTask({
            title: draft.title.trim(),
            goal: draft.goal,
            repeat: draft.repeatEnabled ? draft.repeat : 'once',
            custom: draft.repeat === 'custom' ? draft.custom : '',
            time: draft.time,
            timezone: draft.timezone,
            endMode: draft.endMode,
            endDate: draft.endMode === 'date' ? draft.endDate : null,
            endCount: draft.endMode === 'count' ? Number(draft.endCount) || null : null,
            newChat: draft.newChat,
          });
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
        { className: 'sp-task-overlay', onClick: event => { if (event.target === event.currentTarget) onClose(); } },
        h(
          'form',
          { className: 'sp-task-panel', onSubmit: submit },
          h(
            'div',
            { className: 'sp-task-head' },
            h('strong', null, t('task.settings')),
            h('button', { type: 'button', className: 'sp-icon-btn', title: t('task.cancel'), onClick: onClose }, h(Icon, { name: 'close', size: 15 })),
          ),
          h('label', null, t('task.goal'), h('textarea', { rows: 2, value: draft.goal, maxLength: 4000, placeholder: '说明...', onChange: event => setDraft({ ...draft, goal: event.target.value }) })),
          h('label', null, t('task.title'), h('input', { value: draft.title, maxLength: 200, onChange: event => setDraft({ ...draft, title: event.target.value }) })),
          h(
            'label',
            { className: 'sp-check' },
            h('input', { type: 'checkbox', checked: draft.repeatEnabled, onChange: event => setDraft({ ...draft, repeatEnabled: event.target.checked }) }),
            h('span', null, t('task.toggle')),
          ),
          draft.repeatEnabled
            ? h(
                'div',
                { className: 'sp-task-fields' },
                h(
                  'label',
                  null,
                  t('task.repeat'),
                  h(
                    'select',
                    { value: draft.repeat, onChange: event => setDraft({ ...draft, repeat: event.target.value }) },
                    ['hourly', 'daily', 'weekdays', 'weekly', 'monthly', 'custom'].map(key => h('option', { key, value: key }, t(`task.repeat.${key}`))),
                  ),
                ),
                h('label', null, t('task.time'), h('input', { type: 'time', value: draft.time, onChange: event => setDraft({ ...draft, time: event.target.value }) })),
                h(
                  'label',
                  null,
                  t('task.end'),
                  h(
                    'select',
                    { value: draft.endMode, onChange: event => setDraft({ ...draft, endMode: event.target.value }) },
                    h('option', { value: 'never' }, t('task.end.never')),
                    h('option', { value: 'date' }, t('task.end.date')),
                    h('option', { value: 'count' }, t('task.end.count')),
                  ),
                ),
                draft.endMode === 'date' ? h('input', { type: 'date', value: draft.endDate, onChange: event => setDraft({ ...draft, endDate: event.target.value }) }) : null,
                draft.endMode === 'count' ? h('input', { type: 'number', min: 1, max: 999, value: draft.endCount, onChange: event => setDraft({ ...draft, endCount: event.target.value }) }) : null,
                draft.repeat === 'custom' ? h('label', null, t('task.custom'), h('input', { value: draft.custom, placeholder: t('task.customHint'), onChange: event => setDraft({ ...draft, custom: event.target.value }) })) : null,
              )
            : null,
          h(
            'button',
            { type: 'button', className: 'sp-advanced-toggle', onClick: () => setAdvanced(value => !value) },
            t('task.advanced'),
            h(Icon, { name: 'chevron', size: 14 }),
          ),
          advanced
            ? h(
                'div',
                { className: 'sp-task-advanced' },
                h(
                  'label',
                  null,
                  t('task.timezone'),
                  h(
                    'select',
                    { value: draft.timezone, onChange: event => setDraft({ ...draft, timezone: event.target.value }) },
                    h('option', { value: 'Asia/Shanghai' }, 'Asia/Shanghai'),
                    h('option', { value: 'America/Los_Angeles' }, 'America/Los_Angeles'),
                    h('option', { value: 'UTC' }, 'UTC'),
                  ),
                ),
                h('label', { className: 'sp-check' }, h('input', { type: 'checkbox', checked: draft.newChat, onChange: event => setDraft({ ...draft, newChat: event.target.checked }) }), h('span', null, t('task.newChat'))),
              )
            : null,
          h(
            'div',
            { className: 'sp-task-actions' },
            h('button', { type: 'button', className: 'sp-btn', onClick: onClose }, t('task.cancel')),
            h('button', { type: 'submit', className: 'sp-btn dark', disabled: busy || !draft.title.trim() }, busy ? t('save.saving') : t('task.save')),
          ),
        ),
      );
    }

    function ScheduledView({ t, tasks, openSignal = 0, onChanged, toast }) {
      const [modal, setModal] = useState(null);
      useEffect(() => {
        if (openSignal > 0) setModal({ title: '' });
      }, [openSignal]);

      async function setStatus(task, status) {
        try {
          await api.updateTask(task.id, { status });
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
          ? h(TaskPanel, {
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

    function DocumentView({ t, item, onClose, onUpdated, onTrash, onOpenItem, toast }) {
      const isPage = item.kind === 'page';
      const isSite = item.kind === 'site';
      const makeBlock = (type = 'paragraph', text = '') => ({ id: `blk_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`, type, text, checked: false });
      const initialBlocks = isPage ? (item.blocks?.length ? item.blocks : [makeBlock('paragraph', item.body || '')]) : [];
      const [draft, setDraft] = useState({ title: item.title, blocks: initialBlocks });
      const [dirty, setDirty] = useState(false);
      const [saving, setSaving] = useState(false);
      const [shareOpen, setShareOpen] = useState(false);
      const [commentsOpen, setCommentsOpen] = useState(false);
      const [fileMenu, setFileMenu] = useState(false);
      const [insertMenu, setInsertMenu] = useState(false);
      const [blockMenu, setBlockMenu] = useState(null);
      const [slashBlock, setSlashBlock] = useState(null);
      const [info, setInfo] = useState(null);
      const [memberName, setMemberName] = useState('');
      const [comment, setComment] = useState('');
      const [message, setMessage] = useState('');
      const titleRef = useRef(null);
      const messageRef = useRef(null);
      const imageInputRef = useRef(null);
      const fileInputRef = useRef(null);

      useEffect(() => {
        const blocks = item.kind === 'page' ? (item.blocks?.length ? item.blocks : [makeBlock('paragraph', item.body || '')]) : [];
        setDraft({ title: item.title, blocks });
        setDirty(false);
        setShareOpen(false);
        setCommentsOpen(false);
        setFileMenu(false);
        setInsertMenu(false);
        setBlockMenu(null);
        setSlashBlock(null);
        setInfo(null);
      }, [item.id]);

      async function save() {
        if (!dirty || saving) return item;
        setSaving(true);
        try {
          const payload = isPage ? { title: draft.title, blocks: draft.blocks } : { title: draft.title };
          const updated = await api.updateItem(item.id, payload);
          setDraft({ title: updated.title, blocks: updated.blocks || draft.blocks });
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

      function updateBlock(id, patch) {
        setDraft(current => ({ ...current, blocks: current.blocks.map(block => (block.id === id ? { ...block, ...patch } : block)) }));
        setDirty(true);
      }

      function addBlock(type = 'paragraph', text = '', afterId = null) {
        const block = makeBlock(type, text);
        setDraft(current => {
          const blocks = [...current.blocks];
          const index = afterId ? blocks.findIndex(entry => entry.id === afterId) : blocks.length - 1;
          blocks.splice(index + 1, 0, block);
          return { ...current, blocks };
        });
        setDirty(true);
        setBlockMenu(null);
        setSlashBlock(null);
      }

      function convertBlock(id, type) {
        updateBlock(id, type === 'divider' ? { type, text: '' } : { type });
        setBlockMenu(null);
        setSlashBlock(null);
      }

      function removeBlock(id) {
        setDraft(current => (current.blocks.length <= 1 ? current : { ...current, blocks: current.blocks.filter(block => block.id !== id) }));
        setDirty(true);
        setBlockMenu(null);
      }

      function moveBlock(id, delta) {
        setDraft(current => {
          const blocks = [...current.blocks];
          const index = blocks.findIndex(block => block.id === id);
          const target = index + delta;
          if (index < 0 || target < 0 || target >= blocks.length) return current;
          [blocks[index], blocks[target]] = [blocks[target], blocks[index]];
          return { ...current, blocks };
        });
        setDirty(true);
        setBlockMenu(null);
      }

      function duplicateBlock(id) {
        setDraft(current => {
          const blocks = [...current.blocks];
          const index = blocks.findIndex(block => block.id === id);
          if (index < 0) return current;
          blocks.splice(index + 1, 0, { ...blocks[index], id: makeBlock().id });
          return { ...current, blocks };
        });
        setDirty(true);
        setBlockMenu(null);
      }

      const blockTypes = [
        ['paragraph', t('block.paragraph')],
        ['h1', t('block.h1')],
        ['h2', t('block.h2')],
        ['h3', t('block.h3')],
        ['bulleted', t('block.bulleted')],
        ['numbered', t('block.numbered')],
        ['todo', t('block.todo')],
        ['quote', t('block.quote')],
        ['code', t('block.code')],
        ['callout', t('block.callout')],
        ['highlight', t('block.highlight')],
        ['table', t('block.table')],
        ['divider', t('block.divider')],
      ];

      function blocksToMarkdown(blocks) {
        return blocks
          .map(block => {
            const text = block.text || '';
            if (block.type === 'h1') return `# ${text}`;
            if (block.type === 'h2') return `## ${text}`;
            if (block.type === 'h3') return `### ${text}`;
            if (block.type === 'bulleted') return `- ${text}`;
            if (block.type === 'numbered') return `1. ${text}`;
            if (block.type === 'todo') return `- [${block.checked ? 'x' : ' '}] ${text}`;
            if (block.type === 'quote') return `> ${text}`;
            if (block.type === 'code') return `\`\`\`\n${text}\n\`\`\``;
            if (block.type === 'divider') return '---';
            if (block.type === 'callout') return `> 提示：${text}`;
            if (block.type === 'highlight') return `> 高亮：${text}`;
            return text;
          })
          .join('\n\n');
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
            addBlock('paragraph', kind === 'image' ? `![${file.name}](image:${created.id})` : `[${file.name}](file:${created.id})`);
          } catch (error) {
            toast(error.message || t('toast.error'));
          }
        }
      }

      function downloadMarkdown() {
        const source = `# ${draft.title}\n\n${blocksToMarkdown(draft.blocks)}`;
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

      const fileGroups = [
        {
          label: null,
          items: [
            ['menu.show', () => setFileMenu(false)],
            ['menu.rename', () => { setFileMenu(false); try { titleRef.current?.focus(); titleRef.current?.select(); } catch { /* selection unavailable */ } }],
            [`menu.${item.pinned ? 'unpin' : 'pin'}`, () => { setFileMenu(false); void patch({ pinned: !item.pinned }); }],
            ['menu.delete', () => { setFileMenu(false); onTrash(item); }],
            ['page.share', () => { setFileMenu(false); setShareOpen(true); }],
          ],
        },
        {
          label: t('menu.copy'),
          items: [
            ['menu.copyMarkdown', downloadMarkdown],
            ['menu.editors', () => { setFileMenu(false); setInfo('editors'); }],
            ['menu.activity', () => { setFileMenu(false); setInfo('activity'); }],
          ],
        },
      ];

      const basicInsert = type => () => {
        setInsertMenu(false);
        addBlock(type);
      };
      const insertItems = [
        { key: 'generate', group: 'generate', label: t('insert.generate'), hint: t('insert.generateHint'), icon: 'star', action: () => { setInsertMenu(false); setMessage(t('insert.generateHint')); messageRef.current?.focus(); } },
        { key: 'visual', group: 'generate', label: t('insert.visual'), hint: t('insert.visualHint'), icon: 'grid', action: () => { setInsertMenu(false); toast(t('toast.soon').replace('{name}', t('insert.visual'))); } },
        { key: 'subpage', group: 'create', label: t('insert.subpage'), hint: t('insert.subpageHint'), icon: 'page', action: createSubpage },
        { key: 'image', group: 'media', label: t('insert.image'), hint: t('insert.imageHint'), icon: 'image', action: () => { setInsertMenu(false); imageInputRef.current?.click(); } },
        { key: 'file', group: 'media', label: t('insert.file'), hint: t('insert.fileHint'), icon: 'file', action: () => { setInsertMenu(false); fileInputRef.current?.click(); } },
        { key: 'agent', group: 'basic', label: t('insert.agent'), hint: t('insert.agentHint'), icon: 'message', action: () => { setInsertMenu(false); addBlock('callout', '智能体说明：'); } },
        { key: 'h1', group: 'basic', label: t('insert.h1'), icon: 'page', action: basicInsert('h1') },
        { key: 'h2', group: 'basic', label: t('insert.h2'), icon: 'page', action: basicInsert('h2') },
        { key: 'h3', group: 'basic', label: t('insert.h3'), icon: 'page', action: basicInsert('h3') },
        { key: 'numbered', group: 'basic', label: t('insert.numbered'), icon: 'list', action: basicInsert('numbered') },
        { key: 'todo', group: 'basic', label: t('insert.todo'), icon: 'check', action: basicInsert('todo') },
        { key: 'quote', group: 'basic', label: t('insert.quote'), icon: 'message', action: basicInsert('quote') },
        { key: 'code', group: 'basic', label: t('insert.code'), icon: 'file', action: basicInsert('code') },
        { key: 'table', group: 'basic', label: t('insert.table'), icon: 'grid', action: basicInsert('table') },
        { key: 'divider', group: 'basic', label: t('insert.divider'), icon: 'menu', action: basicInsert('divider') },
        { key: 'linkPage', group: 'basic', label: t('insert.linkPage'), icon: 'page', action: () => { setInsertMenu(false); addBlock('paragraph', '[[页面名]]'); } },
        { key: 'callout', group: 'basic', label: t('insert.callout'), icon: 'message', action: basicInsert('callout') },
        { key: 'highlight', group: 'basic', label: t('insert.highlight'), icon: 'star', action: basicInsert('highlight') },
      ];
      const insertGroups = ['generate', 'create', 'media', 'basic'];

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
              h('button', { type: 'button', className: 'sp-icon-btn', title: t('menu.page'), onClick: () => setFileMenu(true) }, h(Icon, { name: 'grid', size: 15 })),
              isPage ? h('button', { type: 'button', className: 'sp-icon-btn', title: t('menu.insert'), onClick: () => setInsertMenu(open => !open) }, h(Icon, { name: 'plus', size: 15 })) : null,
            ),
            fileMenu
              ? h(
                  'div',
                  { className: 'sp-filemenu' },
                  fileGroups.map(group =>
                    h(
                      'div',
                      { key: group.label || 'main' },
                      group.label ? h('div', { className: 'sp-menu-label' }, group.label) : null,
                      group.items.map(([key, action]) => h('button', { key, type: 'button', onClick: action }, t(key))),
                    ),
                  ),
                )
              : null,
            insertMenu
              ? h(
                  'div',
                  { className: 'sp-insert' },
                  insertGroups.map(group =>
                    h(
                      'div',
                      { key: group, className: 'sp-insert-group' },
                      h('div', { className: 'sp-insert-label' }, t(`insert.${group}`)),
                      insertItems
                        .filter(entry => entry.group === group)
                        .map(entry =>
                          h(
                            'button',
                            { key: entry.key, type: 'button', className: 'sp-insert-item', onClick: entry.action },
                            h(Icon, { name: entry.icon, size: 15 }),
                            h('span', null, h('strong', null, entry.label), entry.hint ? h('small', null, entry.hint) : null),
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
                h('button', { type: 'button', className: 'sp-share-btn', title: t('page.share'), onClick: () => setShareOpen(open => !open) }, h(Icon, { name: 'share', size: 15 }), h('span', null, t('page.share'))),
                shareOpen
                  ? h(
                      'div',
                      { className: 'sp-share' },
                      h('strong', null, t('share.title').replace('{name}', item.title)),
                      h('label', null, t('share.access'), h('select', { value: 'invited', disabled: true }, h('option', { value: 'invited' }, t('share.invited')))),
                      h('p', { className: 'sp-share-hint' }, t('share.invitedHint')),
                      h('div', { className: 'sp-share-label' }, t('share.members')),
                      h(
                        'form',
                        { className: 'sp-member-form', onSubmit: addMember },
                        h('input', { value: memberName, placeholder: t('share.addMember'), onChange: event => setMemberName(event.target.value) }),
                        h('button', { type: 'submit', className: 'sp-btn small dark', disabled: !memberName.trim() }, t('share.addMember')),
                      ),
                      h(
                        'div',
                        { className: 'sp-members' },
                        h('div', { className: 'sp-share-row' }, h('span', { className: 'sp-avatar small' }, 'U'), h('span', null, t('share.exampleUser')), h('em', null, t('share.owner'))),
                        item.members.map(member => h('div', { key: member.id, className: 'sp-share-row' }, h('span', { className: 'sp-avatar small' }, member.name.slice(0, 1).toUpperCase()), h('span', null, member.name), h('em', null, t('share.member')))),
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
              ? h(
                  'div',
                  { className: 'sp-blocks' },
                  draft.blocks.map((block, index) =>
                    h(
                      'div',
                      { key: block.id, className: `sp-block sp-block-${block.type}` },
                      h(
                        'button',
                        { type: 'button', className: 'sp-block-handle', title: t('block.menu'), onClick: () => setBlockMenu(blockMenu === block.id ? null : block.id) },
                        h(Icon, { name: 'dots', size: 14 }),
                      ),
                      block.type === 'todo' ? h('input', { type: 'checkbox', className: 'sp-block-check', checked: block.checked === true, onChange: event => updateBlock(block.id, { checked: event.target.checked }) }) : null,
                      block.type === 'bulleted' ? h('span', { className: 'sp-block-bullet' }, '•') : null,
                      block.type === 'numbered' ? h('span', { className: 'sp-block-number' }, `${index + 1}.`) : null,
                      block.type === 'divider'
                        ? h('hr', { className: 'sp-block-divider' })
                        : h('textarea', {
                            className: `sp-block-input sp-block-input-${block.type}`,
                            rows: Math.max(1, (block.text || '').split('\n').length),
                            value: block.text,
                            maxLength: 20000,
                            placeholder: block.type === 'paragraph' ? t('block.placeholder') : '',
                            onChange: event => {
                              const value = event.target.value;
                              updateBlock(block.id, { text: value });
                              if (value === '/') setSlashBlock(block.id);
                            },
                            onBlur: () => void save(),
                          }),
                      blockMenu === block.id
                        ? h(
                            'div',
                            { className: 'sp-blockmenu' },
                            h('div', { className: 'sp-insert-label' }, t('block.convert')),
                            blockTypes.map(([type, label]) => h('button', { key: type, type: 'button', onClick: () => convertBlock(block.id, type) }, label)),
                            h('hr'),
                            h('button', { type: 'button', onClick: () => moveBlock(block.id, -1) }, t('block.moveUp')),
                            h('button', { type: 'button', onClick: () => moveBlock(block.id, 1) }, t('block.moveDown')),
                            h('button', { type: 'button', onClick: () => duplicateBlock(block.id) }, t('block.duplicate')),
                            h('button', { type: 'button', onClick: () => addBlock('paragraph', '', block.id) }, t('block.addBelow')),
                            h('button', { type: 'button', onClick: () => removeBlock(block.id) }, t('block.delete')),
                          )
                        : null,
                      slashBlock === block.id
                        ? h(
                            'div',
                            { className: 'sp-slash sp-slash-block' },
                            h('div', { className: 'sp-insert-label' }, t('block.convert')),
                            blockTypes.map(([type, label]) =>
                              h('button', {
                                key: type,
                                type: 'button',
                                onClick: () => {
                                  convertBlock(block.id, type);
                                  if (type !== 'divider') updateBlock(block.id, { text: '' });
                                },
                              }, label),
                            ),
                            h('hr'),
                            h('button', { type: 'button', onClick: () => { setSlashBlock(null); imageInputRef.current?.click(); } }, t('insert.image')),
                            h('button', { type: 'button', onClick: () => { setSlashBlock(null); fileInputRef.current?.click(); } }, t('insert.file')),
                          )
                        : null,
                    ),
                  ),
                  h('button', { type: 'button', className: 'sp-add-block', onClick: () => addBlock() }, h(Icon, { name: 'plus', size: 15 }), t('block.add')),
                )
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

    function SpacePanel({ t }) {
      const [snapshot, setSnapshot] = useState(null);
      const [phase, setPhase] = useState('loading');
      const [section, setSection] = useState('all');
      const [tab, setTab] = useState('recommended');
      const [view, setView] = useState('list');
      const [query, setQuery] = useState('');
      const [menuOpen, setMenuOpen] = useState(false);
      const [active, setActive] = useState(null);
      const [taskSignal, setTaskSignal] = useState(0);
      const [collapsed, setCollapsed] = useState(false);
      const [toast, setToast] = useState('');
      const [trashItems, setTrashItems] = useState([]);
      const [trashKind, setTrashKind] = useState('file');
      const [recentExpanded, setRecentExpanded] = useState(false);
      const [templateOpen, setTemplateOpen] = useState(false);
      const [searchType, setSearchType] = useState('all');
      const [filterOpen, setFilterOpen] = useState(false);
      const [typeFilter, setTypeFilter] = useState('all');
      const [bellOpen, setBellOpen] = useState(false);
      const [searchOpen, setSearchOpen] = useState(false);
      const [searchText, setSearchText] = useState('');
      const [siteMenu, setSiteMenu] = useState(null);
      const [siteModal, setSiteModal] = useState(null);
      const toastTimer = useRef(null);
      const searchRef = useRef(null);
      const menuRef = useRef(null);
      const fileInputRef = useRef(null);

      const showToast = useCallback(message => {
        setToast(message);
        clearTimeout(toastTimer.current);
        toastTimer.current = setTimeout(() => setToast(''), 2600);
      }, []);
      useEffect(() => () => clearTimeout(toastTimer.current), []);

      const load = useCallback(async () => {
        try {
          const [data, trash] = await Promise.all([api.state(), api.state('?trash=1')]);
          setSnapshot(data);
          setTrashItems(trash.items);
          setPhase('ready');
        } catch (error) {
          setSnapshot(null);
          setPhase('error');
          showToast(error.message || t('toast.error'));
        }
      }, [showToast, t]);

      useEffect(() => {
        void load();
      }, [load]);

      useEffect(() => {
        if (!menuOpen) return undefined;
        const onDown = event => {
          if (menuRef.current && !menuRef.current.contains(event.target)) setMenuOpen(false);
        };
        const onKey = event => {
          if (event.key === 'Escape') setMenuOpen(false);
        };
        document.addEventListener('mousedown', onDown);
        document.addEventListener('keydown', onKey);
        return () => {
          document.removeEventListener('mousedown', onDown);
          document.removeEventListener('keydown', onKey);
        };
      }, [menuOpen]);

      const items = snapshot?.items || [];
      const pages = items.filter(item => item.kind === 'page');
      const recent = pages.slice(0, recentExpanded ? 12 : 3);
      const sectionKind = section === 'pages' ? 'page' : section === 'sites' ? 'site' : section === 'images' ? 'image' : section === 'drive' ? 'drive' : null;
      const tabs =
        section === 'all'
          ? [['recommended', t('tabs.recommended')], ['starred', t('tabs.starred')], ['mine', t('tabs.mine')], ['shared', t('tabs.shared')]]
          : [['all', t('tabs.all')], ['mine', t('tabs.projects')], ['shared', t('tabs.sharedPages')]];

      const filtered = useMemo(() => {
        let list = items;
        if (sectionKind) list = list.filter(item => item.kind === sectionKind);
        if (section === 'all') {
          if (tab === 'starred') list = list.filter(item => item.starred);
          if (tab === 'mine') list = list.filter(item => item.owned);
          if (tab === 'shared') list = list.filter(item => item.shared);
        } else if (tab === 'mine') list = list.filter(item => item.owned);
        else if (tab === 'shared') list = list.filter(item => item.shared);
        if (query.trim()) {
          const needle = query.trim().toLowerCase();
          list = list.filter(item => item.title.toLowerCase().includes(needle));
        }
        if (typeFilter !== 'all') {
          const ext = item => String(item.meta?.ext || '').toLowerCase();
          list = list.filter(item => {
            if (typeFilter === 'page') return item.kind === 'page';
            if (typeFilter === 'image') return item.kind === 'image';
            if (typeFilter === 'pdf') return ext(item) === 'pdf';
            if (typeFilter === 'doc') return ['doc', 'docx', 'txt', 'md'].includes(ext(item));
            if (typeFilter === 'sheet') return ['xls', 'xlsx', 'csv'].includes(ext(item));
            if (typeFilter === 'deck') return ['ppt', 'pptx', 'key'].includes(ext(item));
            return true;
          });
        }
        return list;
      }, [items, tab, section, sectionKind, query, typeFilter]);

      const trashList = useMemo(() => trashItems.filter(item => item.kind === trashKind), [trashItems, trashKind]);

      const searchResults = useMemo(() => {
        const needle = searchText.trim().toLowerCase();
        if (!needle) return [];
        let list = items.filter(item => item.title.toLowerCase().includes(needle));
        if (searchType === 'page') list = list.filter(item => item.kind === 'page');
        else if (searchType === 'image') list = list.filter(item => item.kind === 'image');
        else if (searchType === 'doc') list = list.filter(item => item.kind === 'file');
        else if (searchType === 'project') list = list.filter(item => ['folder', 'space', 'drive'].includes(item.kind));
        else if (searchType === 'chat') return [];
        return list.slice(0, 8);
      }, [items, searchText, searchType]);

      const sectionTitle =
        section === 'all' ? t('nav.all') : section === 'pages' ? t('nav.pages') : section === 'sites' ? t('nav.sites') : section === 'images' ? t('nav.images') : section === 'drive' ? t('nav.drive') : section === 'scheduled' ? t('scheduled.title') : t('nav.trash');

      function goSection(next) {
        setSection(next);
        setTab(next === 'all' ? 'recommended' : 'all');
        setQuery('');
        setActive(null);
      }

      function goTab(next) {
        setTab(next);
        setActive(null);
      }

      async function createPage(title, body) {
        setMenuOpen(false);
        try {
          const created = await api.createPage({ title: title || '', body: body || '' });
          await load();
          setActive(created);
        } catch (error) {
          showToast(error.message || t('toast.error'));
        }
      }

      async function createKind(kind) {
        setMenuOpen(false);
        try {
          const created = await api.createItem({ kind, title: '' });
          await load();
          setSection(kind === 'site' ? 'sites' : kind === 'image' ? 'images' : 'all');
          setTab(kind === 'site' || kind === 'image' ? 'all' : 'recommended');
          setActive(created);
        } catch (error) {
          showToast(error.message || t('toast.error'));
        }
      }

      async function uploadFiles(fileList) {
        setMenuOpen(false);
        const files = Array.from(fileList || []);
        if (!files.length) return;
        try {
          for (const file of files) {
            await api.createItem({
              kind: 'file',
              title: file.name,
              meta: { ext: (file.name.split('.').pop() || '').toLowerCase(), size: formatBytes(file.size), mime: file.type || '' },
            });
          }
          await load();
          showToast(t('toast.uploaded').replace('{count}', String(files.length)));
        } catch (error) {
          showToast(error.message || t('toast.error'));
        }
      }

      async function toggleTask(task) {
        try {
          await api.updateTask(task.id, { status: task.status === 'paused' ? 'active' : 'paused' });
          await load();
        } catch (error) {
          showToast(error.message || t('toast.error'));
        }
      }

      async function trashActive(item) {
        try {
          await api.trashItem(item.id);
          setActive(null);
          await load();
          showToast(t('trash.moved'));
        } catch (error) {
          showToast(error.message || t('toast.error'));
        }
      }

      async function restoreItem(item) {
        try {
          await api.restoreItem(item.id);
          await load();
        } catch (error) {
          showToast(error.message || t('toast.error'));
        }
      }

      async function deleteForever(item) {
        try {
          await api.deleteItem(item.id);
          await load();
        } catch (error) {
          showToast(error.message || t('toast.error'));
        }
      }

      function siteAction(item, action) {
        setSiteMenu(null);
        if (action === 'edit' || action === 'share') return void openItem(item);
        setSiteModal({ item, action });
      }

      function onMenuAction(key, label) {
        if (key === 'page') return void createPage('', '');
        if (key === 'upload') {
          setMenuOpen(false);
          fileInputRef.current?.click();
          return;
        }
        if (['site', 'image', 'folder', 'space'].includes(key)) return void createKind(key);
        if (key === 'templates') {
          setMenuOpen(false);
          setTemplateOpen(true);
          return;
        }
        setMenuOpen(false);
        showToast(t('toast.soon').replace('{name}', label));
      }

      async function openItem(item) {
        try {
          const full = await api.item(item.id);
          setActive(full);
        } catch (error) {
          showToast(error.message || t('toast.error'));
        }
      }

      async function toggleStar() {
        if (!active) return;
        try {
          const updated = await api.updateItem(active.id, { starred: !active.starred });
          setActive(updated);
          await load();
        } catch (error) {
          showToast(error.message || t('toast.error'));
        }
      }

      const templates = [
        ['template.intro', '页面使用入门'],
        ['template.todo', '待办清单'],
        ['template.tracker', '项目跟踪表'],
        ['template.weekly', '每周更新'],
      ];

      function templateBody(title) {
        if (title === '待办清单') return '# 待办清单\n\n- [ ] 第一项\n- [ ] 第二项\n';
        if (title === '项目跟踪表') return '# 项目跟踪表\n\n| 项目 | 负责人 | 状态 |\n| --- | --- | --- |\n|  |  |  |\n';
        if (title === '每周更新') return '# 每周更新\n\n## 本周完成\n\n## 下周计划\n\n## 风险\n';
        return '# 页面使用入门\n\n## 写作\n\n## 协作\n';
      }

      return h(
        'section',
        { className: 'sp-page', 'aria-label': t('panel') },
        h('style', null, styles),
        h('input', {
          type: 'file',
          multiple: true,
          ref: fileInputRef,
          style: { display: 'none' },
          onChange: event => {
            const files = event.target.files;
            event.target.value = '';
            void uploadFiles(files);
          },
        }),
        h(
          'nav',
          { className: 'sp-rail', 'aria-label': t('space') },
          h(
            'button',
            { type: 'button', className: `sp-rail-btn${section === 'all' || section === 'pages' ? ' active' : ''}`, title: t('rail.home'), onClick: () => goSection('all') },
            h(Icon, { name: 'home', size: 19 }),
          ),
          h(
            'button',
            { type: 'button', className: 'sp-rail-btn', title: t('rail.spaces'), onClick: () => goSection('all') },
            h(Icon, { name: 'folder', size: 19 }),
          ),
          h(
            'button',
            { type: 'button', className: `sp-rail-btn${section === 'scheduled' ? ' active' : ''}`, title: t('rail.scheduled'), onClick: () => goSection('scheduled') },
            h(Icon, { name: 'clock', size: 19 }),
          ),
          h(
            'button',
            { type: 'button', className: 'sp-rail-btn', title: t('rail.comments'), onClick: () => setBellOpen(true) },
            h(Icon, { name: 'message', size: 19 }),
          ),
          h('span', { className: 'sp-rail-spacer' }),
          h(
            'button',
            { type: 'button', className: 'sp-rail-btn', title: t('rail.more'), onClick: () => showToast(t('toast.soon').replace('{name}', t('rail.more'))) },
            h(Icon, { name: 'dots', size: 18 }),
          ),
        ),
        !collapsed &&
          h(
            'aside',
            { className: 'sp-sidebar' },
            h(
              'div',
              { className: 'sp-side-head' },
              h('span', { className: 'sp-side-title' }, section === 'scheduled' ? t('scheduled.title') : t('space')),
              h(
                'div',
                { className: 'sp-side-actions' },
                h('button', { type: 'button', className: 'sp-icon-btn', title: t('page.automation'), onClick: () => showToast(t('toast.automation')) }, h(Icon, { name: 'clock', size: 15 })),
                h(
                  'div',
                  { className: 'sp-notify-wrap' },
                  h('button', { type: 'button', className: 'sp-icon-btn', title: t('notify.title'), onClick: () => setBellOpen(open => !open) }, h(Icon, { name: 'message', size: 15 })),
                  bellOpen ? h('div', { className: 'sp-notify' }, h('strong', null, t('notify.empty')), h('p', null, t('notify.hint'))) : null,
                ),
                h('button', { type: 'button', className: 'sp-icon-btn', title: t('search'), onClick: () => setSearchOpen(true) }, h(Icon, { name: 'search', size: 15 })),
                h('button', { type: 'button', className: 'sp-icon-btn', title: t('rail.more'), onClick: () => setCollapsed(true) }, h(Icon, { name: 'menu', size: 15 })),
              ),
            ),
            h(
              'button',
              {
                type: 'button',
                className: 'sp-side-new',
                onClick: () => {
                  if (section === 'scheduled') setTaskSignal(value => value + 1);
                  else void createPage('', '');
                },
              },
              h(Icon, { name: 'plus', size: 15 }),
              section === 'scheduled' ? t('scheduled.new') : t('newPage'),
            ),
            section === 'scheduled'
              ? h(
                  'div',
                  null,
                  h('div', { className: 'sp-side-label' }, t('scheduled.upcoming')),
                  (snapshot?.tasks || []).slice(0, 3).map(task =>
                    h(
                      'button',
                      { key: task.id, type: 'button', className: 'sp-sched-task', onClick: () => void toggleTask(task) },
                      h('span', { className: 'sp-sched-task-title' }, task.title),
                      h('small', null, t(`task.status.${task.status}`)),
                    ),
                  ),
                  h('div', { className: 'sp-side-label' }, t('label.space')),
                  h(
                    'button',
                    { type: 'button', className: 'sp-nav-item', onClick: () => goSection('trash') },
                    h('span', { className: 'sp-nav-icon' }, h(Icon, { name: 'trash', size: 15 })),
                    h('span', null, t('nav.trash')),
                  ),
                )
              : h(
                  'div',
                  null,
                  h(
                    'div',
                    { className: 'sp-nav' },
                    [
                      ['all', 'menu', t('nav.all')],
                      ['pages', 'page', t('nav.pages')],
                      ['sites', 'site', t('nav.sites')],
                      ['images', 'image', t('nav.images')],
                      ['drive', 'drive', t('nav.drive')],
                    ].map(([key, icon, label]) =>
                      h(
                        'button',
                        { key, type: 'button', className: `sp-nav-item${section === key ? ' active' : ''}`, onClick: () => goSection(key) },
                        h('span', { className: 'sp-nav-icon' }, h(Icon, { name: icon, size: 15 })),
                        h('span', null, label),
                      ),
                    ),
                  ),
                  h('div', { className: 'sp-side-label' }, t('label.recent')),
                  h(
                    'div',
                    { className: 'sp-recent' },
                    recent.map(item =>
                      h(
                        'button',
                        { key: item.id, type: 'button', className: 'sp-recent-item', onClick: () => void openItem(item) },
                        h(Icon, { name: 'page', size: 13 }),
                        h('span', null, item.title),
                      ),
                    ),
                  ),
                  h('button', { type: 'button', className: 'sp-expand', onClick: () => setRecentExpanded(value => !value) }, recentExpanded ? t('label.collapse') : t('label.expand')),
                  h('div', { className: 'sp-side-label' }, t('label.space')),
                  h(
                    'button',
                    { type: 'button', className: `sp-nav-item${section === 'trash' ? ' active' : ''}`, onClick: () => goSection('trash') },
                    h('span', { className: 'sp-nav-icon' }, h(Icon, { name: 'trash', size: 15 })),
                    h('span', null, t('nav.trash')),
                  ),
                ),
            h(
              'div',
              { className: 'sp-usage' },
              h('strong', null, t('usage.title')),
              h('p', null, t('usage.desc')),
              h(
                'div',
                { className: 'sp-usage-actions' },
                h('button', { type: 'button', onClick: () => showToast(t('toast.usage')) }, t('usage.add')),
                h('button', { type: 'button', className: 'dark', onClick: () => showToast(t('toast.usage')) }, t('usage.upgrade')),
              ),
            ),
            h('div', { className: 'sp-avatar', title: t('rail.profile') }, 'U'),
          ),
        h(
          'main',
          { className: 'sp-main' },
          collapsed
            ? h('button', { type: 'button', className: 'sp-reopen', title: t('space'), onClick: () => setCollapsed(false) }, h(Icon, { name: 'menu', size: 16 }))
            : null,
          active
            ? h(DocumentView, {
                key: active.id,
                t,
                item: active,
                toast: showToast,
                onClose: () => setActive(null),
                onTrash: item => void trashActive(item),
                onOpenItem: item => setActive(item),
                onUpdated: updated => {
                  setActive(updated);
                  void load();
                },
              })
            : h(
                'div',
                null,
                h(
                  'div',
                  { className: 'sp-main-head' },
                  collapsed
                    ? h('button', { type: 'button', className: 'sp-icon-btn', title: t('space'), onClick: () => setCollapsed(false) }, h(Icon, { name: 'menu', size: 17 }))
                    : null,
                  h('h1', { className: 'sp-main-title' }, sectionTitle),
                  h('span', { className: 'sp-head-spacer' }),
                  h(
                    'label',
                    { className: 'sp-search' },
                    h(Icon, { name: 'search', size: 15 }),
                    h('input', {
                      ref: searchRef,
                      type: 'search',
                      value: query,
                      placeholder: t('search'),
                      'aria-label': t('search'),
                      onChange: event => setQuery(event.target.value),
                    }),
                  ),
                  h(
                    'div',
                    { className: 'sp-new-wrap', ref: menuRef },
                    h(
                      'button',
                      { type: 'button', className: 'sp-new-btn', onClick: () => setMenuOpen(open => !open) },
                      h(Icon, { name: 'plus', size: 15 }),
                      t('new'),
                    ),
                    menuOpen ? h(NewMenu, { t, onAction: onMenuAction, onClose: () => setMenuOpen(false) }) : null,
                  ),
                ),
                section === 'trash'
                  ? h(
                      'div',
                      { className: 'sp-trash' },
                      h(
                        'div',
                        { className: 'sp-tabs' },
                        [['file', t('trash.files')], ['page', t('trash.pages')]].map(([key, label]) =>
                          h('button', { key, type: 'button', className: `sp-tab${trashKind === key ? ' active' : ''}`, onClick: () => setTrashKind(key) }, label),
                        ),
                      ),
                      trashList.length === 0
                        ? h('div', { className: 'sp-empty' }, h('strong', null, t('trash.empty')), h('p', null, t('trash.hint')))
                        : h(
                            'div',
                            { className: 'sp-table' },
                            trashList.map(item =>
                              h(
                                'div',
                                { key: item.id, className: 'sp-tr' },
                                h('span', { className: 'sp-tr-name' }, h(Icon, { name: item.kind === 'page' ? 'page' : 'file', size: 15 }), h('span', null, item.title)),
                                h(
                                  'span',
                                  { className: 'sp-tr-actions' },
                                  h('button', { type: 'button', className: 'sp-btn small', onClick: () => void restoreItem(item) }, t('trash.restore')),
                                  h('button', { type: 'button', className: 'sp-btn small', onClick: () => void deleteForever(item) }, t('trash.delete')),
                                ),
                              ),
                            ),
                          ),
                    )
                  : section === 'scheduled'
                    ? h(ScheduledView, {
                          t,
                          tasks: snapshot?.tasks || [],
                          openSignal: taskSignal,
                          toast: showToast,
                          onChanged: load,
                        })
: h(
                        'div',
                        null,
                        h(
                          'div',
                          { className: 'sp-tabs' },
                          tabs.map(([key, label]) =>
                            h('button', { key, type: 'button', className: `sp-tab${tab === key ? ' active' : ''}`, onClick: () => goTab(key) }, label),
                          ),
                          h(
                            'div',
                            { className: 'sp-view' },
                            h(
                              'div',
                              { className: 'sp-filter-wrap' },
                              h('button', { type: 'button', className: `sp-icon-btn${typeFilter !== 'all' ? ' active' : ''}`, title: t('view.filter'), onClick: () => setFilterOpen(open => !open) }, h(Icon, { name: 'filter', size: 16 })),
                              filterOpen
                                ? h(
                                    'div',
                                    { className: 'sp-filter' },
                                    h('div', { className: 'sp-filter-label' }, t('filter.title')),
                                    ['all', 'page', 'image', 'doc', 'sheet', 'deck', 'pdf'].map(key =>
                                      h(
                                        'button',
                                        { key, type: 'button', className: `sp-filter-item${typeFilter === key ? ' active' : ''}`, onClick: () => { setTypeFilter(key); setFilterOpen(false); } },
                                        h('span', null, t(`filter.${key}`)),
                                        typeFilter === key ? h('span', null, '✓') : null,
                                      ),
                                    ),
                                  )
                                : null,
                            ),
                            h('button', { type: 'button', className: `sp-icon-btn${view === 'grid' ? ' active' : ''}`, title: t('view.grid'), onClick: () => setView('grid') }, h(Icon, { name: 'grid', size: 16 })),
                            h('button', { type: 'button', className: `sp-icon-btn${view === 'list' ? ' active' : ''}`, title: t('view.list'), onClick: () => setView('list') }, h(Icon, { name: 'list', size: 16 })),
                          ),
                        ),
                        section === 'all' && tab === 'recommended'
                          ? h(
                              'section',
                              { className: 'sp-section' },
                              h('h2', { className: 'sp-section-title' }, t('start')),
                              h(
                                'div',
                                { className: 'sp-cards' },
                                templates.map(([key, title]) =>
                                  h(
                                    'button',
                                    { key, type: 'button', className: 'sp-card', onClick: () => void createPage(title, templateBody(title)) },
                                    h(Icon, { name: 'page', size: 18 }),
                                    h('span', null, title),
                                  ),
                                ),
                              ),
                            )
                          : null,
                        phase === 'loading'
                          ? h('p', { className: 'sp-empty' }, '…')
                          : filtered.length === 0
                            ? h('div', { className: 'sp-empty' }, h('strong', null, query ? t('empty.search') : t('empty.title')), h('p', null, query ? '' : t('empty.hint')))
                            : view === 'grid'
                              ? h(
                                  'div',
                                  { className: 'sp-grid' },
                                  filtered.map(item =>
                                    h(
                                      'button',
                                      { key: item.id, type: 'button', className: 'sp-grid-item', onClick: () => void openItem(item) },
                                      h(Icon, { name: item.kind === 'page' ? 'page' : 'file', size: 18 }),
                                      h('span', null, item.title),
                                      h('small', null, relativeTime(item.updatedAt)),
                                    ),
                                  ),
                                )
                              : section === 'sites'
                                ? h(
                                    'div',
                                    { className: 'sp-table sp-site-table' },
                                    h('div', { className: 'sp-thead' }, h('span', null, t('table.name')), h('span', null, t('site.shared'))),
                                    filtered.map(item =>
                                      h(
                                        'div',
                                        { key: item.id, className: 'sp-tr sp-site-row' },
                                        h('button', { type: 'button', className: 'sp-tr-name sp-tr-button', onClick: () => void openItem(item) }, h(Icon, { name: 'site', size: 15 }), h('span', null, item.title)),
                                        h('span', { className: 'sp-tr-time' }, item.meta?.visibility || t('site.self')),
                                        h('button', { type: 'button', className: 'sp-icon-btn', title: t('rail.more'), onClick: event => { event.stopPropagation(); setSiteMenu(item); } }, h(Icon, { name: 'dots', size: 15 })),
                                      ),
                                    ),
                                  )
                                : h(
                                    'div',
                                    { className: 'sp-table' },
                                    h('div', { className: 'sp-thead' }, h('span', null, t('table.name')), h('span', null, t('table.time'))),
                                    filtered.map(item =>
                                      h(
                                        'button',
                                        { key: item.id, type: 'button', className: 'sp-tr', onClick: () => void openItem(item) },
                                        h('span', { className: 'sp-tr-name' }, h(Icon, { name: item.kind === 'page' ? 'page' : 'file', size: 15 }), h('span', null, item.title)),
                                        h('span', { className: 'sp-tr-time' }, relativeTime(item.updatedAt)),
                                      ),
                                    ),
                                  ),
                      ),
              ),
        ),
        templateOpen
          ? h(
              'div',
              { className: 'sp-modal-backdrop', onClick: event => { if (event.target === event.currentTarget) setTemplateOpen(false); } },
              h(
                'div',
                { className: 'sp-modal' },
                h('h2', null, t('start')),
                templates.map(([key, title]) =>
                  h(
                    'button',
                    { key, type: 'button', className: 'sp-template-row', onClick: () => { setTemplateOpen(false); void createPage(title, templateBody(title)); } },
                    h(Icon, { name: 'page', size: 16 }),
                    h('span', null, title),
                  ),
                ),
                h('div', { className: 'sp-modal-actions' }, h('button', { type: 'button', className: 'sp-btn', onClick: () => setTemplateOpen(false) }, t('task.cancel'))),
              ),
            )
          : null,
        searchOpen
          ? h(
              'div',
              { className: 'sp-searchbox' },
              h(
                'div',
                { className: 'sp-searchbox-head' },
                h(Icon, { name: 'search', size: 16 }),
                h('input', { autoFocus: true, value: searchText, placeholder: t('search'), onChange: event => setSearchText(event.target.value) }),
                h('button', { type: 'button', className: 'sp-icon-btn', onClick: () => { setSearchOpen(false); setSearchText(''); } }, h(Icon, { name: 'close', size: 15 })),
              ),
              h(
                'div',
                { className: 'sp-search-tabs' },
                ['all', 'chat', 'image', 'doc', 'page', 'project'].map(key =>
                  h('button', { key, type: 'button', className: `sp-search-tab${searchType === key ? ' active' : ''}`, onClick: () => setSearchType(key) }, t(`search.type.${key}`)),
                ),
              ),
              searchText.trim()
                ? searchResults.length
                  ? searchResults.map(item =>
                      h(
                        'button',
                        { key: item.id, type: 'button', className: 'sp-searchitem', onClick: () => { setSearchOpen(false); setSearchText(''); void openItem(item); } },
                        h(Icon, { name: item.kind === 'page' ? 'page' : item.kind === 'site' ? 'site' : 'file', size: 15 }),
                        h('span', null, item.title),
                      ),
                    )
                  : h('p', { className: 'sp-help' }, t('empty.search'))
                : h(
                    'div',
                    null,
                    h('div', { className: 'sp-side-label' }, t('search.recent')),
                    ['示例聊天 1', '示例聊天 2', '示例聊天 3', '示例聊天 4', '示例聊天 5', '示例聊天 6'].map(label =>
                      h('button', { key: label, type: 'button', className: 'sp-searchitem', onClick: () => setSearchText(label) }, h(Icon, { name: 'message', size: 15 }), h('span', null, label)),
                    ),
                  ),
            )
          : null,
        siteMenu
          ? h(
              'div',
              { className: 'sp-sitemenu' },
              h('strong', null, siteMenu.title),
              ['share', 'edit', 'analytics', 'settings'].map(action =>
                h('button', { key: action, type: 'button', onClick: () => siteAction(siteMenu, action) }, t(`site.${action}`)),
              ),
              h('button', { type: 'button', onClick: () => setSiteMenu(null) }, t('task.cancel')),
            )
          : null,
        siteModal
          ? h(
              'div',
              { className: 'sp-modal-backdrop', onClick: event => { if (event.target === event.currentTarget) setSiteModal(null); } },
              h(
                'div',
                { className: 'sp-modal' },
                h('h2', null, siteModal.action === 'analytics' ? t('site.analyticsTitle') : t('site.settings')),
                h('p', null, siteModal.item.title),
                siteModal.action === 'analytics'
                  ? h('p', { className: 'sp-help' }, t('site.analyticsEmpty'))
                  : h('div', null, h('p', null, `${t('site.shared')}：${siteModal.item.meta?.visibility || t('site.self')}`), h('p', { className: 'sp-help' }, t('site.termsHint'))),
                h('div', { className: 'sp-modal-actions' }, h('button', { type: 'button', className: 'sp-btn dark', onClick: () => setSiteModal(null) }, t('share.done'))),
              ),
            )
          : null,
        toast ? h('div', { className: 'sp-toast', role: 'status' }, toast) : null,
      );
    }

    const inject = ['slots', 'locale'];

    function apply(ctx) {
      ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'space-workspace: dictionaries');
      const t = ctx.locale.bind(NS);

      ctx.effect(() => ctx.slots.inject('sidebar.panellist', () =>
        ctx.slots.register({ name: 'sidebar.panellist', id: PANEL_ID, order: 20, locale: NS, label: () => t('panel') }, SpaceIcon)),
      'space-workspace: sidebar');
      ctx.effect(() => ctx.slots.inject('main', () =>
        ctx.slots.register({ name: 'main', key: PANEL_ID, locale: NS }, SpacePanel)),
      'space-workspace: panel');
    }

    function SpaceIcon({ size = 18 }) {
      return h(Icon, { name: 'space', size });
    }

    return { apply, inject };
  },
});
