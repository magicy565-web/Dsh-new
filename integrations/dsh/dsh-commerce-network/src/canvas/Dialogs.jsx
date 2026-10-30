import React from 'react';
import { ArrowRight, ShieldCheck } from 'lucide-react';
import { Dialog } from '../Inspector.jsx';
import { KindIcon, familyClass } from '../NodeCard.jsx';
import { KINDS } from '../model.mjs';
import { KeyHint } from '../ui.jsx';
import { SHORTCUTS } from './shortcuts.mjs';

export function ShortcutsDialog({ onClose }) {
  const groups = [...new Set(SHORTCUTS.map((shortcut) => shortcut.group))];
  return (
    <Dialog title="快捷键" onClose={onClose} wide footer={<button type="button" className="cn-button" onClick={onClose}>关闭</button>}>
      <p className="cn-field-note">在画布中使用。输入框、对话框和菜单里不会拦截这些按键。触控板双指滑动平移，双指捏合缩放；鼠标用 Ctrl/⌘ + 滚轮缩放，空格 + 拖动或中键拖动平移。</p>
      <div className="cv-shortcuts">
        {groups.map((group) => (
          <section key={group}>
            <h3>{group}</h3>
            <dl>
              {SHORTCUTS.filter((shortcut) => shortcut.group === group).map((shortcut) => (
                <div key={shortcut.id}><dt>{shortcut.label}{shortcut.note && <small>{shortcut.note}</small>}</dt><dd><KeyHint keys={shortcut.keys} /></dd></div>
              ))}
            </dl>
          </section>
        ))}
      </div>
    </Dialog>
  );
}

function Party({ node }) {
  return <div className={`cv-party ${familyClass(node.kind)}`}><span className="cn-node-icon"><KindIcon kind={node.kind} size={16} /></span><span><b>{node.title}</b><small>{KINDS[node.kind]}</small></span></div>;
}

/** Confirms a drawn connection. Confirming only hands a request to the Assistant; nothing is authorised or sent. */
export function ConnectDialog({ rule, source, target, busy, onClose, onConfirm }) {
  return (
    <Dialog title={rule.label} onClose={onClose} footer={<><button type="button" className="cn-button" onClick={onClose} disabled={busy}>取消</button><button type="button" className="cn-button cn-primary" disabled={busy} onClick={onConfirm}>{busy ? '正在提交…' : '交给 Assistant'}</button></>}>
      <div className="cv-connect"><Party node={source} /><ArrowRight size={16} aria-hidden="true" /><Party node={target} /></div>
      <div className="cv-assure"><ShieldCheck size={18} aria-hidden="true" /><p>{rule.note}</p></div>
      <p className="cn-field-note">Assistant 会先读取当前网络，缺少的资料在左侧会话里向你确认。保存后的草稿仍需你在画布上审核授权。</p>
    </Dialog>
  );
}
