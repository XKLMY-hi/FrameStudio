"""Replace the icon in the packaged Electron launcher."""

import ctypes
import struct
import sys
from ctypes import wintypes
from pathlib import Path


def read_icon(file):
    data = file.read_bytes()
    reserved, kind, count = struct.unpack_from("<HHH", data)
    directory_end = 6 + count * 16
    if reserved != 0 or kind != 1 or not 1 <= count <= 32 or len(data) < directory_end:
        raise ValueError("Invalid ICO directory")
    group = bytearray(data[:6])
    images = []
    for index in range(count):
        entry = 6 + index * 16
        size, offset = struct.unpack_from("<II", data, entry + 8)
        if not size or offset < directory_end or offset + size > len(data):
            raise ValueError("Invalid ICO frame")
        resource_id = index + 1
        group.extend(data[entry:entry + 12])
        group.extend(struct.pack("<H", resource_id))
        images.append((resource_id, data[offset:offset + size]))
    return group, images


def set_launcher_icon(executable, icon):
    group, images = read_icon(icon)
    kernel = ctypes.WinDLL("kernel32", use_last_error=True)
    begin = kernel.BeginUpdateResourceW
    begin.argtypes = [wintypes.LPCWSTR, wintypes.BOOL]
    begin.restype = wintypes.HANDLE
    update = kernel.UpdateResourceW
    update.argtypes = [
        wintypes.HANDLE, ctypes.c_void_p, ctypes.c_void_p, wintypes.WORD,
        ctypes.c_void_p, wintypes.DWORD,
    ]
    update.restype = wintypes.BOOL
    end = kernel.EndUpdateResourceW
    end.argtypes = [wintypes.HANDLE, wintypes.BOOL]
    end.restype = wintypes.BOOL

    handle = begin(str(executable.resolve(strict=True)), False)
    if not handle:
        raise ctypes.WinError(ctypes.get_last_error())
    try:
        # The Electron launcher uses group 1 with language 1033.
        # Resource type 3 stores icon images, type 14 stores their directory.
        for resource_type, resource_id, data in [
            *((3, resource_id, data) for resource_id, data in images),
            (14, 1, bytes(group)),
        ]:
            buffer = ctypes.create_string_buffer(data)
            if not update(handle, resource_type, resource_id, 1033, buffer, len(data)):
                raise ctypes.WinError(ctypes.get_last_error())
    except BaseException:
        end(handle, True)
        raise
    if not end(handle, False):
        raise ctypes.WinError(ctypes.get_last_error())


if __name__ == "__main__":
    if sys.platform != "win32" or len(sys.argv) != 3:
        raise SystemExit("Usage on Windows: python set-windows-icon.py launcher.exe icon.ico")
    set_launcher_icon(Path(sys.argv[1]), Path(sys.argv[2]))
