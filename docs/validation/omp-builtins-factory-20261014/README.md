# OMP 内置工具实际检查

固定发行包 `@oh-my-pi/pi-coding-agent@18.10.4`，经校验的 Bun 1.3.14。运行真实发行源码工具类和浏览器 eval prelude；不是自写搜索或浏览器引擎。实际命令：

```sh
OMP_BUILTINS_SDK_ROOT=/path/to/audited/node_modules/@oh-my-pi/pi-coding-agent \
OMP_BUILTINS_LIVE_SEARCH=1 \
OMP_BUILTINS_SAVE_EVIDENCE=docs/validation/omp-builtins-factory-20261014/results.json \
node --test test/omp-builtins.factory.test.mjs
```

本次 1/1 通过、无跳过。默认离线合成检查不访问外网；显式 `OMP_BUILTINS_LIVE_SEARCH=1` 才尝试非私密类别的真实查询。

- 内置 `WebSearchTool` 的 DuckDuckGo 路径：合成 HTTP 响应经过原解析和格式化，保留来源 URL；合成 403 显式报错、来源为空，未切换入口或绕过拒绝。
- 内置 `ReadTool`：读取本测试生成的公开 Markdown，保留未知产能文字；没有声称 PDF 转换或 OCR 通过。
- 内置 browser eval prelude：使用已有 `/usr/bin/chromium`，访问自有合成 HTTP 产品页，读取正文并关闭所有受测标签。不下载浏览器、不附着用户浏览器、不用宿主账号。
- 真实 DuckDuckGo 查询：连接错误，返回零来源；没有真实候选或独立客户证据。

所有 HOME、OMP 配置、空鉴权数据库、浏览器会话和合成文件均在独立临时目录；没有读取真实密钥、企业文件或调用付费模型。源码测试会校验 Bun 二进制 SHA256 和 OMP 固定版本。提交的 results.json 仅包含紧凑事实，无运行日志或凭据。

这一检查没有模型 session、子代理、真实客户开发或 Workspace 原账本衔接证明；这些必须由各自的端到端验收确认。社区插件默认文档转换缺依赖的既有阻挡也未因此解除。
