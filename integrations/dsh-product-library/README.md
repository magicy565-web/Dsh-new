# dsh-product-library

DSH 侧只读适配器：把 `workspace-agent` 仓库里的 `workspace-product-library`
Harness 插件接到当前 DeepSeek Harness，让对话中的 Agent 可以读取产品资料库。

它不保存商品事实、不缓存 Product Context、不写 Medusa，也不替代
`workspace-product-library` 的审批与审核边界。

## 工具

| 工具 | 后端 |
| --- | --- |
| `product_library_status` | `GET /api/product-library/status` |
| `product_library_list` | `GET /api/product-library/products` |
| `product_library_search` | `GET /api/product-library/search?q=` |
| `product_library_read` | `GET /api/product-library/products/:productId` |

`product_library_read` 返回 room 的 pin、页面、引用状态、评论、附件**元数据**
（文件名/类型/大小/SHA-256/下载路径）。它不返回附件字节，也不上传、不批准、
不写 Medusa；附件上传走 Harness HTTP（见插件 README）。

## 启动后端

在 `workspace-agent` 仓库：

```powershell
$node = "C:\Users\Administrator\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe"
& $node packages/harness-kernel/bin/wh.mjs doctor --composition harness.local.yml
```

Harness 组合默认监听 `http://127.0.0.1:8790`。DSH 工具默认也指向这个地址；
需要其他地址时，在启动 DSH 的进程环境里设置：

```text
PRODUCT_LIBRARY_BASE_URL=https://your-harness.example
```

必须是精确的 HTTP(S) origin（不带路径）。

## 未配置 Medusa 时

`product_library_status` 返回 `configured:false`，`product_library_list` 只返回
已存在的 room 并带 `PRODUCT_LIBRARY_SOURCE_UNCONFIGURED` 警告；`product_library_read`
对未建 room 返回 404。工具不会编造商品或上下文。

配置 Medusa 读取需要 `workspace-product-library` 的 `source.readTokenFile`
（绝对路径、私有的 Product Context Agent 读 token），见
[插件说明](../../plugins/workspace-product-library/README.md)。

## 安装与验证

```powershell
$node = "C:\Users\Administrator\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe"
& $node --test integrations/dsh-product-library/test/index.test.mjs
```

安装由 `plugin_manager install_bundle` 完成（见仓库根说明），安装后工具出现在
当前 profile 的所有会话中。
