# 询盘取消用例：等待注入完成

测试修复提交 `8c117ee5d17da16e52aa8eb0d3e75a136fbf962d`，基线 `95b0a2f8ecbd23231c4a7cee9872e18fe23394f2`。只修改 `test/workspace-omp-inquiry-continuation.test.mjs`，生产代码、原授权/取消、预算和锁文件完全不变。

后续父任务已协调腾讯云现场应用该单测试补丁，完整询盘27/27、exit0、72.91秒。有效版本为95b源码选集＋8c补丁；首次26/27失败保留，不能声称5602ee全量部署。[现场脱敏验收记录](OMP-TENCENT-ACCEPTANCE-20261017.md)明确执行归属和证据SHA；本文作者未亲自操作服务器。

## 根因与确定性证据

父任务转述腾讯云固定95b现场：源码1256文件逐SHA匹配、测试后0改动；入口/typecheck/14插件构建通过，Session21/21、context43/43；询盘首次26/27，仅多草稿cancel用例在 `injected===true` 后发现 `mutationCompleted===false`。随后独立单项1/1不是修复证明，原失败保留。首轮现场没有记录原HTTP响应与Run终态的完整顺序，本文不补造该轮历史轨迹，也没有访问服务器。

实际原Runtime先提交Run取消状态并触发原AbortSignal，再完成cancel HTTP响应；测试的 `send()` 只轮询Run终态。因而它可能先返回，而注入函数仍在 `await` HTTP请求。`Run已cancelled` 不等于该测试回调已经完成。

在原签名Host/Store/Artifact与同Session两轮夹具中，只用测试门闩暂缓原cancel HTTP响应的end，原取消仍真实执行。旧完成断言稳定失败1/1：

```text
cancel-http-start
cancel-http-response-held
run-terminal-observed       # cancelled，injected=true，mutationCompleted=false
```

没有延长sleep、HTTP期限或原60秒用例期限。门闩由测试逻辑释放，finally也会释放并恢复监听；原请求自身的有限HTTP截止保持。由此确定该用例存在未join注入回调的同步缺陷，无需修改产品取消语义。

## 修复与结果

用例为注入操作建立明确完成Promise，成功完成或原异常均显式传递。观察到原Run终态后释放测试响应门闩，等待这次真实注入操作，再执行原 `mutationCompleted===true` 等全部断言。错误不会因原交付拒绝而被吞掉。修复后同一受控顺序为：

```text
cancel-http-start → cancel-http-response-held → run-terminal-observed
→ cancel-http-response-released → cancel-http-response-received → injection-completed
```

原草稿A旧版本不可变、A/B已提交结果保留、原Session/JSONL前缀、B版本/字节/创建Run、未审核/未发送、精确拒绝码及模型调用4/2等断言全部保留；增加注入完成后重新读取Store，验证仍仅两条Run，第二轮仍仅两次逻辑模型请求，无新增业务任务。

本地固定Node24.19.0、Bun1.3.14、OMP18.10.4：门闩+旧断言1/1预期失败；修复后受控单项1/1通过；最终同一测试源码完整询盘相关 **27/27通过，0失败/取消/跳过**。这是有反例和同步修复的分阶段验证，没有重复随机运行直到通过。最终命令：

```sh
env -i PATH="$PATH" HOME=/tmp NO_COLOR=1 node --test --test-concurrency=1 \
  test/workspace-omp-inquiry-continuation.test.mjs \
  test/factory-inquiries.test.mjs test/workspace-omp-factory-inquiries.test.mjs
```

本地修复轮只改测试，未重复typecheck/build或共享45项；腾讯云95b的构建结果保留为该固定版本证据。当时补丁尚待现场复验，后续父协调的27/27结果另见上述现场记录，仍不代表全仓/生产验收。[精确记录与哈希](validation/omp-inquiry-cancel-order-20261017-summary.json)保留该本地检查点的失败/成功日志SHA256及事件顺序；原始日志、Session和草稿不提交。

## 最小补丁交接

私有Library提供 `workspace-agent-95b0a2f-to-8c117ee-inquiry-cancel-test.patch`，只含上述一个测试文件，5,960字节：

- 补丁SHA256：`99386b03b1de4a07b855937c13e095b5fe00757061cd47e9b4924cbae6199282`
- 基线文件SHA256：`be60d4e3dbeb4dd937aa4ca4b0c98f2b8e637f1215ae33059107962feaac21e7`
- 应用后文件SHA256：`d5111dbe4962e30f1cc18c330b023ee097c8fa98d8954ccf3e8d6a6ab4c5d8ae`

已在Git仓库外的临时基线文件上验证 `git apply --check`、应用后逐字节匹配目标提交及反向检查，适用于父任务上传的无.git源码目录。后续父已在原终端核hash、check/apply并核对目标文件SHA，1256项中仅此测试改变；本文作者没有执行服务器操作。

没有新增功能或推进阶段，没有真实模型/付费/外部业务调用，没有读取密钥、配置或服务器资料，没有main修改、合并、强推、部署或扩权。当前真实模型配置/账单与真实完整两轮口径不变。
