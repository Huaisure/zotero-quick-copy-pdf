"""Run native Zotero tests in a temporary profile, never the user's library."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import time
import zipfile

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("app", type=Path, help="Zotero executable")
args = parser.parse_args()
sys.stdout.reconfigure(encoding="utf-8")
repo = Path(__file__).resolve().parent.parent
manifest = json.loads((repo / "manifest.json").read_text(encoding="utf-8"))
root = Path(tempfile.mkdtemp(prefix="quick-copy-pdf-test-"))
print(f"Test files: {root}", flush=True)
profile = root / "profile"
extensions = profile / "extensions"
extensions.mkdir(parents=True)
(root / "data").mkdir()
for name in ("正文.pdf", "补充材料.pdf", "研究 '#😀.pdf"):
    shutil.copyfile(repo / "tests/paper.pdf", root / name)
shutil.copyfile(repo / "tests/integration.js", root / "integration.js")
shutil.copyfile(repo / "dist" / f"quick-copy-pdf-{manifest['version']}.xpi",
                extensions / "quick-copy-pdf@huaisure.xpi")
harness = json.loads(json.dumps(manifest))
harness["name"] = "Quick Copy PDF isolated tests"
harness["applications"]["zotero"]["id"] = "copy-pdf-test-harness@local.zotero"
harness["applications"]["zotero"]["update_url"] = "https://example.invalid/tests.json"
with zipfile.ZipFile(extensions / "copy-pdf-test-harness@local.zotero.xpi", "w") as archive:
    archive.writestr("manifest.json", json.dumps(harness))
    archive.write(repo / "tests/harness.js", "bootstrap.js")
prefs = {
    "extensions.zotero.dataDir": str(root / "data"),
    "extensions.zotero.useDataDir": True,
    "extensions.zotero.firstRun": False,
    "extensions.zotero.sync.autoSync": False,
    "extensions.zotero.httpServer.enabled": False,
    "extensions.zotero.integration.skipInstallation": True,
    "app.update.auto": False,
    "app.update.enabled": False,
    "extensions.update.enabled": False,
    "extensions.startupScanScopes": 15,
    "extensions.sideloadScopes": 15,
    "extensions.autoDisableScopes": 0,
    "browser.shell.checkDefaultBrowser": False,
    "datareporting.policy.dataSubmissionEnabled": False,
}
(profile / "user.js").write_text("\n".join(
    f"user_pref({json.dumps(key)}, {json.dumps(value)});" for key, value in prefs.items()
), encoding="utf-8")
with (root / "runtime.log").open("w", encoding="utf-8") as log:
    process = subprocess.Popen([str(args.app.resolve()), "--new-instance", "--profile",
                                str(profile), "-purgecaches", "-ZoteroDebugText"]
                               + (["-wait-for-browser"] if os.name == "nt" else []),
                               stdout=log, stderr=subprocess.STDOUT)
    try:
        result_file = root / "integration-result.json"
        deadline = time.monotonic() + 180
        while not result_file.exists():
            if process.poll() is not None:
                raise RuntimeError(f"Zotero exited: {process.returncode}")
            if time.monotonic() > deadline:
                raise TimeoutError("Zotero runtime tests timed out")
            time.sleep(1)
        result = json.loads(result_file.read_text(encoding="utf-8"))
        print(json.dumps(result, ensure_ascii=False, indent=2), flush=True)
        assert "error" not in result, result
        assert len(result["passed"]) == 16, result
        # A separate process must see the complete native list, not Gecko's cache.
        if os.name == "nt":
            command = """Add-Type -AssemblyName System.Windows.Forms
            [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new()
            $files = [System.Windows.Forms.Clipboard]::GetFileDropList()
            ConvertTo-Json -InputObject @($files) -Compress"""
            output = subprocess.check_output(
                ["powershell.exe", "-NoProfile", "-STA", "-Command", command], encoding="utf-8"
            )
        else:
            command = """ObjC.import('AppKit');
            var urls = $.NSPasteboard.generalPasteboard.readObjectsForClassesOptions(
                $([$.NSURL]), $({}));
            var paths = [];
            for (var i = 0; i < urls.count; i++) paths.push(ObjC.unwrap(urls.objectAtIndex(i).path));
            JSON.stringify(paths);"""
            output = subprocess.check_output(
                ["osascript", "-l", "JavaScript", "-e", command], encoding="utf-8"
            )
        copied = json.loads(output)
        assert copied == result["expectedClipboardPaths"], repr(copied)
        assert len(copied) == 2, copied
        destination = root / "pasted"
        destination.mkdir()
        for path in copied:
            target = destination / Path(path).name
            shutil.copyfile(path, target)
            assert hashlib.sha256(target.read_bytes()).digest() == hashlib.sha256(
                (repo / "tests/paper.pdf").read_bytes()).digest()
        print("PASS: External native multi-file clipboard and byte-identical copies", flush=True)
    except Exception:
        print((root / "runtime.log").read_text(encoding="utf-8", errors="replace")[-16000:])
        raise
    finally:
        if os.name == "nt":
            subprocess.run(["taskkill", "/PID", str(process.pid), "/T", "/F"],
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        else:
            process.terminate()
        try:
            process.wait(timeout=15)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait()
