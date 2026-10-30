import React from 'react';
import { Activity, Network, ChevronDown, Briefcase, Wallet, RefreshCw, Users, Ellipsis, Sun, Moon, MonitorCog, Keyboard, Inbox, FileSignature, ClipboardList, ChevronRight } from 'lucide-react';
import { IconButton, MenuButton, MenuItem, MenuLabel, MenuSeparator, Segmented } from '../ui.jsx';
import { VIEWS } from './kinds.mjs';
import { THEME_CHOICES } from './theme.mjs';
import { SyncIndicator } from './SyncIndicator.jsx';

const THEME_ICON = { auto: MonitorCog, light: Sun, dark: Moon };

export function TopBar({
  projects, projectId, onProject, view, onView, sync, loading, workspaceId, onRetry, decisions, onDecisions, budgetText, hasProject,
  onBudget, onWorkbench, onMandates, onImport, refreshing, onRefresh, membersOpen, onMembers, themeChoice, onTheme, onHelp, activityOpen = false, onActivity,
}) {
  return (
    <header className="cv-topbar">
      <div className="cv-heading">
        <span className="cv-brand"><Network size={18} strokeWidth={1.7} aria-hidden="true" /></span>
        <div>
          <span className="cn-eyebrow">CHANNEL ATLAS</span>
          {projects.length ? (
            <label className="cn-project-select">
              <span className="cn-sr-only">当前协作项目</span>
              <select value={projectId || ''} onChange={onProject}>{projects.map((project) => <option key={project.id} value={project.id}>{project.name || project.title}</option>)}</select>
              <ChevronDown size={13} aria-hidden="true" />
            </label>
          ) : <h1>商业协作网络</h1>}
        </div>
      </div>
      <Segmented className="cv-views" label="画布视图" value={view} options={VIEWS} onChange={onView} />
      <div className="cv-topbar-actions">
        <SyncIndicator sync={sync} loading={loading} connected={Boolean(workspaceId)} onRetry={onRetry} />
        {decisions > 0 && <button type="button" className="cv-pill" onClick={onDecisions}><span aria-hidden="true" />{decisions} 项待决策<ChevronRight size={12} aria-hidden="true" /></button>}
        {hasProject && <button type="button" className="cv-chip" onClick={onBudget} title="项目服务预算"><Wallet size={14} aria-hidden="true" /><span>{budgetText}</span></button>}
        <MenuButton label="业务操作" icon={<Briefcase size={16} />} text="业务" buttonClassName="cv-menu-button" disabled={loading}>
          {(close) => (
            <>
              <MenuItem icon={<ClipboardList size={15} />} disabled={!hasProject} reason="请先创建协作项目" onSelect={() => { close(); onWorkbench(); }}>业务推进</MenuItem>
              <MenuItem icon={<FileSignature size={15} />} disabled={!workspaceId} reason="工作区未连接" onSelect={() => { close(); onMandates(); }}>业务委托</MenuItem>
              <MenuItem icon={<Inbox size={15} />} disabled={!hasProject} reason="请先创建协作项目" onSelect={() => { close(); onImport(); }}>导入询盘</MenuItem>
            </>
          )}
        </MenuButton>
        {onActivity && <IconButton label="协作动态" className="cv-short-only" pressed={activityOpen} active={activityOpen} onClick={onActivity}><Activity size={16} /></IconButton>}
        <IconButton label="协作成员" pressed={membersOpen} active={membersOpen} onClick={onMembers}><Users size={17} /></IconButton>
        <IconButton label="刷新真实状态" disabled={refreshing} onClick={onRefresh}><RefreshCw size={16} className={refreshing ? 'cn-spin' : ''} /></IconButton>
        <MenuButton label="更多" icon={<Ellipsis size={17} />}>
          {(close) => (
            <>
              <MenuLabel>外观</MenuLabel>
              {THEME_CHOICES.map((choice) => {
                const Icon = THEME_ICON[choice.id];
                return <MenuItem key={choice.id} role="menuitemradio" checked={themeChoice === choice.id} icon={<Icon size={15} />} onSelect={() => { onTheme(choice.id); close(); }}>{choice.label}</MenuItem>;
              })}
              <MenuSeparator />
              <MenuItem icon={<Keyboard size={15} />} hint="?" onSelect={() => { close(); onHelp(); }}>快捷键</MenuItem>
            </>
          )}
        </MenuButton>
      </div>
    </header>
  );
}
