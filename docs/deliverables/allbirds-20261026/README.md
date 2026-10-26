# Allbirds 中文选品杂志

真实输入：https://www.allbirds.com/ 。由独立插件 `dsh-buyer-magazine@0.2.0` 在原生 DeepSeek Harness 中读取网站、编排内容、校验、生成 HTML 并通过文件卡片交付。2026-10-26 实测产物；经用户明确授权上传本目录。

- [下载完整 ZIP](Allbirds-magazine.zip?raw=true)：HTML、9 页 PDF、桌面和手机预览图。
- [查看 / 下载 PDF](Allbirds-magazine.pdf)
- [下载 HTML](Allbirds-magazine.html?raw=true)：保存后用浏览器打开，可筛选、收藏和比较商品、查看来源。

包含 5 款真实商品与 7 条来源记录。五款商品的公开零售价均与官网商品 JSON 接口逐项核对。HTML 与插件编译器产出逐字节一致；PDF 由实际 HTML 经 Chromium 打印导出。

实际检查：1440 和 390 像素宽度无横向溢出、无浏览器脚本错误；筛选、收藏后比较、来源弹窗和 Escape 关闭正常。Native Session 记录 1 次生成、1 次文件交付和正常结束，未调用 Shell。

这是无商品图片的工作稿，图片通过官网商品链接查看；中文编辑正文与部分英文内置控件并存。零售价不代表批发报价，MOQ、批发条件、交期和独立认证核验仍待确认。网站事实与价格是读取时的记录，可能变化。本次上传文件不代表完成对外营销发布或采购审批。

## 桌面预览

![桌面预览](Allbirds-desktop.png)

## 手机预览

![手机预览](Allbirds-mobile.png)
