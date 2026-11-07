from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
import hashlib, json
root=Path(__file__).resolve().parent.parent
source=root/'release'/'FrameStudio-2.0.0-portable'
patch=root/'release'/'帧间_2.0_轻量更新补丁.zip'
with ZipFile(patch,'w',compression=ZIP_DEFLATED,compresslevel=6) as z:
    app=source/'resources'/'app'
    for folder in ('dist','backend','electron'):
        for f in (app/folder).rglob('*'):
            if f.is_file():
                if 'vendor' in f.relative_to(app).parts:
                    old=root/'release'/'FrameStudio-1.1.0-portable'/'resources'/'app'/f.relative_to(app)
                    assert old.read_bytes()==f.read_bytes(), 'Changed vendor must ship in patch'
                    continue
                z.write(f,f.relative_to(source).as_posix())
    z.write(app/'package.json','resources/app/package.json')
    z.write(source/'使用说明.md','使用说明.md')
    z.write(source/'第三方组件说明.md','第三方组件说明.md')
    z.writestr('更新说明.txt','先关闭帧间，将本补丁解压到帧间.exe所在目录并覆盖同名文件，再重新启动。\n适用于 1.0 / 1.1，保留 data 中的模型、媒体与草稿。\n2.0：多角色场景、图层组、2.5D 景深、相机、独立控制器、后处理层、音频库/淡入淡出、文字动画、通用关键帧和 .livemg 工程。\n示例工程另附下载，轻量补丁不包含示例媒体。\n')
with ZipFile(patch) as z:
    assert z.testzip() is None
    assert not any('/data/' in n or '/tools/' in n for n in z.namelist())
    assert 'resources/app/backend/livemg.mjs' in z.namelist()
print('PATCH',patch.stat().st_size,flush=True)
target=root/'release'/'帧间_小剧场编辑器_2.0.zip'
with ZipFile(target,'w',compression=ZIP_DEFLATED,compresslevel=6) as z:
    for f in source.rglob('*'):
        if f.is_file():z.write(f,f.relative_to(source.parent).as_posix())
with ZipFile(target) as z:
    assert z.testzip() is None
    assert 'FrameStudio-2.0.0-portable/帧间.exe' in z.namelist()
    assert 'FrameStudio-2.0.0-portable/示例工程_街角对白.livemg' in z.namelist()
    assert not any('/browser-profile/' in n or '/exports/' in n for n in z.namelist())
report={'fullBytes':target.stat().st_size,'patchBytes':patch.stat().st_size,'sha256':hashlib.file_digest(target.open('rb'),'sha256').hexdigest(),'crc':'passed','unicodeNames':True,'patchPreservesData':True}
(root/'qa'/'package-v20-report.json').write_text(json.dumps(report,indent=2),encoding='utf-8')
print(json.dumps(report),flush=True)
