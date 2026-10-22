# dsh-space-workspace

ChatGPT 式 **Space / Workspace** 的 Harness 实现。左侧栏新增「空间」面板，
内部是 64px 导航栏 + 300px 空间侧栏 + 内容区，对标 Figma 文件
`Space 交互复原 · 工厂与销售企业 Workspace` 的 `01 · 实测 Space 复原` 页面。

## 功能

- **左栏**：主页 / 空间 / 定时任务 / 评论通知 / 更多
- **空间侧栏**：时钟/搜索/通知/收起、`+ 新建页面`、`全部 / 页面 / 站点 / 图像 / Google Drive`、`最近`、`展开显示`、`空间`、`回收站`、用量卡片、头像
- **列表**：搜索、`新建` 菜单、`推荐 / 收藏 / 你的内容 / 与你共享`、类型筛选（页面/图像/文档/电子表格/演示文稿/PDF）、列表/网格、4 张模板卡、`名称 / 上次活动时间`
- **页面**：块编辑器（正文/标题 1–3/列表/编号/待办/引用/代码/表格/分割线/提示/高亮/智能体说明）；块菜单可转换、上移/下移、复制、删除、下方添加；块内输入 `/` 打开转换菜单；标题和块内容保存到 `blocks`；标题下拉菜单（显示、重命名、置顶、删除、分享、复制 → Markdown 下载/编辑者信息/页面动态）；`+` 插入菜单；收藏
- **分享**：访问权限（仅限受邀者，和实测一致）、添加成员、成员列表、复制链接；不虚构公开链接
- **评论**：右侧评论抽屉，写入条目并持久化
- **站点**：3 条示例站点、`共享对象` 列、行菜单（共享/编辑/分析/设置）、站点使用条款卡片、站点分析弹层
- **回收站**：删除即软删除，`文件 / 页面` 分栏，恢复/永久删除，30 天提示
- **通知**：侧栏通知弹层，`暂无通知` 空态
- **搜索**：侧栏搜索打开弹层，`全部/聊天/图像/文档/页面/项目` 分类，空态显示 6 条「最近聊天」，输入后实时匹配条目
- **定时任务**：任务列表与暂停/恢复；`设置定时任务` 面板包含说明、重复（每小时/每天/工作日/每周/每月/自定义）、时间、结束重复（永不/日期/次数）、高级（时区、每次开启新聊天）
- **新建**：页面/网站/图像/文件夹/空间创建真实条目；上传文件按元数据建条目
- **演示数据**：9 条中性示例（3 页面、3 文件、3 站点）+ 2 条示例任务，`seedDemo: false` 可关闭

## Figma 帧覆盖

| Frame | 状态 |
| --- | --- |
| 01 空间/全部 | 完成 |
| 02 全部/新建菜单 | 完成（演示文稿/电子表格按设计保留「即将推出」） |
| 03 全部/类型筛选 | 完成（真实过滤） |
| 04 全部/与你共享 | 完成（tab 过滤） |
| 05 页面/列表 | 完成 |
| 06 页面/网格 | 完成 |
| 07 页面/内容编辑器 | 完成（块编辑器：13 种块、块菜单、斜杠转换、保存 `blocks`） |
| 08 页面/插入菜单 | 完成（生成/创建/媒体/基础） |
| 09 页面/文件菜单 | 完成（重命名/置顶/删除/分享/下载/信息/动态） |
| 10 页面/分享 | 完成 |
| 11 分享/访问范围 | 完成（权限、成员、复制链接） |
| 12 页面/评论空态 | 完成 |
| 13 页面/自动化预填 | 完成（预填输入框） |
| 14 页面/空态 | 完成（正文占位） |
| 15 页面/收起侧栏 | 完成 |
| 16 空间/动态空态 | 完成（通知空态） |
| 17 定时任务/总览 | 完成 |
| 18 定时任务/新建 | 完成（设置面板） |
| 19 定时任务/频率 | 完成（6 种重复） |
| 20 定时任务/高级 | 完成（时区/新聊天） |
| 21 定时任务/结束重复 | 完成（永不/日期/次数） |
| 22 站点/使用条款 | 完成（站点详情卡片） |
| 补充 sites/sitemenu/trash/search/favorites/slash/blocks | sites、sitemenu、trash、search（分类 tab）、favorites 完成；slash 菜单完成；blocks 完成块类型/块菜单，未做块拖拽排序 |

## 数据

- 文件：`~/.dsh/data/space-workspace/space.json`（`config.dataDir` 可覆盖）
- 条目：`{ id, kind, title, body, blocks, parentId, starred, shared, pinned, deletedAt, meta, comments, messages, members, createdAt, updatedAt }`
- 任务：`{ id, title, goal, repeat, time, timezone, endMode, endDate, endCount, newChat, status, createdAt, updatedAt }`
- 写入原子（临时文件 + rename），`sequence` 递增；单页正文 ≤ 20 000 字符

HTTP：`GET /space-api/state`（`?trash=1` 取回收站）、`GET/POST/PATCH/DELETE/... /space-api/items`、
`POST /space-api/items/:id/trash|restore|members|comments|messages`、
`GET/POST /space-api/tasks`、`PATCH /space-api/tasks/:id`。
认证复用 Harness 浏览器会话（`ctx.connection.requestRejection`），无自定义 token。

## 安装与验证

```powershell
# 已安装；更新时：plugin_manager install_bundle target=<绝对目录>
$node = "C:\Users\Administrator\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe"

& $node --check index.js
& $node --check client.js
& $node --test test/space.test.mjs
& $node dev/client-smoke.mjs
```

本机已验证：Host 测试 7/7；jsdom 冒烟 37 次请求，走通 列表 → 块编辑/保存 → 插入块 → 收藏 → 分享 →
评论 → 聊天 → 文件菜单 → 类型筛选 → 站点/站点菜单/分析 → 新建页面/站点 →
删除到回收站/恢复 → 定时任务设置；
实时 slot `space`（order 20）与 `main:space` active；无会话 HTTP 401；
client bundle rev 与磁盘一致。

页面若在安装前已打开，刷新一次即可。

## 设计来源

Figma file `p6JeHHsPGjMf78JZ0AwfNz`，`01 · 实测 Space 复原`（node `3:3`）。
设计注释里的「返回上一状态 / 原型导航辅助」和底部「实测/复原说明」不是 UI，未实现。

## 边界

- 上传文件只保存文件名/大小/类型等元数据，不保存字节；文件内容预览未实现
- 「生成」「可视化」和底部聊天不调用模型，只做输入/消息持久化
- 页面正文按纯文本/markdown 编辑，不是真正的块编辑器
- 站点/图像/文件夹/空间是标题 + 元数据 + 评论/条款，不含专属内容编辑器
- 演示数据仅用于原型展示，不是真实企业数据
- 视觉未做浏览器截图验证；结构和文案来自 Figma 节点与 2x 渲染图
