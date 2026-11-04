"""Build the XPI and Zotero update manifest using only the standard library."""
import hashlib
import json
from pathlib import Path
import zipfile

root = Path(__file__).resolve().parent
manifest = json.loads((root / "manifest.json").read_text(encoding="utf-8"))
zotero = manifest["applications"]["zotero"]
version = manifest["version"]
assert all(zotero.get(key) for key in ("id", "update_url", "strict_min_version", "strict_max_version"))
assert all(c.isdigit() or c == "." for c in version), "Expected a numeric release version"

destination = root / "dist" / f"quick-copy-pdf-{version}.xpi"
destination.parent.mkdir(exist_ok=True)
files = ("manifest.json", "bootstrap.js")
with zipfile.ZipFile(destination, "w", compression=zipfile.ZIP_DEFLATED) as archive:
    for name in files:
        entry = zipfile.ZipInfo(name, date_time=(2026, 1, 1, 0, 0, 0))
        entry.create_system = 3
        entry.compress_type = zipfile.ZIP_DEFLATED
        entry.external_attr = 0o644 << 16
        archive.writestr(entry, (root / name).read_bytes())

with zipfile.ZipFile(destination) as archive:
    assert archive.testzip() is None
    assert set(archive.namelist()) == set(files)
    for name in files:
        assert archive.read(name) == (root / name).read_bytes()

digest = hashlib.sha256(destination.read_bytes()).hexdigest()
update = {"addons": {zotero["id"]: {"updates": [{
    "version": version,
    "update_link": f"https://github.com/Huaisure/zotero-quick-copy-pdf/releases/download/v{version}/{destination.name}",
    "update_hash": f"sha256:{digest}",
    "applications": {"zotero": {
        "strict_min_version": zotero["strict_min_version"],
        "strict_max_version": zotero["strict_max_version"],
    }},
}]}}}
(root / "updates.json").write_text(json.dumps(update, indent=2) + "\n", encoding="utf-8")
print(destination)
print(f"SHA256: {digest}")
