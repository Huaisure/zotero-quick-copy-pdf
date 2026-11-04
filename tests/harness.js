function startup() {
  Zotero.uiReadyPromise.then(() => setTimeout(async () => {
    const testRoot = PathUtils.parent(Zotero.DataDirectory.dir);
    const output = PathUtils.join(testRoot, "integration-result.json");
    try {
      const scope = { Zotero, Services, IOUtils, PathUtils, Components, ChromeUtils, setTimeout };
      Services.scriptloader.loadSubScript(
        Zotero.File.pathToFileURI(PathUtils.join(testRoot, "integration.js")), scope
      );
      await IOUtils.writeJSON(output, await scope.run());
    }
    catch (e) {
      await IOUtils.writeJSON(output, {error: String(e), stack: e.stack});
    }
  }, 1500));
}
function shutdown() {}
function install() {}
function uninstall() {}
