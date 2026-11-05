const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const { test } = require("node:test");

test("install manifest contains Zotero's required metadata", () => {
  const manifest = JSON.parse(fs.readFileSync(`${__dirname}/manifest.json`, "utf8"));
  const zotero = manifest.applications.zotero;
  assert.equal(manifest.manifest_version, 2);
  assert.equal(zotero.id, "quick-copy-pdf@huaisure");
  assert.equal(new URL(zotero.update_url).protocol, "https:");
  assert.equal(zotero.strict_min_version, "8.0");
  assert.equal(zotero.strict_max_version, "10.0.*");
});

function setup() {
  const state = { menus: [], removed: [], clipboard: null, prompts: 0, alerts: [] };
  const file = { exists: () => true, isFile: () => true, isReadable: () => true };
  const transfer = {
    init(value) { assert.equal(value, null); },
    addDataFlavor(flavor) { this.flavor = flavor; },
    setTransferData(flavor, value) { assert.equal(flavor, this.flavor); this.file = value; }
  };
  const sandbox = {
    Zotero: {
      Items: { get: ids => ids },
      File: { pathToFile: path => ({ ...file, path, equals(other) { return this.path === other.path; } }) },
      MenuManager: {
        registerMenu(menu) { state.menus.push(menu); return menu.menuID; },
        unregisterMenu(id) { state.removed.push(id); }
      },
      logError() {}
    },
    Services: {
      prompt: {
        select(_win, _title, _message, labels, selected) {
          state.prompts++;
          state.labels = labels;
          selected.value = state.choice ?? 0;
          return !state.cancel;
        },
        alert(_win, title, message) { state.alerts.push({ title, message }); }
      },
      clipboard: { setData(value) { state.clipboard = value; } }
    },
    Components: {
      classes: { "@mozilla.org/widget/transferable;1": { createInstance: () => transfer } },
      interfaces: { nsITransferable: {}, nsIClipboard: { kGlobalClipboard: 1 } }
    }
  };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(`${__dirname}/bootstrap.js`, "utf8"), sandbox);
  sandbox.startup({ id: "quick-copy-pdf@huaisure" });
  return { state, sandbox, api: sandbox.CopyOriginalPDF, file };
}

const pdf = (path = "/tmp/paper.pdf") => ({
  isRegularItem: () => false,
  isPDFAttachment: () => true,
  attachmentFilename: path ? path.split(/[\\/]/).pop() : "missing.pdf",
  getField: () => "PDF",
  getFilePathAsync: async () => path
});
const parent = attachments => ({ isRegularItem: () => true, getAttachments: () => attachments, getField: () => "Test paper" });

test("registers both official menu targets and unregisters on shutdown", () => {
  const { state, sandbox } = setup();
  assert.deepEqual(state.menus.map(m => m.target), ["main/library/item", "main/tab"]);
  sandbox.shutdown();
  assert.equal(state.removed.length, 2);
  sandbox.startup({ id: "quick-copy-pdf@huaisure" });
  assert.equal(sandbox.CopyOriginalPDF.menuIDs.length, 2);
});

test("single PDF is copied as a file, with no chooser", async () => {
  const { state, api } = setup();
  await api.copy([parent([pdf()])], {});
  assert.equal(state.prompts, 0);
  assert.equal(state.clipboard.flavor, "application/x-moz-file");
  assert.equal(state.clipboard.file.path, "/tmp/paper.pdf");
});

test("multiple PDFs present filenames and copy the selected file", async () => {
  const { state, api } = setup();
  state.choice = 1;
  await api.copy([parent([pdf("/tmp/正文.pdf"), pdf("/tmp/补充材料.pdf")])], {});
  assert.equal(state.prompts, 1);
  assert.match(state.labels[1], /补充材料.pdf/);
  assert.equal(state.clipboard.file.path, "/tmp/补充材料.pdf");
});

test("cancelling leaves the clipboard untouched", async () => {
  const { state, api } = setup();
  state.cancel = true;
  await api.copy([parent([pdf(), pdf()])], {});
  assert.equal(state.clipboard, null);
});

test("no PDFs, deleted PDFs and notes are ignored", async () => {
  const { state, api } = setup();
  const note = { isRegularItem: () => false, isPDFAttachment: () => false };
  for (const items of [[], [parent([])], [note], [null], [{ ...pdf(), deleted: true }],
    [parent([{ ...pdf(), deleted: true }, note])]]) {
    assert.equal(api.getPDFs(items).length, 0);
    await api.copy(items, {});
  }
  assert.equal(state.clipboard, null);
});

test("a missing local file fails without changing the clipboard", async () => {
  const { state, api } = setup();
  await assert.rejects(api.copy([pdf(false)], {}), /不在本机/);
  assert.equal(state.clipboard, null);
});

test("unreadable paths and directories are rejected", async () => {
  for (const check of ["exists", "isFile", "isReadable"]) {
    const { state, api, file } = setup();
    file[check] = () => false;
    await assert.rejects(api.copy([pdf()], {}), /无法读取/);
    assert.equal(state.clipboard, null);
  }
});

test("the tab command uses the right-clicked attachment from context", async () => {
  const { state } = setup();
  await state.menus[1].menus[0].onCommand(null, {
    items: [pdf("/tmp/background-tab.pdf")], menuElem: { ownerGlobal: {} }
  });
  assert.equal(state.clipboard.file.path, "/tmp/background-tab.pdf");
});

