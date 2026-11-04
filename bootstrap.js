var CopyOriginalPDF = {
  menuIDs: [],
  active: false,

  getPDFs(items) {
    if (items?.length !== 1) return [];
    const item = items[0];
    if (!item || item.deleted) return [];
    const candidates = item.isRegularItem()
      ? Zotero.Items.get(item.getAttachments())
      : [item];
    return candidates.filter(attachment =>
      !attachment.deleted && attachment.isPDFAttachment()
    );
  },

  async copy(items, win) {
    if (!this.active) return;
    const pdfs = this.getPDFs(items);
    if (!pdfs.length) return;

    let attachment = pdfs[0];
    if (pdfs.length > 1) {
      const selected = { value: 0 };
      const labels = pdfs.map(pdf => {
        const filename = pdf.attachmentFilename;
        const title = pdf.getField("title");
        return title && title !== filename ? `${filename} — ${title}` : filename;
      });
      if (!Services.prompt.select(
        win, "选择 PDF", "请选择要复制的原始 PDF 文件：", labels, selected
      )) return;
      attachment = pdfs[selected.value];
      if (!attachment) return;
    }

    const path = await attachment.getFilePathAsync();
    if (!this.active) return;
    if (!path) {
      throw new Error("此 PDF 不在本机，或原文件已被移动。请先在 Zotero 中下载或重新定位附件，再复制。");
    }
    const file = Zotero.File.pathToFile(path);
    if (!file.exists() || !file.isFile() || !file.isReadable()) {
      throw new Error("无法读取此 PDF 文件。请检查文件位置和访问权限。");
    }

    // A native file flavor allows Finder/Explorer to paste the original bytes.
    const transferable = Components.classes["@mozilla.org/widget/transferable;1"]
      .createInstance(Components.interfaces.nsITransferable);
    transferable.init(null);
    transferable.addDataFlavor("application/x-moz-file");
    transferable.setTransferData("application/x-moz-file", file);
    Services.clipboard.setData(
      transferable, null, Components.interfaces.nsIClipboard.kGlobalClipboard
    );
  },

  start(pluginID) {
    this.active = true;
    try {
      for (const target of ["main/library/item", "main/tab"]) {
        const menuID = Zotero.MenuManager.registerMenu({
          menuID: target === "main/tab" ? "copy-original-pdf-tab" : "copy-original-pdf-item",
          pluginID,
          target,
          menus: [{
            menuType: "menuitem",
            onShowing: (_event, context) => {
              const pdfs = this.getPDFs(context.items);
              context.menuElem.setAttribute("label",
                pdfs.length > 1 ? "复制原始 PDF 文件…" : "复制原始 PDF 文件"
              );
              context.setVisible(pdfs.length > 0);
            },
            onCommand: async (_event, context) => {
              const win = context.menuElem.ownerGlobal;
              try {
                await this.copy(context.items, win);
              }
              catch (error) {
                Zotero.logError(error);
                Services.prompt.alert(win, "无法复制 PDF", error.message);
              }
            }
          }]
        });
        if (!menuID) throw new Error(`无法注册 PDF 复制菜单：${target}`);
        this.menuIDs.push(menuID);
      }
    }
    catch (error) {
      this.stop();
      throw error;
    }
  },

  stop() {
    this.active = false;
    for (const menuID of this.menuIDs) Zotero.MenuManager.unregisterMenu(menuID);
    this.menuIDs = [];
  }
};

function startup({ id }) {
  CopyOriginalPDF.start(id);
}

function shutdown() {
  CopyOriginalPDF.stop();
}

function install() {}
function uninstall() {}
