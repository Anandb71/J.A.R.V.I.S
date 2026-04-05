# -*- mode: python ; coding: utf-8 -*-

from PyInstaller.utils.hooks import collect_data_files, collect_submodules

block_cipher = None

hiddenimports = [
    *collect_submodules("uvicorn"),
    *collect_submodules("chromadb"),
    *collect_submodules("sentence_transformers"),
    "onnxruntime",
    "tokenizers",
    "psutil",
    "structlog",
]

datas = [
    *collect_data_files("chromadb"),
    *collect_data_files("sentence_transformers"),
]


def _is_excluded_runtime_asset(src_path: str) -> bool:
    lower_src = str(src_path).replace("\\", "/").lower()
    excluded_fragments = (
        "/.jarvis/models/",
        "/models/",
        "/model/",
        "/huggingface/",
    )
    if any(fragment in lower_src for fragment in excluded_fragments):
        return True
    return lower_src.endswith((".gguf", ".bin", ".safetensors", ".pt", ".pth"))


datas = [item for item in datas if not _is_excluded_runtime_asset(item[0])]

a = Analysis(
    ["backend/main.py"],
    pathex=[],
    binaries=[],
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[
        "torch",
        "tensorflow",
        "transformers",
    ],
    noarchive=False,
)
pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="jarvis-backend",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    console=True,
)

coll = COLLECT(
    exe,
    a.binaries,
    a.zipfiles,
    a.datas,
    strip=False,
    upx=True,
    upx_exclude=[],
    name="jarvis-backend",
)
