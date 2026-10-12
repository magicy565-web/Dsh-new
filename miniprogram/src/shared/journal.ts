/** Local recovery only. No login code, session token, CSRF or account secrets. */
export type Pending = { kind: 'send' | 'action' | 'upload' | 'references' | 'create'; path: string; body: Record<string, unknown>; conversationId?: string; key: string; review?: { title: string; detail: string } };
export type Checkpoint = { version: 1; owner: string; baseUrl: string; conversationId: string; pending: Pending | null };
export type Journal = { read(owner?: string, baseUrl?: string): Checkpoint | null; write(value: Checkpoint): void };

export function fileJournal(platform: Pick<typeof wx, 'getFileSystemManager' | 'env'>): Journal {
  const fs = platform.getFileSystemManager();
  const location = (owner: string, baseUrl: string) => {
    // Full reversible namespace avoids hash collisions and filesystem name limits.
    const namespace = encodeURIComponent(JSON.stringify([baseUrl, owner]));
    const directory = `${platform.env.USER_DATA_PATH}/workspace-recovery/${namespace.match(/.{1,80}/g)?.join('/')}`;
    return { directory, path: `${directory}/checkpoint.json` };
  };
  return {
    read(owner, baseUrl) {
      if (!owner || !baseUrl) return null;
      const { path } = location(owner, baseUrl);
      try { return JSON.parse(String(fs.readFileSync(path, 'utf8'))) as Checkpoint; }
      catch (error) {
        const detail = error instanceof Error ? error.message : (error as { errMsg?: string })?.errMsg || String(error);
        if (/no such file|not found|ENOENT/i.test(detail)) return null;
        throw new Error('本机恢复记录无法读取，请先核对存储空间。');
      }
    },
    write(value) {
      const { directory, path } = location(value.owner, value.baseUrl);
      try {
        fs.mkdirSync(directory, true);
        fs.writeFileSync(`${path}.next`, JSON.stringify(value), 'utf8');
        fs.renameSync(`${path}.next`, path);
      } catch { throw new Error('本机恢复记录无法保存，请核对云端状态，避免新建重复操作。'); }
    },
  };
}
