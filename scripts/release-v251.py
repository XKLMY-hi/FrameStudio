from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
import hashlib, json

root = Path(__file__).resolve().parent.parent
source = root / 'release' / 'FrameStudio-2.5.1-portable'
patch = root / 'release' / 'FrameStudio_2.5.1_轻量更新补丁.zip'
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
    z.writestr('更新说明.txt', '关闭 FrameStudio，将补丁解压到 exe 所在目录，覆盖同名文件。\n素材、草稿和工具保留。重启后标题应显示 FrameStudio 2.5.1。\n修正右键菜单尺寸；曲线区使用和时间线一致的对象及属性分类，仅显示选中的曲线，并优化密集关键帧播放和拖动。\n')
with ZipFile(patch) as z:
    assert z.testzip() is None
    assert not any('/data/' in n or '/tools/' in n for n in z.namelist())
    assert 'resources/app/backend/livemg.mjs' in z.namelist()
print('PATCH', patch.stat().st_size, flush=True)

target = root / 'release' / 'FrameStudio_2.5.1_便携版.zip'
with ZipFile(target, 'w', compression=ZIP_DEFLATED, compresslevel=6) as z:
    for f in source.rglob('*'):
        if f.is_file():
            z.write(f, f.relative_to(source.parent).as_posix())
with ZipFile(target) as z:
    assert z.testzip() is None
    for name in ('FrameStudio.exe', '示例工程_场景灯光与模型预处理.livemg', '模型预处理预览.png'):
        assert 'FrameStudio-2.5.1-portable/' + name in z.namelist()
    assert not any('/browser-profile/' in n or '/exports/' in n for n in z.namelist())
report = {'fullBytes': target.stat().st_size, 'patchBytes': patch.stat().st_size, 'sha256': hashlib.file_digest(target.open('rb'), 'sha256').hexdigest(), 'crc': 'passed', 'unicodeNames': True, 'patchPreservesData': True}
(root / 'qa' / 'package-v251-report.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
print(json.dumps(report), flush=True)
