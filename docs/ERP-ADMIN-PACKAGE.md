# ERP Admin 插件包交付

两个原生 DSH bundle：`dsh-mini-erp@0.3.1` 与 `dsh-workspace-library@1.3.1`。后台留在 DSH 内，共用宿主登录、工作区、附件、工具和权限，不启动独立网页应用或业务服务器。

## 安装

要求 Node 24+、DeepSeek Harness Web。已在官方 `0.2.1-rc.2` 验证。宿主需启用原生 workspaceRegistry、附件及 Web 认证能力。

下载仓库后，在 DSH 中依次安装这两个本地目录：

```text
plugin_manager install_bundle target=<仓库绝对路径>/integrations/dsh/dsh-workspace-library
plugin_manager install_bundle target=<仓库绝对路径>/integrations/dsh/dsh-mini-erp
```

遵循原生插件管理器的重启提示，刷新浏览器，打开 DSH 侧栏 ERP。使用原生工作区入口添加实际目录后，ERP 工作区选择器会显示它。文件读取和上传只访问宿主实际可达的文件；云端不会自动读取用户电脑。

已有目录安装可以更新仓库、重启 DSH 并刷新浏览器。保持原 profile 和数据目录；不要通过删除数据来升级。商品、附件、客户、历史订单和原请求回执继续复用，当前数据库仍为 v3。

## 生成可搬运安装包

从仓库根目录执行，输出必须在仓库外：

```sh
node scripts/package-erp-admin.mjs /absolute/path/erp-admin-package
```

生成：

- `dsh-workspace-library-1.3.1.tgz`
- `dsh-mini-erp-0.3.1.tgz`
- `manifest.json`：版本、大小和 SHA-256
- `INSTALL.md`：安装说明

脚本调用 `npm pack --ignore-scripts`，只收集两个包的运行文件白名单；不安装、不发布、不打包业务数据。将两个 `.tgz` 搬到目标宿主后，可按上面顺序将绝对 `.tgz` 路径作为原生 `install_bundle target`。无需根仓库的 React/JSDOM 测试依赖。

## 实际截图

来自真实 DSH Web 空数据 profile，无演示商品或虚构交易。

| 页面 | 桌面 | 手机 |
| --- | --- | --- |
| 首页 | [打开](screenshots/erp-admin/home.png) | [打开](screenshots/erp-admin/home-mobile.png) |
| 商品编辑器 | [打开](screenshots/erp-admin/product-form.png) | [打开](screenshots/erp-admin/product-form-mobile.png) |
| 店铺设置 | [打开](screenshots/erp-admin/settings.png) | — |
| 搜索与键盘选择 | [打开](screenshots/erp-admin/search.png) | — |
| 移动菜单 | — | [打开](screenshots/erp-admin/menu-mobile.png) |
| 深色首页 | [打开](screenshots/erp-admin/home-dark.png) | — |

## 能力边界

商品、客户、文件、店铺资料接通原有存储；订单与库存仅接通既有预留和分配能力。营销、折扣、市场、分析、支付、配送、在线商店等页面显示未接入。没有模拟营收、付款成功、物流状态或公开商店。

完整页面清单、搜索／分页范围与验证方法见 [设计与验收](ERP-ADMIN-DESIGN.md)。这套包面向单企业可信经营者，未实现多商家隔离、远程电脑读取、工单服务器或公开买手交易。

包体已在全新临时目录离线安装，使用官方 Cordis、ToolRuntime 和 LocalAttachmentStore 加载，读取独立 ERP 数据并保存临时附件通过；不代表另一台电脑或公网生产环境已验收。可重复执行：

```sh
DSH_RUNTIME_DIR=/path/to/official-runtime node integrations/dsh/dsh-mini-erp/dev/package-smoke.mjs /absolute/path/erp-admin-package
```
