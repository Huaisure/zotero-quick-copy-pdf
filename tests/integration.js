async function run() {
  const passed = [];
  const assert = (value, message) => {
    if (!value) throw new Error(message);
    passed.push(message);
  };
  const win = Zotero.getMainWindow();
  const root = PathUtils.parent(Zotero.DataDirectory.dir);
  const id = "quick-copy-pdf@huaisure";
  const getOptions = target => Zotero.MenuManager._menuManager
    .getCustomMenuOptions(target).filter(option => option.pluginID === id);
  assert(getOptions("main/library/item").length === 1, "Library menu registered once");
  assert(getOptions("main/tab").length === 1, "Tab menu registered once");

  const parent = new Zotero.Item("journalArticle");
  parent.setField("title", "Quick Copy PDF — isolated test");
  await parent.saveTx();
  const first = await Zotero.Attachments.linkFromFile({
    file: PathUtils.join(root, "正文.pdf"), parentItemID: parent.id
  });
  const second = await Zotero.Attachments.linkFromFile({
    file: PathUtils.join(root, "补充材料.pdf"), parentItemID: parent.id
  });

  const clipboardPath = () => {
    const t = Components.classes["@mozilla.org/widget/transferable;1"]
      .createInstance(Components.interfaces.nsITransferable);
    t.init(null);
    t.addDataFlavor("application/x-moz-file");
    Services.clipboard.getData(t, Components.interfaces.nsIClipboard.kGlobalClipboard);
    const data = {};
    t.getTransferData("application/x-moz-file", data);
    return data.value.QueryInterface(Components.interfaces.nsIFile).path;
  };
  const invoke = (target, items) => getOptions(target)[0].menus[0].onCommand(null, {
    items, menuElem: win.document.createXULElement("menuitem")
  });

  await invoke("main/library/item", [first]);
  assert(clipboardPath() === await first.getFilePathAsync(), "Single PDF reaches native file clipboard");

  let labels = [];
  const choose = {
    observe(dialog) {
      labels = Array.from(dialog.document.getElementById("list").children)
        .map(item => item.getAttribute("label"));
      dialog.document.getElementById("list").selectedIndex = 1;
      setTimeout(() => dialog.document.querySelector("dialog").acceptDialog(), 0);
    }
  };
  Services.obs.addObserver(choose, "select-dialog-loaded");
  try {
    await invoke("main/library/item", [parent]);
  }
  finally {
    Services.obs.removeObserver(choose, "select-dialog-loaded");
  }
  assert(labels.length === 2, "Multiple PDFs open a native two-option chooser");
  const chosen = Zotero.Items.get(parent.getAttachments())[1];
  assert(clipboardPath() === await chosen.getFilePathAsync(), "Chooser copies selected PDF");

  const previous = clipboardPath();
  const cancel = {
    observe(dialog) {
      setTimeout(() => dialog.document.querySelector("dialog").cancelDialog(), 0);
    }
  };
  Services.obs.addObserver(cancel, "select-dialog-loaded");
  try { await invoke("main/library/item", [parent]); }
  finally { Services.obs.removeObserver(cancel, "select-dialog-loaded"); }
  assert(clipboardPath() === previous, "Cancel preserves clipboard");

  await win.ZoteroPane.selectItems([parent.id]);
  await win.ZoteroPane.buildItemContextMenu();
  const libraryPopup = win.document.getElementById("zotero-itemmenu");
  libraryPopup.dispatchEvent(new win.Event("popupshowing"));
  const libraryMenu = Array.from(libraryPopup.querySelectorAll("menuitem"))
    .find(node => node.getAttribute("label") === "复制原始 PDF 文件…");
  assert(libraryMenu && !libraryMenu.hidden, "Actual library context menu displays copy command");

  const firstReader = await Zotero.Reader.open(first.id);
  await Zotero.Reader.open(second.id);
  const tabPopup = win.Zotero_Tabs._openMenu(150, 100, firstReader.tabID);
  const tabMenu = Array.from(tabPopup.querySelectorAll("menuitem"))
    .find(node => node.getAttribute("label") === "复制原始 PDF 文件");
  assert(tabMenu && !tabMenu.hidden, "Actual background PDF tab context menu displays copy command");
  tabMenu.doCommand();
  const firstPath = await first.getFilePathAsync();
  const deadline = Date.now() + 5000;
  while (clipboardPath() !== firstPath && Date.now() < deadline) {
    await Zotero.Promise.delay(50);
  }
  assert(clipboardPath() === firstPath, "Background tab command copies its own PDF");
  tabPopup.hidePopup();

  const { AddonManager } = ChromeUtils.importESModule("resource://gre/modules/AddonManager.sys.mjs");
  const addon = await AddonManager.getAddonByID(id);
  await addon.disable();
  assert(getOptions("main/library/item").length === 0 && getOptions("main/tab").length === 0,
    "Disable unregisters both menus");
  await addon.enable();
  assert(getOptions("main/library/item").length === 1 && getOptions("main/tab").length === 1,
    "Re-enable restores exactly one copy of each menu");
  const otherParent = new Zotero.Item("journalArticle");
  otherParent.setField("title", "Second batch paper");
  await otherParent.saveTx();
  const third = await Zotero.Attachments.linkFromFile({
    file: PathUtils.join(root, "研究 '#😀.pdf"), parentItemID: otherParent.id
  });
  await win.ZoteroPane.selectItems([parent.id, otherParent.id]);
  await win.ZoteroPane.buildItemContextMenu();
  libraryPopup.dispatchEvent(new win.Event("popupshowing"));
  const batchMenu = Array.from(libraryPopup.querySelectorAll("menuitem"))
    .find(node => node.getAttribute("label") === "批量复制原始 PDF 文件");
  assert(batchMenu && !batchMenu.hidden, "Actual multi-selection menu displays batch copy command");

  Services.obs.addObserver(choose, "select-dialog-loaded");
  try { await invoke("main/library/item", [parent, otherParent, chosen]); }
  finally { Services.obs.removeObserver(choose, "select-dialog-loaded"); }
  const expectedClipboardPaths = [await chosen.getFilePathAsync(), await third.getFilePathAsync()];
  assert(clipboardPath() === expectedClipboardPaths[0], "Batch clipboard exposes the chosen first PDF");
  await invoke("main/library/item", [third]);
  assert(clipboardPath() === expectedClipboardPaths[1], "Single copy replaces a previous native batch");
  Services.obs.addObserver(choose, "select-dialog-loaded");
  try { await invoke("main/library/item", [parent, otherParent, chosen]); }
  finally { Services.obs.removeObserver(choose, "select-dialog-loaded"); }
  assert(clipboardPath() === expectedClipboardPaths[0], "Batch copy replaces a previous single copy");
  Services.obs.addObserver(cancel, "select-dialog-loaded");
  try { await invoke("main/library/item", [third, parent]); }
  finally { Services.obs.removeObserver(cancel, "select-dialog-loaded"); }
  assert(clipboardPath() === expectedClipboardPaths[0], "Canceling a later choice preserves batch clipboard");
  return { version: Zotero.version, passed, expectedClipboardPaths };
}
