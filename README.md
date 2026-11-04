# Quick Copy PDF

在 Zotero 的文献条目或顶部 PDF 标签页上右键，直接复制原始 PDF 文件到系统剪贴板。

Copy original PDF files from Zotero library items and PDF reader tabs to the system clipboard. When an item has multiple PDFs, choose the attachment to copy.

## 为什么开发这个插件

经常需要把一篇论文的 PDF 发给 AI，让它帮忙阅读、解释或讨论内容。原来的流程比较麻烦：先在 Zotero 中找到论文，再定位 PDF 文件，然后复制或拖到 AI 应用里。因此做了这个小插件，把「复制原始 PDF 文件」直接放进文献条目和 PDF 标签页的右键菜单，方便把论文复制给 AI。

复制后，可以在支持文件粘贴的 AI 应用中直接粘贴；具体是否接受文件粘贴取决于目标应用。

## 安装

适用版本：**Zotero 8–10（8.0–10.0.x）**，支持 macOS 和 Windows。Zotero 7 及更早版本不在支持范围内。

1. 从 [Releases](https://github.com/Huaisure/zotero-quick-copy-pdf/releases/latest) 下载 `quick-copy-pdf-1.1.0.xpi`。不要下载 GitHub 自动生成的 Source code 压缩包作为插件。
2. 在 Zotero 中打开 **工具 → 插件**。
3. 点击右上角齿轮，选择 **从文件安装插件…**，打开下载的 `.xpi`。

## 使用

- **文献库**：右键一个文献条目，点击「复制原始 PDF 文件」。只有一个 PDF 时直接复制；多个 PDF 时弹出文件选择框。
- **PDF 附件**：也可以直接右键文献下的 PDF 附件，复制该文件。
- **顶部标签页**：打开 PDF 后，右键它的顶部标签页，点击「复制原始 PDF 文件」。即使该标签页当前未激活，也会复制它对应的 PDF。
- **粘贴**：macOS 在 Finder 文件夹或支持文件粘贴的应用中按 `⌘V`；Windows 在资源管理器文件夹或支持文件粘贴的应用中按 `Ctrl+V`。

没有 PDF 的条目不会显示此菜单。一次处理一个条目；选择多个文献时不显示菜单。选择框取消后不会改变剪贴板。

## 原始文件的含义

插件把本地附件文件交给系统剪贴板，保留原文件名和字节内容，不导出、不重写 PDF。仅保存在 Zotero 数据库中的批注不会被嵌入；原 PDF 文件本来就包含的内容会保留。

支持 Zotero 存储的附件和链接到本地文件的附件。未下载或已丢失的 PDF 会提示先下载或重新定位；插件不自动下载附件。仅有网页链接的条目不作为本地 PDF 处理。

插件不修改文献元数据，也不上传文献或 PDF。Zotero 可通过本仓库的 `updates.json` 检查插件版本更新。

## 开发与构建

运行插件不需要 Node.js、Python 或额外依赖。开发测试需要 Node.js 18+，打包使用 Python 3 标准库。

```sh
node --test test.cjs
python3 build.py
```

安装包生成到 `dist/quick-copy-pdf-1.1.0.xpi`，同时更新根目录的 `updates.json`（包含安装包 SHA-256）。安装包仅包含 `manifest.json` 和 `bootstrap.js`。

实现使用 Zotero 的 `MenuManager` 官方接口：`main/library/item` 和 `main/tab`。系统剪贴板使用 Mozilla 的 `application/x-moz-file` 文件类型，Windows 由 Mozilla 转换为系统原生 `CF_HDROP` 文件列表，保留中文路径。插件运行无需 PowerShell 或额外程序。

发布新版本时，修改 `manifest.json` 中的版本号，运行测试和构建，提交生成的 `updates.json`，然后将同一次构建得到的 XPI 上传到对应的 `v版本号` GitHub Release。更新清单的下载链接和文件哈希必须与发布附件一致。

## 验证范围

- 14 项自动化测试：菜单注册和清理、单文件复制、多文件选择、取消、空选择、非 PDF、缺失或不可读文件、后台标签页目标、停用期间的异步操作、Windows 盘符和 UNC 路径原样传递及安装清单。
- Zotero 10.0.7 独立测试资料库中完成 11 项运行时检查：实际加载、两个右键菜单、原生文件剪贴板、多文件选择框和取消、未激活 PDF 标签页的目标、停用和重新启用。
- 测试使用生成的 PDF，没有使用个人文献库。

Windows 原生运行检查通过仓库中的 GitHub Actions 执行。尚未实测 Linux，或各聊天/邮件应用的文件粘贴兼容性。插件复制的是文件，粘贴目标需要支持文件剪贴板。

## 参考

- [Zotero 插件开发](https://www.zotero.org/support/dev/client_coding/plugin_development)
- [MenuManager 官方说明](https://www.zotero.org/support/dev/zotero_8_for_developers#custom_menu_items)
- [Zotero 10 开发说明](https://www.zotero.org/support/dev/zotero_10_for_developers)
