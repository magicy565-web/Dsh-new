// This repository supplies plugins; DeepSeek Harness owns the running agent.
import { fileURLToPath } from 'node:url';

console.log('执行宿主：DeepSeek Harness。请在 DSH 的插件管理工具中安装以下本机目录：');
for (const name of ['dsh-workspace-library', 'dsh-space-workspace', 'dsh-sourcing-agent']) {
  console.log(`plugin_manager install_bundle target=${fileURLToPath(new URL(`../integrations/dsh/${name}`, import.meta.url))}`);
}
console.log('本命令只显示安装位置，不启动服务、不修改 profile，也不安装插件。');
