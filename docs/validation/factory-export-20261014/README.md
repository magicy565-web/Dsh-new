# 工厂客户开发文书：原账本验收

`presets/agent/factory-export.json` 是原 generic preset 的公开资料文书配置，不另建业务引擎、任务账本或候选数据库。四阶段整理本厂产品、用户提供客户材料、RFQ匹配准备和待审核开发信。原模板不会声称客户已核验、信件已发出或商业目标达成。

```sh
FACTORY_EXPORT_EVIDENCE=docs/validation/factory-export-20261014/results.json \
node --test test/factory-export.business.test.mjs
```

真实原HTTP接口与原Pi Durable明确模型替身验证：并发稳定键只建立一个taskId，四个原阶段Run，三个文书的读取字节／计算SHA与原账本一致；重启加载原taskId和文书，不新增模型调用；一个文书读取失败仍保留另两个可用结果。另验证外成员、外工作区、只读权限拒绝，以及公开输入边界。

此处是合成文书链路验收，付费模型零调用，没有真实客户发现、报价、邮件发送、Worker委派或商店写入。受控OMP默认入口还需单独证明模型工具提交和原任务链接；本测试不代替该证明。

选定工厂Skill包含简短社区写作方法改编，审阅来源版本和实际文件SHA见包内 `skills/factory/sources.json`。该来源的不可变Git commit未核对；不把它当已固定可执行组件，不加载整套营销工具或邮件账户步骤。
