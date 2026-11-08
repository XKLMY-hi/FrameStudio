"""Archive the current Windows portable build and create a source-only update."""

import argparse
import json
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile

parser = argparse.ArgumentParser()
parser.add_argument("--baseline", required=True, help="Installed version used to verify unchanged vendor files")
args = parser.parse_args()

root = Path(__file__).resolve().parent.parent
release = root / "release"
version = json.loads((root / "package.json").read_text(encoding="utf-8"))["version"]
source = release / f"FrameStudio-{version}-portable"
app = source / "resources" / "app"
baseline = release / f"FrameStudio-{args.baseline}-portable" / "resources" / "app"
documents = ("使用说明.md", "第三方组件说明.md", "SHADERS.md", "examples/iris-film.fshader.json")
brand_files = sorted(file for file in (source / "docs" / "brand").rglob("*") if file.is_file())

portable_files = sorted(file for file in source.rglob("*") if file.is_file())
if not (source / "FrameStudio.exe").is_file():
    parser.error(f"Portable build not found: {source}")

asset_extensions = (
    ".zip", ".livemg", ".l2dstudio", ".moc", ".moc3", ".model3.json", ".motion3.json",
    ".physics3.json", ".exp3.json", ".pose3.json", ".cdi3.json", ".userdata3.json",
    ".mtn", ".model.json", ".physics.json", ".exp.json", ".pose.json",
)
local_previews = {
    "动作试听预览.png", "变换控制器预览.png", "曲线工作区预览.png", "模型预处理预览.png", "界面预览.png",
}
for file in portable_files:
    relative = file.relative_to(source)
    parts = tuple(part.casefold() for part in relative.parts)
    if (
        parts[:3] == ("resources", "app", "data")
        or file.name.casefold().endswith(asset_extensions)
        or file.name.casefold() in {"model.json", "live2d.min.js"}
        or file.name.casefold() in local_previews
    ):
        parser.error(f"Remove local assets from the public build: {relative}")

patch_files = [app / "package.json"]
for folder in ("dist", "backend", "electron"):
    for file in sorted((app / folder).rglob("*")):
        if not file.is_file():
            continue
        relative = file.relative_to(app)
        if "vendor" in relative.parts and (baseline / relative).is_file():
            if file.read_bytes() == (baseline / relative).read_bytes():
                continue
        patch_files.append(file)

patch = release / f"FrameStudio_{version}_轻量更新补丁.zip"
with ZipFile(patch, "w", compression=ZIP_DEFLATED) as archive:
    for file in [*patch_files, *(source / name for name in documents), *brand_files]:
        archive.write(file, file.relative_to(source).as_posix())
    archive.writestr(
        "更新说明.txt",
        f"关闭 FrameStudio，将补丁解压到 FrameStudio.exe 所在目录，覆盖同名文件。\n"
        f"重新打开后检查版本 {version}。功能变更见使用说明。\n"
        "如果要更新资源管理器里显示的程序文件图标，请使用完整便携版中的 FrameStudio.exe。\n",
    )
with ZipFile(patch) as archive:
    assert archive.testzip() is None
    assert not any("/data/" in name or "/tools/" in name for name in archive.namelist())

portable = release / f"FrameStudio_{version}_便携版.zip"
with ZipFile(portable, "w", compression=ZIP_DEFLATED) as archive:
    for file in portable_files:
        archive.write(file, file.relative_to(release).as_posix())
with ZipFile(portable) as archive:
    assert archive.testzip() is None
    assert f"{source.name}/FrameStudio.exe" in archive.namelist()
    assert not any("/browser-profile/" in name or "/exports/" in name for name in archive.namelist())

print(f"PATCH {patch.stat().st_size} bytes")
print(f"PORTABLE {portable.stat().st_size} bytes")
