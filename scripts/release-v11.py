from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
import json, hashlib
root=Path(__file__).resolve().parent.parent
source=root/'release'/'FrameStudio-1.1.0-portable'
patch=root/'release'/'帧间_1.1_轻量更新补丁.zip'
with ZipFile(patch,'w',compression=ZIP_DEFLATED,compresslevel=6) as z:
    app=source/'resources'/'app'
    for folder in ('dist','electron'):
        for f in (app/folder).rglob('*'):
            if f.is_file() and 'vendor' not in f.relative_to(app).parts:
                z.write(f,f.relative_to(source).as_posix())
    z.write(app/'package.json','resources/app/package.json')
    z.writestr('更新说明.txt','先关闭帧间，将本补丁解压到帧间.exe所在目录并覆盖同名文件，然后重新启动。\n只更新程序，不覆盖 data 文件夹中的模型、音频、草稿。\n1.1：通用轨道与自由命名、面板关闭修复、MD3 界面、预览性能优化。\n')
with ZipFile(patch) as z:
    assert z.testzip() is None
    assert not any('/data/' in n for n in z.namelist())
target=root/'release'/'帧间_Live2D便携工作室_1.1.zip'
with ZipFile(target,'w',compression=ZIP_DEFLATED,compresslevel=6) as z:
    for f in source.rglob('*'):
        if f.is_file(): z.write(f,f.relative_to(source.parent).as_posix())
with ZipFile(target) as z:
    assert z.testzip() is None
    assert 'FrameStudio-1.1.0-portable/帧间.exe' in z.namelist()
    assert not any('/browser-profile/' in n or '/exports/' in n for n in z.namelist())
report={'fullBytes':target.stat().st_size,'patchBytes':patch.stat().st_size,'sha256':hashlib.file_digest(target.open('rb'),'sha256').hexdigest(),'crc':'passed','patchPreservesData':True}
(root/'qa'/'package-v11-report.json').write_text(json.dumps(report,indent=2),encoding='utf-8')
print(json.dumps(report))
