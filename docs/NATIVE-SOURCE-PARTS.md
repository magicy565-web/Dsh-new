# 原生源码分卷说明

为适应单附件小于 8 MB 的限制，本次交付分为：

- 当前 Workspace-Agent 主应用 ZIP：完整应用后端/UI 源码、构建产物、官方 SDK、文档和测试。默认文本模式可直接运行，不需要其他分卷
- Workspace-Native-Source-Part-01-of-05.zip 至 Part-05-of-05.zip：可选的完整原生 Harness 源码，包含已核验的未提交修复，不含依赖、构建输出或凭据

## 默认模式先启动

只解压 App.zip，在 Workspace-Agent 文件夹运行：

```sh
node --env-file-if-exists=.env server/index.mjs
```

打开 http://127.0.0.1:8787。没有模型凭据时会保存请求并明确阻塞，不会调用模型。

## 需要完整原生运行时才重组

1. 下载全部五个 Part ZIP，解压到同一个目录，得到一个 source-parts 文件夹及五个 part 文件
2. 在应用文件夹运行下面命令；第一项是解压后 source-parts 的完整路径。也可以将该文件夹直接放到应用 backend 内，然后不传参数

```sh
node scripts/reconstruct-native-source.mjs /完整路径/source-parts
```

3. 脚本先验证每份字节数和 SHA-256，再写出 backend/deepseek-harness-source.tar.gz 并核对整体 SHA-256。缺失、损坏或不匹配会拒绝重组，不覆盖已有不同内容
4. 解压生成的 tar.gz，按其中 README 安装依赖、构建。完整原生模式/可选 bridge 的人工审核和配置见 ../NATIVE-HARNESS.md

仅重组源码不会安装依赖、启动原生模型、联网、授权外部工具或部署服务。

整体归档 SHA-256：f7ca9c1a8d4e5587be655868f7f21258bf9bee14ecee1eccf9b7853ed18ee421

对应完整工作树：bccf02f2636f7213be321d487aa763eb51396584

逐卷哈希和大小见 backend/SOURCE-PARTS.json。重组脚本只需要应用已要求的 Node.js 24，不需要额外 Python。


本 GitHub 仓库不包含这些分卷、完整原生源码归档或其完整文件索引。只有已单独获得并授权使用这些分卷时才可执行重组；文本模式从 GitHub 构建启动不需要它们。