test("menu is hidden for non-PDF items and offers a chooser for multiple PDFs", () => {
  const { state } = setup();
  const context = {
    items: [parent([])],
    menuElem: { setAttribute(_name, value) { context.label = value; } },
    setVisible(value) { context.visible = value; }
  };
  const show = state.menus[0].menus[0].onShowing;
  show(null, context);
  assert.equal(context.visible, false);
  context.items = [parent([pdf(), pdf()])];
  show(null, context);
  assert.equal(context.visible, true);
  assert.match(context.label, /…$/);
});

test("errors are shown through the command handler", async () => {
  const { state } = setup();
  await state.menus[0].menus[0].onCommand(null, {
    items: [pdf(false)], menuElem: { ownerGlobal: {} }
  });
  assert.equal(state.alerts.length, 1);
  assert.match(state.alerts[0].message, /不在本机/);
});

test("disabling while awaiting a path prevents a clipboard write", async () => {
  const { state, api, sandbox } = setup();
  let resolve;
  const attachment = pdf();
  attachment.getFilePathAsync = () => new Promise(r => { resolve = r; });
  const pending = api.copy([attachment], {});
  sandbox.shutdown();
  resolve("/tmp/paper.pdf");
  await pending;
  assert.equal(state.clipboard, null);
});

test("failed menu registration cleans up the earlier menu", () => {
  const { state, sandbox } = setup();
  sandbox.shutdown();
  state.removed.length = 0;
  let calls = 0;
  sandbox.Zotero.MenuManager.registerMenu = () => ++calls === 1 ? "first" : false;
  assert.throws(() => sandbox.startup({ id: "test" }), /无法注册/);
  assert.deepEqual(state.removed, ["first"]);
  assert.equal(sandbox.CopyOriginalPDF.active, false);
});


test("Windows drive and UNC paths reach the native clipboard unchanged", async () => {
  for (const path of [String.raw`C:\Users\Reader\论文 资料\正文.pdf`,
    String.raw`\\server\papers\补充 材料.pdf`]) {
    const { state, api } = setup();
    await api.copy([pdf(path)], {});
    assert.equal(state.clipboard.flavor, "application/x-moz-file");
    assert.equal(state.clipboard.file.path, path);
  }
});


test("batch collects one PDF per item, skips non-PDFs and removes duplicate files", async () => {
  const { state, api } = setup();
  const writes = [];
  api.copyFiles = files => writes.push(files.map(file => file.path));
  state.choice = 1;
  await api.copy([parent([pdf("/tmp/a.pdf")]), parent([]),
    parent([pdf("/tmp/b.pdf"), pdf("/tmp/选中.pdf")]), pdf("/tmp/a.pdf")], {});
  assert.deepEqual(writes.map(paths => Array.from(paths)), [["/tmp/a.pdf", "/tmp/选中.pdf"]]);
  assert.equal(state.prompts, 1);
  assert.equal(state.clipboard, null);
});

test("canceling a later batch choice preserves the previous clipboard", async () => {
  const { state, api } = setup();
  await api.copy([pdf("/tmp/previous.pdf")], {});
  const previous = state.clipboard;
  api.copyFiles = () => assert.fail("must not write a partial batch");
  state.cancel = true;
  await api.copy([pdf("/tmp/a.pdf"), parent([pdf(), pdf()])], {});
  assert.equal(state.clipboard, previous);
  assert.equal(state.clipboard.file.path, "/tmp/previous.pdf");
});

test("a missing later batch file preserves the previous clipboard", async () => {
  const { state, api } = setup();
  await api.copy([pdf("/tmp/previous.pdf")], {});
  const previous = state.clipboard;
  api.copyFiles = () => assert.fail("must not write a partial batch");
  await assert.rejects(api.copy([pdf("/tmp/a.pdf"), pdf(false)], {}), /不在本机/);
  assert.equal(state.clipboard, previous);
  assert.equal(state.clipboard.file.path, "/tmp/previous.pdf");
});

test("batch reduced to one unique file uses the single-file clipboard", async () => {
  const { state, api } = setup();
  api.copyFiles = () => assert.fail("only one file remains");
  await api.copy([parent([]), pdf(), parent([pdf()])], {});
  assert.equal(state.clipboard.file.path, "/tmp/paper.pdf");
});

test("multi-selection menu is visible when any selected item has a PDF", () => {
  const { state } = setup();
  const context = {
    items: [parent([]), pdf()],
    menuElem: { setAttribute(_name, value) { context.label = value; } },
    setVisible(value) { context.visible = value; }
  };
  state.menus[0].menus[0].onShowing(null, context);
  assert.equal(context.visible, true);
  assert.equal(context.label, "批量复制原始 PDF 文件");
  context.items = [parent([]), parent([])];
  state.menus[0].menus[0].onShowing(null, context);
  assert.equal(context.visible, false);
});

test("disabling while resolving a later batch file prevents all writes", async () => {
  const { state, api, sandbox } = setup();
  api.copyFiles = () => assert.fail("must not write after shutdown");
  const last = pdf();
  last.getFilePathAsync = async () => { sandbox.shutdown(); return "/tmp/last.pdf"; };
  await api.copy([pdf("/tmp/first.pdf"), last], {});
  assert.equal(state.clipboard, null);
});
