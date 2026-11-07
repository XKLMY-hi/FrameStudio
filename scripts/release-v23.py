from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
import hashlib, json

root = Path(__file__).resolve().parent.parent
source = root / 'release' / 'FrameStudio-2.3.0-portable'
patch = root / 'release' / '帧间_2.3_轻量更新补丁.zip'
with ZipFile(patch, 'w', compression=ZIP_DEFLATED, compresslevel=6) as z:
    app = source / 'resources' / 'app'
    for folder in ('dist', 'backend', 'electron'):
        for f in (app / folder).rglob('*'):
            if f.is_file():
                if 'vendor' in f.relative_to(app).parts:
                    old = root / 'release' / 'FrameStudio-1.1.0-portable' / 'resources' / 'app' / f.relative_to(app)
                    assert old.read_bytes() == f.read_bytes(), 'Changed vendor must ship in patch'
                    continue
                z.write(f, f.relative_to(source).as_posix())
    for name in ('package.json',):
        z.write(app / name, 'resources/app/' + name)
    for name in ('使用说明.md', '第三方组件说明.md'):
        z.write(source / name, name)
    z.writestr('更新说明.txt', '先关闭帧间，将本补丁解压到帧间.exe所在目录并覆盖同名文件，再重新启动。\n适用于 1.0 / 1.1 / 2.0 / 2.1 / 2.1.1 / 2.2，保留 data 中的模型、媒体与草稿。\n2.3：新增三维场景视图，可环绕、平移、推拉、切换角度和聚焦；新增逐帧、循环、慢放与隐藏对象试听。成片相机和现有工程保持原样。\n窗口标题应显示 2.3；无需重建原工程。示例工程另附下载，轻量补丁不包含示例媒体。\n')
with ZipFile(patch) as z:
    assert z.testzip() is None
    assert not any('/data/' in n or '/tools/' in n for n in z.namelist())
    assert 'resources/app/backend/livemg.mjs' in z.namelist()
print('PATCH', patch.stat().st_size, flush=True)

target = root / 'release' / '帧间_小剧场编辑器_2.3.zip'
with ZipFile(target, 'w', compression=ZIP_DEFLATED, compresslevel=6) as z:
    for f in source.rglob('*'):
        if f.is_file():
            z.write(f, f.relative_to(source.parent).as_posix())
with ZipFile(target) as z:
    assert z.testzip() is None
    for name in ('帧间.exe', '示例工程_场景灯光与模型预处理.livemg', '模型预处理预览.png'):
        assert 'FrameStudio-2.3.0-portable/' + name in z.namelist()
    assert not any('/browser-profile/' in n or '/exports/' in n for n in z.namelist())
report = {'fullBytes': target.stat().st_size, 'patchBytes': patch.stat().st_size, 'sha256': hashlib.file_digest(target.open('rb'), 'sha256').hexdigest(), 'crc': 'passed', 'unicodeNames': True, 'patchPreservesData': True}
(root / 'qa' / 'package-v23-report.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
print(json.dumps(report), flush=True)
