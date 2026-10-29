// Read-only guide. Installation and execution belong to the official DSH CLI.
import { readFileSync } from 'node:fs';
const version = name => JSON.parse(readFileSync(new URL(`../integrations/dsh/${name}/package.json`, import.meta.url), 'utf8')).version;
console.log(`当前交付：Commerce ${version('dsh-commerce-network')} + 独立 Service Billing ${version('dsh-service-billing')}`);
console.log('npm start 只显示说明；本仓库不是独立网页应用。未安装、未启动、未修改任何数据。');
console.log('\n先阅读 docs/COMMERCE-PILOT-QUICKSTART.md（含 Windows / macOS / Linux 步骤）。');
console.log('源码构建：npm ci --ignore-scripts，然后 npm run package:business-services。');
console.log('官方宿主：npm install -g @deepseek-ai/dsh@0.2.1-rc.3（要求 Node.js 24+）。');
console.log('在自己的终端设置独立 DSH_HOME 后，使用官方 CLI 安装：');
console.log(`dsh plugin --profile web add ./dist/business-services/dsh-commerce-network-${version('dsh-commerce-network')}.tgz ./dist/business-services/dsh-service-billing-${version('dsh-service-billing')}.tgz`);
console.log('启动：dsh --profile web --host 127.0.0.1 --port 4187 --no-open');
console.log('打开终端输出的完整本地链接，新建原生会话，再打开右侧 Commerce Network。');
console.log('本次试用不需要安装 Mini ERP。真实发信、支付和生产发布均未启用。');
