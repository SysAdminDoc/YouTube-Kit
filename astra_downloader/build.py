#!/usr/bin/env python3
"""
Build AstraDownloader.exe using PyInstaller.
Outputs to ../AstraDownloader.exe alongside the logo/icon.
"""
import importlib.util
import shutil
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).parent.resolve()
ROOT = HERE.parent
SCRIPT = HERE / "astra_downloader.py"
ICON = ROOT / "AstraDownloader.ico"
OUT_EXE = ROOT / "AstraDownloader.exe"

BUILD_DIR = HERE / "build"
DIST_DIR = HERE / "dist"
SPEC_DIR = BUILD_DIR / "spec"


def assert_inside_workspace(path):
    resolved = path.resolve()
    if resolved != HERE and HERE not in resolved.parents:
        raise SystemExit(f"Refusing to clean path outside astra_downloader: {resolved}")


def clean():
    for d in (BUILD_DIR, DIST_DIR):
        if d.exists():
            assert_inside_workspace(d)
            shutil.rmtree(d, ignore_errors=True)


def preflight():
    if not SCRIPT.exists():
        raise SystemExit(f"Missing entry point: {SCRIPT}")
    if not ICON.exists():
        raise SystemExit(f"Missing icon: {ICON}")
    if importlib.util.find_spec("PyInstaller") is None:
        raise SystemExit(
            "PyInstaller is not installed. Install it with: "
            f"{sys.executable} -m pip install pyinstaller"
        )


def build():
    preflight()
    clean()
    SPEC_DIR.mkdir(parents=True, exist_ok=True)
    args = [
        sys.executable, "-m", "PyInstaller",
        "--noconfirm",
        "--clean",
        "--onefile",
        "--windowed",
        "--name", "AstraDownloader",
        "--icon", str(ICON),
        "--specpath", str(SPEC_DIR),
        # Required hidden imports
        "--hidden-import", "PyQt6.QtCore",
        "--hidden-import", "PyQt6.QtGui",
        "--hidden-import", "PyQt6.QtWidgets",
        "--hidden-import", "flask",
        "--hidden-import", "werkzeug",
        "--hidden-import", "requests",
        # Exclude unused stdlib to shrink size
        "--exclude-module", "tkinter",
        "--exclude-module", "unittest",
        "--exclude-module", "pydoc",
        str(SCRIPT),
    ]
    print("Building AstraDownloader.exe...")
    subprocess.check_call(args, cwd=str(HERE))

    built = DIST_DIR / "AstraDownloader.exe"
    if not built.exists():
        raise SystemExit(f"Build failed: {built} not found")

    OUT_EXE.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(built, OUT_EXE)
    size_mb = OUT_EXE.stat().st_size / (1024 * 1024)
    print(f"OK: {OUT_EXE} ({size_mb:.1f} MB)")


if __name__ == "__main__":
    build()
