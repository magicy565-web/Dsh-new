# 工厂代运营业务工作台

本批在 Commerce 1.4.0-rc.1 增加“业务推进”入口，复用原生 DSH 和已有委托、项目、主体、工单、交付及画布。不修改 Mini ERP，不建立另一套订单、库存、聊天或 Agent 执行器。

## 可操作的范围

在 Commerce Network 选择项目，点击“业务推进”，选择一份工厂代运营委托。列表和详情显示业务阶段、负责主体、下一步、阻碍以及关联工单的待处理事项。条款和独立服务账单继续使用原有入口；工单授权、交付验收和异常处理打开原有工单详情。

七个阶段为接受委托、产品准备、渠道开发、询盘跟进、报价协作、成交依据核对、服务复盘与对账。它们是运营人员记录的业务阶段，不是可执行 DAG，也不证明对应工作已完成。允许直接跳转、回退、暂停或标记阻碍，每次须填写下一步与更新依据。负责主体是本项目业务主体，不是新登录账号或权限。

“请 Assistant 分析下一步”向当前原生会话提交明确请求与委托引用，要求先读取真实数据。没有新 Agent loop；本批未声称真实第三方 Personal Agent 已接入。进展只能由 Owner 确认保存，Agent 可通过现有 commerce_network_read 读取并提出建议。工具不能代替 Owner 记录阶段。

补充关联工单只记录业务关系，不分享资源、不批准工单、不派工。待处理事项来自现有工单状态，包括待授权、待验收、执行失败与停止待确认。成果只能选取关联工单中已验收的实际交付；保存时检查所属项目、工单关联、验收回执、交付编号及内容 SHA-256。验收调研成果不等于证实成交。

## 数据与兼容性

在既有 mandates 记录增加可选 progress 和 progressHistory，不新增事实表或迁移历史记录。旧委托没有进展时显示“尚未记录”，不补造业务过程。仅当前已审核且生效的工厂委托可以更新；其他模式保留原有委托功能，失效和撤销的委托历史只读。

每次更新独立递增 progress.revision，同时递增原网络修订用于并发控制。商业条款版本、mandate.revision 和批准回执保持原样，因此正常进展更新不会使草稿账单失效。进展记录固定当时的条款版本和批准回执；条款修改或重新批准后，旧进展标记待重新核对。商业条款历史不重复复制进展历史。

所有写入复用现有原子事务、原生会话作用域、同源 Owner HTTP 验证、幂等回执与审计。追加进展保留完整历史，不能删除覆盖；每份委托最多 200 条，单次最多补充 30 个工单、引用 30 个成果，达到上限时明确拒绝而不截断。重试使用完全相同的请求内容；原请求按会话、工作区和项目保存在浏览器 sessionStorage，响应未知时锁定后续操作，重载后可以核对。关闭整个浏览器会话可能清除该临时存储；服务端回执仍保留，不能把新请求号当成原请求重试。

画布节点继续使用原 ID 和布局；副标题显示当前运营阶段，业务关联边包含补充关联工单。正文交付仍按需从原交付接口读取，不复制到进展中。进展历史保留选取成果的编号、哈希和验收回执。

## 安装与验证

```sh
npm ci --ignore-scripts
npm run check
npm run test:client
npm run build:commerce-client
node scripts/package-commerce-business.mjs dist/workbench --only=dsh-commerce-network
DSH_HOME=/absolute/path/to/dsh-home dsh plugin --profile web add \
  /absolute/path/to/dist/workbench/dsh-commerce-network-1.4.0-rc.1.tgz
```

独立服务账单沿用 dsh-service-billing 0.1.0-rc.1，可选安装。Mini ERP 不需要安装或升级。升级前正常备份 Commerce 数据目录与原生附件；不要把数据目录指向 ERP。回退旧包前恢复兼容备份，旧版本不认识进展字段，不保证后续写入仍保留新增语义。

专项入口：

- 服务与实际 HTTP：`node --test integrations/dsh/dsh-commerce-network/test/business-progress.test.mjs`
- 真实 SQLite 驱动的客户端：`node integrations/dsh/dsh-commerce-network/dev/business-workbench-smoke.mjs`
- 官方 Cordis/Tools 与独立 Billing：`DSH_RUNTIME_DIR=/path/to/official/dsh node integrations/dsh/dsh-commerce-network/dev/workbench-native-smoke.mjs`
- 官方 Web：`integrations/dsh/dsh-commerce-network/dev/workbench-browser-smoke.mjs`，环境变量沿用上一批浏览器验收说明。使用自己的隔离宿主日志、浏览器身份文件和 Commerce 合成夹具；私密文件不随源码分发。第二次运行先核对前一轮持久化记录，重启宿主后运行验证恢复。

本批没有新增商机 CRM、订单履约、报价发送、成交认证、佣金计提或 AI Credits 计量。七阶段操作验收证明的是业务进展记录与关联流程，不是海外销售已经真实完成。真实邮件仍待配置。
