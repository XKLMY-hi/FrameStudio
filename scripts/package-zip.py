from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
import hashlib, json
root = Path(__file__).resolve().parent.parent
source = root / 'release' / 'FrameStudio-1.0.0-portable'
target = root / 'release' / '帧间_Live2D便携工作室_1.0.zip'
with ZipFile(target, 'w', compression=ZIP_DEFLATED, compresslevel=6) as archive:
    for file in source.rglob('*'):
        if file.is_file():
            archive.write(file, file.relative_to(source.parent).as_posix())
with ZipFile(target) as archive:
    names = archive.namelist()
    assert 'FrameStudio-1.0.0-portable/帧间.exe' in names
    assert any(name.endswith('/示例工程_叠加与口型.l2dstudio') for name in names)
    assert not any('/browser-profile/' in name or '/exports/' in name for name in names)
    assert archive.testzip() is None
digest = hashlib.file_digest(target.open('rb'), 'sha256').hexdigest()
report = dict(files=len(names), bytes=target.stat().st_size, sha256=digest, crc='passed', unicode_names='passed')
(root/'qa'/'package-report.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
print(json.dumps(report))
