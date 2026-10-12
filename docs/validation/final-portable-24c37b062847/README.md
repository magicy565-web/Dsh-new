# 固定源码与便携包验收记录

## 当前交付状态

- 已发布固定源码：`24c37b06284720b4b9d8d7b79dc19d56ef5d51b1`；Git tree：`1ac8a5f2b3c7e2d01a35f7d0617ee8ec38c277f9`。
- 此目录是后续**纯文本验收证据**，没有改动固定源码。
- 源码 ZIP 和微信导入 ZIP 已在本地生成、校验、安全解包并完成干净重建一致性检查。**ZIP 上传结果尚未确认，本目录不宣称 GitHub 已交付 ZIP。** 待审批/中断上传未重试。
- 便携源码含 584 个原始文件，明确排除 593 个历史产物路径；39 个小程序客户端文件。`exactGitTree=false`，不包含完整历史文件内容或 Git 历史；固定 GitHub 提交始终是源码依据。

## 固定源码测试

`npm run test:all` 正常退出：后端 698 通过、8 跳过、0 失败；生产 DOM 19/19；会话 DOM 17/17；小程序编译完成。
另跑当前 Library/旧 Supply 组件合约 13/13、小程序业务 126/126、打包工具 35/35、Pi/MCP/原始流程 14/14，以及三组真实 Pi CLI PTY（8、7、8 项检查）。供应商、模型、Host/Muse 和商店交互仍使用本地合成 fixture，不代表真实账户端到端验收。

相较旧云端后端 699 通过/7 跳过，本次额外跳过的是需要祖先 Git 对象的历史源码证明；当前业务断言未删除。源码包不带 Git 历史，干净解包后同样明确跳过该证明。

## 干净解包与字节比较

使用归档本身安全解包，重新从锁文件安装依赖，并执行构建及完整 `test:all`。日志包含后端 698/8、DOM 19/19、会话 17/17 的成功汇总及最后的小程序构建完成记录。工具等待中断导致未收到该外层进程的最终退出码，因此该值在 JSON 中保持 null；未启动的额外小程序/Pi 重复测试不计入结果。

后续独立只读核验确认：584 个源码文件的 Git blob、SHA-256 和权限均未变化；干净 Web 构建的 3 个文件与原构建字节完全一致；干净小程序构建的 39 个文件全部匹配导入包清单。`clean-byte-comparison.json` 因此记录 `compiledEquivalenceVerified=true`。早先仅检查归档完整性的 `verification.json` 仍保留其当时的 false，不篡改较早记录。

## 明确未完成的验收

原 Chromium 启动在页面断言前受 `socket() failed: Operation not permitted` 阻挡，没有新浏览器截图/通过证明，也未修改安全设置或换路径绕行。历史截图仍是历史证据。
固定源码的 GitHub Actions 运行 `38307718624` 是 `startup_failure`，任务数 0，不算 CI 通过。真实模型、原生 Host/Muse、Shopify/GA4、微信工具/真机、连续七天通知、Windows 和独立安全验收仍未通过。没有部署、生产调用、凭据、权限扩张、main 修改或合并。

## 本地已验证归档哈希

- `Workspace-Agent-Portable-Source-24c37b062847.zip`：2,556,122 字节；SHA-256 `f4b43891cc1868bd5dccb1700d56cf5f609f74c4e8a4a5c93707dbabd00203c2`
- `Workspace-Agent-Portable-WeChat-Import-24c37b062847.zip`：113,627 字节；SHA-256 `0d0e88ea1cc5cadef008c3b9ebc01e6bbe209d98c5a0ceb6768d62c259271a6f`

小程序仍采用 `touristappid`、`urlCheck=true`、空 `baseUrl`；账户条件不满足时保持阻挡。重新生成与验证的命令见固定源码中的 `miniprogram/scripts/PORTABLE-DELIVERY.md`，请将源码提交明确固定为上述完整 SHA，勿把历史包当成当前包。
