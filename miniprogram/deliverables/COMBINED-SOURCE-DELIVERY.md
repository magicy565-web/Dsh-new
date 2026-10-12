# 已验证组合源码交付

本包由固定Git提交738000f的原始blob字节生成，包含同一工作树的后端08a760c（实现faaf124）与微信客户端b7f97f3。不要与PR44的旧b210576/dd91cfc包混合。版本树与文件SHA见COMBINED-VERSION.json、PI-SOURCE-MANIFEST.json、COMBINED-SHA256SUMS.txt；每个原源码文件可核对Git blob ID。代码没有为归档改写。

CLIENT-IMPORT目录内只附本次客户端v2包，其32个编译文件与该组合工作树逐一匹配。微信开发者工具导入时解压这一v2包；源码开发在Workspace-Agent根目录按已有README、docs/SUPPLIER-SERVICE-CONTRACT.md、miniprogram/SUPPLIER-FINAL-ACCEPTANCE.md执行。包内不带node_modules、已登录会话、运行数据库/上传文件、秘密或旧交付ZIP；.env.example只是公开配置模板。已有测试日志/页面证据在GitHub开发分支保留，不将运行数据打包。归档没有再次运行业务测试或独立安全审核；引用此前同一组合48/48业务联调与十一组源码浏览器检查。

已实现的是原主会话的商品事实与必要缺项、明确字段审阅、内部Listing预览、真实文件SHA、原产品库回执、已有Shopify商品观察、原七天配置/采样/总结/停止及请求恢复。模型与店铺响应测试均明确为fixture，不是线上账户、业绩或微信真机结果。b210576二次保存的409旧失败保留；faaf124重跑确认为同一原产品ID/修订2，丢回执不重复建产品。

当前20:30交付未完成Shopify商品创建/渠道发布、外部通知、商品级流量代码/真实归因接入；traffic仍unsupported/null，不能用店铺总流量顶替。销量读取代码不能当作真实店铺授权或七天数据验证。预览不是Shopify写入回执，ACTIVE不等于发布；七天配置不启用原Schedule，需独立明确审批；站内总结不是外部送达。真实微信登录/工具/双平台真机/审核、线上Muse/Dot原Connector、独立安全验收仍未完成。生产华为未访问，未付费、部署、创建真实凭据或扩权。

权限、预算、审批、任务记录与验收归Cnsubscribe Agent Service；执行内核复用Pi SDK，Durable恢复是待验证组件。本归档保存实际选定源码，不新增Loop/DAG/模型层或另一套UI，也不会启用外部写入/通知/调度。最少账号与域名操作见miniprogram/SUPPLIER-IMPORT.md。没有用户可访问的云端预览URL。

归档SHA256：e1fa4cba9f8d6cc64fb07e54a931da98889acac6f4be78455d31002ddd4798ef

客户端v2 SHA256：b5b873805d4237f400668999cb61f0b0d07caab3296701968e34c23c0e26ab41

Library本次批量保存报网络连接错误，未完成、无返回的源码/客户端Library ID；不能伪造附件。GitHub开发分支保留此归档、客户端包、manifest、SHA和校验记录供授权用户下载。既有截图Library版本1不变。
