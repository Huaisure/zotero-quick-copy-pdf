var CopyOriginalPDF = {
  menuIDs: [],
  active: false,

  getPDFs(items) {
    return (items || []).flatMap(item => {
      if (!item || item.deleted) return [];
      const candidates = item.isRegularItem()
        ? Zotero.Items.get(item.getAttachments())
        : [item];
      return candidates.filter(attachment =>
        !attachment.deleted && attachment.isPDFAttachment()
      );
    });
  },

  async copy(items, win) {
    if (!this.active) return;
    const files = [];
    for (const item of items || []) {
      const pdfs = this.getPDFs([item]);
      if (!pdfs.length) continue;

      let attachment = pdfs[0];
      if (pdfs.length > 1) {
        const selected = { value: 0 };
        const labels = pdfs.map(pdf => {
          const filename = pdf.attachmentFilename;
          const title = pdf.getField("title");
          return title && title !== filename ? `${filename} — ${title}` : filename;
        });
        if (!Services.prompt.select(
          win, "选择 PDF", `${item.getField("title")}\n请选择要复制的原始 PDF 文件：`, labels, selected
        )) return;
        attachment = pdfs[selected.value];
        if (!attachment) return;
      }

      const path = await attachment.getFilePathAsync();
      if (!this.active) return;
      if (!path) {
        throw new Error(`${attachment.attachmentFilename}：此 PDF 不在本机，或原文件已被移动。请先在 Zotero 中下载或重新定位附件，再复制。`);
      }
      const file = Zotero.File.pathToFile(path);
      if (!file.exists() || !file.isFile() || !file.isReadable()) {
        throw new Error(`${attachment.attachmentFilename}：无法读取此 PDF 文件。请检查文件位置和访问权限。`);
      }
      if (!files.some(existing => existing.equals(file))) files.push(file);
    }
    if (!files.length) return;
    if (files.length > 1) {
      this.copyFiles(files);
      return;
    }

    // A native file flavor allows Finder/Explorer to paste the original bytes.
    const transferable = Components.classes["@mozilla.org/widget/transferable;1"]
      .createInstance(Components.interfaces.nsITransferable);
    transferable.init(null);
    transferable.addDataFlavor("application/x-moz-file");
    transferable.setTransferData("application/x-moz-file", files[0]);
    Services.clipboard.setData(
      transferable, null, Components.interfaces.nsIClipboard.kGlobalClipboard
    );
  },

  copyFiles(files) {
    // nsIClipboard only writes one nsIFile; batches need native file lists.
    const { ctypes } = ChromeUtils.importESModule("resource://gre/modules/ctypes.sys.mjs");
    if (Zotero.isMac) this.copyFilesMac(files, ctypes);
    else if (Zotero.isWin) this.copyFilesWindows(files, ctypes);
    else throw new Error("批量复制目前仅支持 macOS 和 Windows。");
  },

  copyFilesMac(files, ctypes) {
    const lib = ctypes.open("/usr/lib/libobjc.A.dylib");
    try {
      const ptr = ctypes.voidptr_t;
      const cls = lib.declare("objc_getClass", ctypes.default_abi, ptr, ctypes.char.ptr);
      const sel = lib.declare("sel_registerName", ctypes.default_abi, ptr, ctypes.char.ptr);
      const send = lib.declare("objc_msgSend", ctypes.default_abi, ptr, ptr, ptr);
      const sendObject = lib.declare("objc_msgSend", ctypes.default_abi, ptr, ptr, ptr, ptr);
      const sendString = lib.declare("objc_msgSend", ctypes.default_abi, ptr, ptr, ptr, ctypes.char.ptr);
      const sendVoid = lib.declare("objc_msgSend", ctypes.default_abi, ctypes.void_t, ptr, ptr);
      const add = lib.declare("objc_msgSend", ctypes.default_abi, ctypes.void_t, ptr, ptr, ptr);
      const clear = lib.declare("objc_msgSend", ctypes.default_abi, ctypes.long, ptr, ptr);
      const write = lib.declare("objc_msgSend", ctypes.default_abi, ctypes.bool, ptr, ptr, ptr);
      const pool = send(send(cls("NSAutoreleasePool"), sel("alloc")), sel("init"));
      try {
        const urls = send(cls("NSMutableArray"), sel("array"));
        for (const file of files) {
          const path = sendString(cls("NSString"), sel("stringWithUTF8String:"), file.path);
          const url = sendObject(cls("NSURL"), sel("fileURLWithPath:"), path);
          if (url.isNull()) throw new Error("无法创建 PDF 文件地址。");
          add(urls, sel("addObject:"), url);
        }
        const board = send(cls("NSPasteboard"), sel("generalPasteboard"));
        clear(board, sel("clearContents"));
        if (!write(board, sel("writeObjects:"), urls)) {
          throw new Error("无法写入系统剪贴板，请重试。");
        }
      }
      finally { sendVoid(pool, sel("drain")); }
    }
    finally { lib.close(); }
  },

  copyFilesWindows(files, ctypes) {
    const user = ctypes.open("user32.dll");
    let kernel;
    try {
      kernel = ctypes.open("kernel32.dll");
      const abi = ctypes.winapi_abi;
      const ptr = ctypes.voidptr_t;
      const alloc = kernel.declare("GlobalAlloc", abi, ptr, ctypes.uint32_t, ctypes.size_t);
      const lock = kernel.declare("GlobalLock", abi, ptr, ptr);
      const unlock = kernel.declare("GlobalUnlock", abi, ctypes.int, ptr);
      const free = kernel.declare("GlobalFree", abi, ptr, ptr);
      const create = user.declare("CreateWindowExW", abi, ptr, ctypes.uint32_t,
        ctypes.char16_t.ptr, ctypes.char16_t.ptr, ctypes.uint32_t,
        ctypes.int, ctypes.int, ctypes.int, ctypes.int, ptr, ptr, ptr, ptr);
      const destroy = user.declare("DestroyWindow", abi, ctypes.int, ptr);
      const open = user.declare("OpenClipboard", abi, ctypes.int, ptr);
      const empty = user.declare("EmptyClipboard", abi, ctypes.int);
      const set = user.declare("SetClipboardData", abi, ptr, ctypes.uint32_t, ptr);
      const close = user.declare("CloseClipboard", abi, ctypes.int);
      const paths = files.map(file => file.path).join("\0") + "\0\0";
      // DROPFILES is five 32-bit fields followed by UTF-16 paths and a final NUL.
      const memory = alloc(0x42, 20 + paths.length * 2); // MOVEABLE | ZEROINIT
      if (memory.isNull()) throw new Error("无法分配文件剪贴板内存。");
      let owned = true;
      let window = ptr();
      let opened = false;
      try {
        const data = lock(memory);
        if (data.isNull()) throw new Error("无法写入文件剪贴板内存。");
        try {
          const header = ctypes.cast(data, ctypes.uint32_t.array(5).ptr).contents;
          header[0] = 20;
          header[4] = 1; // fWide: Unicode filenames
          const words = ctypes.cast(data, ctypes.uint16_t.array(10 + paths.length).ptr).contents;
          for (let i = 0; i < paths.length; i++) words[10 + i] = paths.charCodeAt(i);
        }
        finally { unlock(memory); }
        // A private hidden window owns the clipboard, even when Zotero is inactive.
        window = create(0, "STATIC", "Quick Copy PDF", 0, 0, 0, 0, 0, null, null, null, null);
        if (window.isNull() || !open(window)) {
          throw new Error("无法打开系统剪贴板，可能正被其他程序占用，请重试。");
        }
        opened = true;
        if (!empty() || set(15, memory).isNull()) { // CF_HDROP
          throw new Error("无法写入系统剪贴板，请重试。");
        }
        owned = false; // Windows owns the allocation after SetClipboardData succeeds.
      }
      finally {
        if (opened) close();
        if (!window.isNull()) destroy(window);
        if (owned) free(memory);
      }
    }
    finally {
      if (kernel) kernel.close();
      user.close();
    }
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
                context.items?.length > 1 ? "批量复制原始 PDF 文件"
                  : pdfs.length > 1 ? "复制原始 PDF 文件…" : "复制原始 PDF 文件"
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
