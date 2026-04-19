#!/usr/bin/env python3
"""
Astra Downloader — Desktop GUI + HTTP API server for Astra Deck.
Manages yt-dlp downloads with a PyQt6 GUI, system tray, and REST API on port 9751.

First run auto-downloads yt-dlp + ffmpeg. No separate installer needed.
"""

import sys, os, json, time, re, uuid, subprocess, threading, signal, socket, shutil
from pathlib import Path
from datetime import datetime, timedelta

# ── Bootstrap: auto-install dependencies ──
def _bootstrap():
    """Install required packages before importing them."""
    required = {'PyQt6': 'PyQt6', 'flask': 'flask', 'requests': 'requests'}
    missing = []
    for mod, pkg in required.items():
        try:
            __import__(mod)
        except ImportError:
            missing.append(pkg)
    if not missing:
        return
    for strategy in [
        [sys.executable, '-m', 'pip', 'install', '--quiet'],
        [sys.executable, '-m', 'pip', 'install', '--quiet', '--user'],
        [sys.executable, '-m', 'pip', 'install', '--quiet', '--break-system-packages'],
    ]:
        try:
            subprocess.check_call(strategy + missing, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            return
        except Exception:
            continue

_bootstrap()

from PyQt6.QtWidgets import (
    QApplication, QMainWindow, QWidget, QVBoxLayout, QHBoxLayout, QGridLayout,
    QLabel, QPushButton, QTabWidget, QScrollArea, QFrame, QCheckBox, QLineEdit,
    QFileDialog, QSystemTrayIcon, QMenu, QMessageBox, QProgressBar, QTextEdit,
    QSizePolicy, QSpacerItem
)
from PyQt6.QtCore import Qt, QTimer, pyqtSignal, QObject, QThread, QSize
from PyQt6.QtGui import QIcon, QFont, QPixmap, QColor, QPalette, QAction
from flask import Flask, request, jsonify
import requests as http_requests

# ══════════════════════════════════════════════════════════════
# CONSTANTS
# ══════════════════════════════════════════════════════════════
APP_NAME = "Astra Downloader"
APP_VERSION = "1.1.0"
SERVER_PORT = 9751
MAX_CONCURRENT = 3
INSTALL_DIR = Path(os.environ.get('LOCALAPPDATA', Path.home() / 'AppData' / 'Local')) / 'AstraDownloader'
CONFIG_PATH = INSTALL_DIR / 'config.json'
HISTORY_PATH = INSTALL_DIR / 'history.json'
ARCHIVE_PATH = INSTALL_DIR / 'archive.txt'
LOG_PATH = INSTALL_DIR / 'server.log'
YTDLP_PATH = INSTALL_DIR / 'yt-dlp.exe'
FFMPEG_PATH = INSTALL_DIR / 'ffmpeg.exe'
ICON_PATH = INSTALL_DIR / 'AstraDownloader.ico'

YTDLP_URL = "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe"
FFMPEG_URL = "https://github.com/yt-dlp/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip"
ICON_URL = "https://raw.githubusercontent.com/SysAdminDoc/Astra-Deck/main/AstraDownloader.ico"

DEFAULT_CONFIG = {
    "DownloadPath": str(Path.home() / "Videos" / "YouTube"),
    "AudioDownloadPath": "",
    "ServerPort": SERVER_PORT,
    "ServerToken": "",
    "EmbedMetadata": True,
    "EmbedThumbnail": True,
    "EmbedChapters": True,
    "EmbedSubs": False,
    "SubLangs": "en",
    "SponsorBlock": False,
    "SponsorBlockAction": "remove",
    "ConcurrentFragments": 4,
    "DownloadArchive": True,
    "AutoUpdateYtDlp": True,
    "RateLimit": "",
    "Proxy": "",
    "StartMinimized": False,
    "CloseToTray": True,
}

# ── Dark theme stylesheet (Catppuccin-inspired) ──
STYLESHEET = """
QMainWindow, QWidget { background-color: #0a0e14; color: #e6edf3; }
QLabel { color: #e6edf3; }
QLabel[class="muted"] { color: #525a65; }
QLabel[class="secondary"] { color: #8b949e; }
QLabel[class="heading"] { font-size: 20px; font-weight: bold; }
QLabel[class="section"] { color: #525a65; font-size: 10px; font-weight: bold; letter-spacing: 1px; }

QPushButton {
    background-color: #1a2028; color: #8b949e; border: 1px solid #2a3140;
    border-radius: 8px; padding: 8px 16px; font-size: 12px; font-weight: 600;
}
QPushButton:hover { background-color: #222a35; }
QPushButton:disabled { opacity: 0.5; }
QPushButton[class="primary"] {
    background-color: #22c55e; color: #0a0a0a; border: none; font-weight: bold;
}
QPushButton[class="primary"]:hover { background-color: #16a34a; }
QPushButton[class="danger"] {
    background-color: #ef4444; color: white; border: none; font-weight: bold;
}
QPushButton[class="danger"]:hover { background-color: #dc2626; }
QPushButton[class="nav"] {
    background-color: transparent; color: #8b949e; border: none;
    text-align: left; padding: 10px 16px; font-size: 13px; font-weight: 600;
    border-radius: 8px;
}
QPushButton[class="nav"]:hover { background-color: #1a2028; }
QPushButton[class="nav"][active="true"] { color: #22c55e; font-weight: bold; }

QLineEdit {
    background-color: #1a2028; color: #e6edf3; border: 1px solid #2a3140;
    border-radius: 6px; padding: 6px 8px; font-size: 12px;
    selection-background-color: #22c55e;
}
QLineEdit:focus { border-color: #22c55e; }

QCheckBox { color: #8b949e; font-size: 12px; spacing: 8px; }
QCheckBox::indicator { width: 16px; height: 16px; border-radius: 4px; border: 1px solid #2a3140; background: #1a2028; }
QCheckBox::indicator:checked { background: #22c55e; border-color: #22c55e; }

QFrame[class="card"] {
    background-color: #151b23; border: 1px solid #2a3140; border-radius: 10px;
}
QFrame[class="sidebar"] {
    background-color: #0d1117; border-right: 1px solid #2a3140;
}
QFrame[class="stat"] {
    background-color: #151b23; border: 1px solid #2a3140; border-radius: 10px;
}

QTextEdit {
    background-color: #151b23; color: #525a65; border: 1px solid #2a3140;
    border-radius: 8px; font-family: 'Cascadia Code', 'Consolas', monospace;
    font-size: 11px; padding: 8px;
}

QScrollArea { border: none; background: transparent; }
QScrollBar:vertical { background: #0a0e14; width: 8px; border: none; }
QScrollBar::handle:vertical { background: #2a3140; border-radius: 4px; min-height: 20px; }
QScrollBar::add-line:vertical, QScrollBar::sub-line:vertical { height: 0; }

QProgressBar { background: #1a2028; border: none; border-radius: 4px; height: 6px; text-align: center; }
QProgressBar::chunk { background: #22c55e; border-radius: 4px; }

QTabWidget::pane { border: none; }
QTabBar { background: transparent; }
QTabBar::tab { height: 0; width: 0; }
"""

# ══════════════════════════════════════════════════════════════
# CONFIG
# ══════════════════════════════════════════════════════════════
class Config:
    def __init__(self):
        INSTALL_DIR.mkdir(parents=True, exist_ok=True)
        self._data = dict(DEFAULT_CONFIG)
        if CONFIG_PATH.exists():
            try:
                with open(CONFIG_PATH, 'r', encoding='utf-8') as f:
                    saved = json.load(f)
                for k, v in saved.items():
                    self._data[k] = v
            except Exception:
                pass
        if not self._data.get("ServerToken"):
            self._data["ServerToken"] = uuid.uuid4().hex
        self.save()

    def get(self, key, default=None):
        return self._data.get(key, default)

    def set(self, key, value):
        self._data[key] = value

    def save(self):
        try:
            with open(CONFIG_PATH, 'w', encoding='utf-8') as f:
                json.dump(self._data, f, indent=2)
        except Exception:
            pass

    @property
    def data(self):
        return dict(self._data)

# ══════════════════════════════════════════════════════════════
# HISTORY
# ══════════════════════════════════════════════════════════════
class History:
    def __init__(self):
        if not HISTORY_PATH.exists():
            self._write([])

    def load(self):
        try:
            with open(HISTORY_PATH, 'r', encoding='utf-8') as f:
                return json.load(f)
        except Exception:
            return []

    def add(self, entry):
        data = self.load()
        data.append(entry)
        if len(data) > 500:
            data = data[-500:]
        self._write(data)

    def clear(self):
        self._write([])

    def _write(self, data):
        try:
            with open(HISTORY_PATH, 'w', encoding='utf-8') as f:
                json.dump(data, f)
        except Exception:
            pass

# ══════════════════════════════════════════════════════════════
# DOWNLOAD MANAGER
# ══════════════════════════════════════════════════════════════
class Download:
    def __init__(self, dl_id, url, audio_only=False, fmt=None, quality='best',
                 output_dir=None, title=None, referer=None):
        self.id = dl_id
        self.url = url
        self.audio_only = audio_only
        self.format = fmt or ('mp3' if audio_only else 'mp4')
        self.quality = quality
        self.output_dir = output_dir
        self.title = title or "Unknown"
        self.referer = referer
        self.status = "queued"
        self.progress = 0.0
        self.speed = ""
        self.eta = ""
        self.filename = ""
        self.error = ""
        self.start_time = time.time()
        self.process = None

    def to_dict(self):
        return {
            "id": self.id, "url": self.url, "title": self.title,
            "status": self.status, "progress": round(self.progress, 1),
            "speed": self.speed, "eta": self.eta, "filename": self.filename,
            "error": self.error, "audioOnly": self.audio_only,
            "format": self.format, "quality": self.quality,
        }

class DownloadManager(QObject):
    progress_updated = pyqtSignal()
    download_completed = pyqtSignal(str)

    ALLOWED_VIDEO_FMT = {'mp4', 'mkv', 'webm'}
    ALLOWED_AUDIO_FMT = {'mp3', 'm4a', 'opus', 'flac', 'wav'}
    ALLOWED_QUALITY = {'best', '2160', '1440', '1080', '720', '480'}

    def __init__(self, config, history):
        super().__init__()
        self.config = config
        self.history = history
        self.downloads = {}
        self._next_id = 0
        self._lock = threading.Lock()
        self.total_completed = 0

    def start_download(self, url, audio_only=False, fmt=None, quality=None,
                       output_dir=None, title=None, referer=None):
        with self._lock:
            active = sum(1 for d in self.downloads.values()
                         if d.status in ('downloading', 'merging', 'extracting'))
            if active >= MAX_CONCURRENT:
                return None, "Too many concurrent downloads"

        # Validate
        if not url or not url.startswith(('http://', 'https://')):
            return None, "Invalid URL"
        if len(url) > 4096:
            return None, "URL too long"

        # Sanitize format/quality
        if audio_only:
            fmt = fmt if fmt in self.ALLOWED_AUDIO_FMT else 'mp3'
        else:
            fmt = fmt if fmt in self.ALLOWED_VIDEO_FMT else 'mp4'
        quality = quality if quality in self.ALLOWED_QUALITY else 'best'

        # Output directory
        if not output_dir:
            if audio_only and self.config.get("AudioDownloadPath"):
                output_dir = self.config.get("AudioDownloadPath")
            else:
                output_dir = self.config.get("DownloadPath", str(Path.home() / "Videos"))
        Path(output_dir).mkdir(parents=True, exist_ok=True)

        with self._lock:
            self._next_id += 1
            dl_id = f"dl_{self._next_id}_{uuid.uuid4().hex[:6]}"

        dl = Download(dl_id, url, audio_only, fmt, quality, output_dir, title, referer)
        self.downloads[dl_id] = dl

        thread = threading.Thread(target=self._run_download, args=(dl,), daemon=True)
        thread.start()

        return dl_id, None

    def _run_download(self, dl):
        dl.status = "downloading"
        self.progress_updated.emit()

        ytdlp = str(YTDLP_PATH)
        ffmpeg_dir = str(FFMPEG_PATH.parent)
        is_playlist = '?list=' in dl.url and '?v=' not in dl.url and '&v=' not in dl.url

        # Output template
        if is_playlist:
            out_tpl = str(Path(dl.output_dir) / "%(playlist_title)s" / f"%(title)s.{dl.format}")
        else:
            out_tpl = str(Path(dl.output_dir) / f"%(title)s.{dl.format}")

        # Build args
        args = [ytdlp, '--newline', '--progress', '--no-colors',
                '--ffmpeg-location', ffmpeg_dir, '-o', out_tpl,
                '--progress-template', 'download:MDLP %(progress._percent_str)s %(progress._speed_str)s %(progress._eta_str)s']

        frags = self.config.get("ConcurrentFragments", 4)
        if frags and int(frags) > 0:
            args += ['--concurrent-fragments', str(int(frags))]
        if self.config.get("EmbedMetadata"):
            args.append('--embed-metadata')
        if self.config.get("EmbedThumbnail"):
            args.append('--embed-thumbnail')
        if self.config.get("EmbedChapters"):
            args.append('--embed-chapters')
        if self.config.get("EmbedSubs"):
            langs = re.sub(r'[^a-zA-Z0-9,\-]', '', self.config.get("SubLangs", "en"))
            args += ['--embed-subs', '--write-subs', '--write-auto-subs', '--sub-langs', langs]
        if self.config.get("SponsorBlock"):
            action = 'mark' if self.config.get("SponsorBlockAction") == 'mark' else 'remove'
            args += [f'--sponsorblock-{action}', 'all']
        if self.config.get("DownloadArchive"):
            args += ['--download-archive', str(ARCHIVE_PATH)]
        rate = self.config.get("RateLimit", "")
        if rate and re.match(r'^\d+[KMG]?$', rate):
            args += ['--limit-rate', rate]
        proxy = self.config.get("Proxy", "")
        if proxy and re.match(r'^(socks|https?):', proxy):
            args += ['--proxy', proxy]
        if dl.referer:
            args += ['--referer', dl.referer]
        if is_playlist:
            args.append('--yes-playlist')

        # Format selection
        if dl.audio_only:
            args += ['-f', 'bestaudio', '--extract-audio',
                     '--audio-format', dl.format, '--audio-quality', '0']
        else:
            if dl.quality == 'best':
                fmt_sel = 'bestvideo+bestaudio/best'
            else:
                fmt_sel = f'bestvideo[height<={dl.quality}]+bestaudio/best[height<={dl.quality}]/best'
            args += ['-f', fmt_sel, '--merge-output-format', dl.format]

        args.append(dl.url)

        try:
            proc = subprocess.Popen(
                args, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                text=True, bufsize=1, creationflags=subprocess.CREATE_NO_WINDOW
            )
            dl.process = proc

            for line in proc.stdout:
                line = line.strip()
                if not line:
                    continue

                # Structured progress (MDLP prefix)
                m = re.match(r'^MDLP\s+(\d+\.?\d*)%?\s+(\S+)\s+(\S+)', line)
                if m:
                    dl.progress = float(m.group(1))
                    spd, eta = m.group(2), m.group(3)
                    if spd not in ('NA', 'Unknown'):
                        dl.speed = spd
                    if eta not in ('NA', 'Unknown'):
                        dl.eta = eta
                    self.progress_updated.emit()
                    continue

                # Legacy progress
                m = re.match(r'\[download\]\s+(\d+\.?\d*)%', line)
                if m:
                    dl.progress = float(m.group(1))
                    m2 = re.search(r'at\s+(\S+)\s+ETA\s+(\S+)', line)
                    if m2:
                        dl.speed = m2.group(1)
                        dl.eta = m2.group(2)
                    self.progress_updated.emit()
                    continue

                # Status changes
                if '[Merger]' in line or 'Merging formats' in line:
                    dl.status = "merging"
                    self.progress_updated.emit()
                elif '[ExtractAudio]' in line or '[extract]' in line:
                    dl.status = "extracting"
                    self.progress_updated.emit()
                elif 'already been downloaded' in line:
                    dl.progress = 100
                    dl.status = "complete"
                    self.progress_updated.emit()

                # Filename detection
                m = re.search(r'\[Merger\] Merging formats into "(.+)"', line)
                if m:
                    dl.filename = m.group(1)
                else:
                    m = re.search(r'\[download\] Destination: (.+)', line)
                    if m:
                        dl.filename = m.group(1)

                # Title detection
                m = re.search(r'\[download\] Downloading video (?:\d+ of \d+|\d+)', line)

            proc.wait()
            stderr = proc.stderr.read()

            if dl.status != "complete":
                if proc.returncode == 0 or dl.progress >= 99:
                    dl.status = "complete"
                    dl.progress = 100
                else:
                    dl.status = "failed"
                    # Extract last meaningful error line
                    err_lines = [l.strip() for l in stderr.split('\n') if l.strip() and 'ERROR' in l.upper()]
                    dl.error = err_lines[-1] if err_lines else stderr.strip()[-200:] if stderr.strip() else "Unknown error"

        except FileNotFoundError:
            dl.status = "failed"
            dl.error = "yt-dlp not found. Run setup first."
        except Exception as e:
            dl.status = "failed"
            dl.error = str(e)[:200]

        if dl.status == "complete":
            self.total_completed += 1
            duration = int(time.time() - dl.start_time)
            self.history.add({
                "id": dl.id, "url": dl.url, "title": dl.title,
                "filename": dl.filename, "format": dl.format,
                "quality": dl.quality, "audioOnly": dl.audio_only,
                "date": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
                "duration": duration,
            })

        self.progress_updated.emit()
        self.download_completed.emit(dl.id)

    def cancel(self, dl_id):
        dl = self.downloads.get(dl_id)
        if not dl:
            return False
        if dl.process and dl.process.poll() is None:
            dl.process.kill()
        dl.status = "cancelled"
        self.progress_updated.emit()
        return True

    def active_count(self):
        return sum(1 for d in self.downloads.values()
                   if d.status in ('downloading', 'merging', 'extracting'))

    def cleanup_old(self):
        cutoff = time.time() - 300  # 5 min
        to_remove = [k for k, d in self.downloads.items()
                     if d.status in ('complete', 'failed', 'cancelled') and d.start_time < cutoff]
        for k in to_remove:
            del self.downloads[k]

# ══════════════════════════════════════════════════════════════
# HTTP SERVER (Flask in background thread)
# ══════════════════════════════════════════════════════════════
def create_api(config, dl_manager, history):
    api = Flask(__name__)
    api.logger.disabled = True
    import logging
    logging.getLogger('werkzeug').disabled = True

    token = config.get("ServerToken")

    def check_auth():
        return request.headers.get("X-Auth-Token") == token

    def cors_response(data, status=200):
        resp = jsonify(data)
        resp.status_code = status
        origin = request.headers.get("Origin", "")
        if re.match(r'^(chrome-extension|moz-extension)://', origin):
            resp.headers["Access-Control-Allow-Origin"] = origin
        else:
            resp.headers["Access-Control-Allow-Origin"] = "null"
        resp.headers["Access-Control-Allow-Methods"] = "GET,POST,PUT,DELETE,OPTIONS"
        resp.headers["Access-Control-Allow-Headers"] = "Content-Type,X-Auth-Token,X-MDL-Client"
        return resp

    @api.before_request
    def handle_preflight():
        if request.method == 'OPTIONS':
            return cors_response({"ok": True})

    @api.route('/health')
    def health():
        resp = {
            "status": "ok", "version": APP_VERSION,
            "port": config.get("ServerPort", SERVER_PORT),
            "downloads": dl_manager.active_count(),
            "token_required": True,
        }
        if request.headers.get("X-MDL-Client") == "MediaDL":
            resp["token"] = token
        return cors_response(resp)

    @api.route('/download', methods=['POST'])
    def download():
        if not check_auth():
            return cors_response({"error": "Unauthorized"}, 401)
        body = request.get_json(silent=True)
        if not body or not body.get('url'):
            return cors_response({"error": "Missing url"}, 400)
        url = str(body['url'])
        if not url.startswith(('http://', 'https://')) or len(url) > 4096:
            return cors_response({"error": "Invalid URL"}, 400)

        dl_id, err = dl_manager.start_download(
            url=url,
            audio_only=body.get('audioOnly', False),
            fmt=body.get('format'),
            quality=body.get('quality', 'best'),
            output_dir=body.get('outputDir'),
            title=body.get('title'),
            referer=body.get('referer'),
        )
        if err:
            return cors_response({"error": err}, 429 if "concurrent" in err.lower() else 400)
        return cors_response({"id": dl_id, "status": "downloading"})

    @api.route('/status/<dl_id>')
    def status(dl_id):
        if not check_auth():
            return cors_response({"error": "Unauthorized"}, 401)
        dl = dl_manager.downloads.get(dl_id)
        if not dl:
            return cors_response({"error": "Not found"}, 404)
        return cors_response(dl.to_dict())

    @api.route('/queue')
    def queue():
        if not check_auth():
            return cors_response({"error": "Unauthorized"}, 401)
        items = [d.to_dict() for d in dl_manager.downloads.values()]
        return cors_response({"downloads": items, "count": len(items)})

    @api.route('/history')
    def hist():
        if not check_auth():
            return cors_response({"error": "Unauthorized"}, 401)
        h = history.load()
        limit = request.args.get('limit', type=int)
        if limit and len(h) > limit:
            h = h[-limit:]
        return cors_response({"history": h, "count": len(h)})

    @api.route('/config', methods=['GET'])
    def get_config():
        if not check_auth():
            return cors_response({"error": "Unauthorized"}, 401)
        c = config.data
        c['videoFormats'] = ['mp4', 'mkv', 'webm']
        c['audioFormats'] = ['mp3', 'm4a', 'opus', 'flac', 'wav']
        c['qualities'] = ['best', '2160', '1440', '1080', '720', '480']
        return cors_response(c)

    @api.route('/cancel/<dl_id>', methods=['DELETE'])
    def cancel(dl_id):
        if not check_auth():
            return cors_response({"error": "Unauthorized"}, 401)
        if dl_manager.cancel(dl_id):
            return cors_response({"id": dl_id, "cancelled": True})
        return cors_response({"error": "Not found"}, 404)

    @api.route('/shutdown')
    def shutdown():
        if not check_auth():
            return cors_response({"error": "Unauthorized"}, 401)
        func = request.environ.get('werkzeug.server.shutdown')
        if func:
            func()
        return cors_response({"status": "shutting_down"})

    return api

# ══════════════════════════════════════════════════════════════
# FIRST-RUN SETUP
# ══════════════════════════════════════════════════════════════
class SetupWorker(QThread):
    log = pyqtSignal(str)
    progress = pyqtSignal(int)
    finished_ok = pyqtSignal()
    finished_err = pyqtSignal(str)

    def run(self):
        try:
            INSTALL_DIR.mkdir(parents=True, exist_ok=True)
            dl_path = Path(DEFAULT_CONFIG["DownloadPath"])
            dl_path.mkdir(parents=True, exist_ok=True)

            # yt-dlp
            if not YTDLP_PATH.exists():
                self.log.emit("Downloading yt-dlp...")
                self.progress.emit(10)
                r = http_requests.get(YTDLP_URL, stream=True, timeout=60)
                r.raise_for_status()
                with open(YTDLP_PATH, 'wb') as f:
                    for chunk in r.iter_content(8192):
                        f.write(chunk)
                self.log.emit("  Done")
            else:
                self.log.emit("yt-dlp already installed")
            self.progress.emit(30)

            # ffmpeg
            if not FFMPEG_PATH.exists():
                self.log.emit("Downloading ffmpeg (this may take a moment)...")
                self.progress.emit(35)
                import zipfile, io
                r = http_requests.get(FFMPEG_URL, stream=True, timeout=120)
                r.raise_for_status()
                data = io.BytesIO()
                for chunk in r.iter_content(65536):
                    data.write(chunk)
                data.seek(0)
                with zipfile.ZipFile(data) as zf:
                    for entry in zf.namelist():
                        if entry.endswith('ffmpeg.exe'):
                            with zf.open(entry) as src, open(FFMPEG_PATH, 'wb') as dst:
                                shutil.copyfileobj(src, dst)
                            break
                self.log.emit("  Done")
            else:
                self.log.emit("ffmpeg already installed")
            self.progress.emit(60)

            # Icon
            if not ICON_PATH.exists():
                self.log.emit("Downloading icon...")
                try:
                    r = http_requests.get(ICON_URL, timeout=10)
                    r.raise_for_status()
                    with open(ICON_PATH, 'wb') as f:
                        f.write(r.content)
                except Exception:
                    pass
            self.progress.emit(70)

            # Desktop shortcut
            self.log.emit("Creating desktop shortcut...")
            self._create_shortcut()
            self.progress.emit(80)

            # Startup task
            self.log.emit("Registering startup task...")
            self._register_startup()
            self.progress.emit(85)

            # Protocol handlers
            self.log.emit("Registering protocol handlers...")
            self._register_protocols()
            self.progress.emit(90)

            # Add/Remove Programs
            self.log.emit("Registering in Apps & Features...")
            self._register_uninstall()
            self.progress.emit(95)

            # Auto-update yt-dlp
            if DEFAULT_CONFIG.get("AutoUpdateYtDlp", True):
                self.log.emit("Updating yt-dlp...")
                try:
                    subprocess.Popen([str(YTDLP_PATH), '-U'],
                                     creationflags=subprocess.CREATE_NO_WINDOW)
                except Exception:
                    pass

            self.progress.emit(100)
            self.log.emit("\nSetup complete!")
            self.finished_ok.emit()

        except Exception as e:
            self.finished_err.emit(str(e))

    def _create_shortcut(self):
        try:
            import winreg
            # Use PowerShell to create .lnk — most reliable cross-version method
            exe = self._get_exe_path()
            desktop = Path.home() / "Desktop"
            lnk = desktop / "Astra Downloader.lnk"
            ico = str(ICON_PATH) if ICON_PATH.exists() else ""
            ps_cmd = (
                f'$ws = New-Object -ComObject WScript.Shell; '
                f'$sc = $ws.CreateShortcut("{lnk}"); '
                f'$sc.TargetPath = "{exe}"; '
                f'$sc.WorkingDirectory = "{INSTALL_DIR}"; '
                + (f'$sc.IconLocation = "{ico}"; ' if ico else '')
                + f'$sc.Description = "Astra Deck Download Server"; '
                f'$sc.Save()'
            )
            subprocess.run(['powershell', '-NoProfile', '-Command', ps_cmd],
                           capture_output=True, creationflags=subprocess.CREATE_NO_WINDOW)
        except Exception:
            pass

    def _register_startup(self):
        try:
            exe = self._get_exe_path()
            subprocess.run([
                'schtasks', '/Create', '/TN', 'AstraDownloader',
                '/TR', f'"{exe}" -Background',
                '/SC', 'ONLOGON', '/RL', 'LIMITED', '/F'
            ], capture_output=True, creationflags=subprocess.CREATE_NO_WINDOW)
        except Exception:
            pass

    def _register_protocols(self):
        try:
            import winreg
            exe = self._get_exe_path()
            for proto in ('ytdl', 'mediadl'):
                key = winreg.CreateKeyEx(winreg.HKEY_CURRENT_USER, f'Software\\Classes\\{proto}', 0, winreg.KEY_WRITE)
                winreg.SetValueEx(key, '', 0, winreg.REG_SZ, f'URL:{proto} Protocol')
                winreg.SetValueEx(key, 'URL Protocol', 0, winreg.REG_SZ, '')
                winreg.CloseKey(key)
                cmd_key = winreg.CreateKeyEx(winreg.HKEY_CURRENT_USER, f'Software\\Classes\\{proto}\\shell\\open\\command', 0, winreg.KEY_WRITE)
                winreg.SetValueEx(cmd_key, '', 0, winreg.REG_SZ, f'"{exe}" "%1"')
                winreg.CloseKey(cmd_key)
        except Exception:
            pass

    def _register_uninstall(self):
        try:
            import winreg
            exe = self._get_exe_path()
            key = winreg.CreateKeyEx(winreg.HKEY_CURRENT_USER, 'Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\AstraDownloader', 0, winreg.KEY_WRITE)
            winreg.SetValueEx(key, 'DisplayName', 0, winreg.REG_SZ, APP_NAME)
            winreg.SetValueEx(key, 'DisplayVersion', 0, winreg.REG_SZ, APP_VERSION)
            winreg.SetValueEx(key, 'Publisher', 0, winreg.REG_SZ, 'SysAdminDoc')
            winreg.SetValueEx(key, 'InstallLocation', 0, winreg.REG_SZ, str(INSTALL_DIR))
            if ICON_PATH.exists():
                winreg.SetValueEx(key, 'DisplayIcon', 0, winreg.REG_SZ, f'{ICON_PATH},0')
            # Uninstall = re-run with --uninstall flag
            winreg.SetValueEx(key, 'UninstallString', 0, winreg.REG_SZ, f'"{exe}" --uninstall')
            winreg.SetValueEx(key, 'NoModify', 0, winreg.REG_DWORD, 1)
            winreg.SetValueEx(key, 'NoRepair', 0, winreg.REG_DWORD, 1)
            winreg.CloseKey(key)
        except Exception:
            pass

    def _get_exe_path(self):
        exe = sys.executable
        # If running as .py, point to the py file instead
        if exe.lower().endswith(('python.exe', 'pythonw.exe')):
            exe = os.path.abspath(__file__)
        return exe

# ══════════════════════════════════════════════════════════════
# UNINSTALL
# ══════════════════════════════════════════════════════════════
def run_uninstall():
    app = QApplication(sys.argv)
    result = QMessageBox.question(
        None, "Uninstall Astra Downloader",
        "Remove Astra Downloader and all server components?\n\n"
        "Your downloaded videos will NOT be deleted.",
        QMessageBox.StandardButton.Yes | QMessageBox.StandardButton.No
    )
    if result != QMessageBox.StandardButton.Yes:
        sys.exit(0)

    # Kill processes
    if sys.platform == 'win32':
        subprocess.run(['taskkill', '/F', '/IM', 'AstraDownloader.exe'], capture_output=True)
        subprocess.run(['taskkill', '/F', '/IM', 'yt-dlp.exe'], capture_output=True)
        subprocess.run(['taskkill', '/F', '/IM', 'ffmpeg.exe'], capture_output=True)

    # Remove scheduled task
    subprocess.run(['schtasks', '/Delete', '/TN', 'AstraDownloader', '/F'], capture_output=True)

    # Remove registry entries
    try:
        import winreg
        for path in [
            'Software\\Classes\\ytdl',
            'Software\\Classes\\mediadl',
            'Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\AstraDownloader',
        ]:
            try:
                winreg.DeleteKey(winreg.HKEY_CURRENT_USER, path + '\\shell\\open\\command')
            except Exception:
                pass
            try:
                winreg.DeleteKey(winreg.HKEY_CURRENT_USER, path + '\\shell\\open')
            except Exception:
                pass
            try:
                winreg.DeleteKey(winreg.HKEY_CURRENT_USER, path + '\\shell')
            except Exception:
                pass
            try:
                winreg.DeleteKey(winreg.HKEY_CURRENT_USER, path)
            except Exception:
                pass
    except Exception:
        pass

    # Remove desktop shortcut
    lnk = Path.home() / "Desktop" / "Astra Downloader.lnk"
    if lnk.exists():
        lnk.unlink()

    # Remove install directory
    if INSTALL_DIR.exists():
        shutil.rmtree(INSTALL_DIR, ignore_errors=True)

    QMessageBox.information(None, "Uninstall Complete",
                            "Astra Downloader has been uninstalled.\nYour downloaded videos were not removed.")
    sys.exit(0)

# ══════════════════════════════════════════════════════════════
# GUI WIDGETS
# ══════════════════════════════════════════════════════════════
def make_card():
    f = QFrame()
    f.setProperty("class", "card")
    f.setStyleSheet("QFrame[class='card'] { padding: 16px; }")
    return f

def make_stat(label_text, value_text="0"):
    f = QFrame()
    f.setProperty("class", "stat")
    layout = QVBoxLayout(f)
    layout.setContentsMargins(16, 12, 16, 12)
    lbl = QLabel(label_text)
    lbl.setAlignment(Qt.AlignmentFlag.AlignCenter)
    lbl.setStyleSheet("color: #525a65; font-size: 10px; font-weight: bold;")
    val = QLabel(value_text)
    val.setAlignment(Qt.AlignmentFlag.AlignCenter)
    val.setStyleSheet("font-size: 24px; font-weight: bold;")
    val.setObjectName(f"stat_{label_text.lower()}")
    layout.addWidget(lbl)
    layout.addWidget(val)
    return f, val

# ══════════════════════════════════════════════════════════════
# MAIN WINDOW
# ══════════════════════════════════════════════════════════════
class MainWindow(QMainWindow):
    def __init__(self, config, dl_manager, history, start_minimized=False):
        super().__init__()
        self.config = config
        self.dl_manager = dl_manager
        self.history_mgr = history
        self._force_exit = False

        self.setWindowTitle(APP_NAME)
        self.setMinimumSize(640, 480)
        self.resize(780, 560)

        # Icon
        if ICON_PATH.exists():
            self.setWindowIcon(QIcon(str(ICON_PATH)))

        # Central widget
        central = QWidget()
        self.setCentralWidget(central)
        main_layout = QHBoxLayout(central)
        main_layout.setContentsMargins(0, 0, 0, 0)
        main_layout.setSpacing(0)

        # Sidebar
        sidebar = QFrame()
        sidebar.setProperty("class", "sidebar")
        sidebar.setFixedWidth(180)
        sidebar_layout = QVBoxLayout(sidebar)
        sidebar_layout.setContentsMargins(0, 0, 0, 0)

        # Brand
        brand = QWidget()
        brand_layout = QVBoxLayout(brand)
        brand_layout.setContentsMargins(16, 20, 16, 24)
        title_lbl = QLabel(APP_NAME)
        title_lbl.setStyleSheet("font-size: 16px; font-weight: bold;")
        ver_lbl = QLabel(f"v{APP_VERSION}")
        ver_lbl.setStyleSheet("color: #525a65; font-size: 10px;")
        brand_layout.addWidget(title_lbl)
        brand_layout.addWidget(ver_lbl)
        sidebar_layout.addWidget(brand)

        # Nav buttons
        self.nav_buttons = []
        for name in ["Dashboard", "Downloads", "History", "Settings"]:
            btn = QPushButton(name)
            btn.setProperty("class", "nav")
            btn.setCursor(Qt.CursorShape.PointingHandCursor)
            btn.clicked.connect(lambda checked, n=name: self._nav_click(n))
            sidebar_layout.addWidget(btn)
            self.nav_buttons.append(btn)

        sidebar_layout.addStretch()

        # Status dot
        status_row = QHBoxLayout()
        status_row.setContentsMargins(16, 0, 16, 16)
        self.status_dot = QLabel("\u2022")
        self.status_dot.setStyleSheet("color: #525a65; font-size: 16px;")
        self.status_label = QLabel("Stopped")
        self.status_label.setStyleSheet("color: #525a65; font-size: 11px;")
        status_row.addWidget(self.status_dot)
        status_row.addWidget(self.status_label)
        status_row.addStretch()
        sidebar_layout.addLayout(status_row)

        main_layout.addWidget(sidebar)

        # Tab stack
        self.tabs = QTabWidget()
        self.tabs.tabBar().hide()
        main_layout.addWidget(self.tabs)

        self._build_dashboard()
        self._build_downloads()
        self._build_history()
        self._build_settings()

        self._nav_click("Dashboard")

        # System tray
        self.tray = QSystemTrayIcon(self)
        if ICON_PATH.exists():
            self.tray.setIcon(QIcon(str(ICON_PATH)))
        else:
            self.tray.setIcon(self.style().standardIcon(self.style().StandardPixmap.SP_ComputerIcon))
        tray_menu = QMenu()
        show_action = tray_menu.addAction("Show Astra Downloader")
        show_action.triggered.connect(self._show_from_tray)
        self.tray_startstop = tray_menu.addAction("Stop Server")
        self.tray_startstop.triggered.connect(self._toggle_server)
        tray_menu.addSeparator()
        exit_action = tray_menu.addAction("Exit")
        exit_action.triggered.connect(self._force_close)
        self.tray.setContextMenu(tray_menu)
        self.tray.activated.connect(self._tray_activated)
        self.tray.setToolTip(f"{APP_NAME} - Running")
        self.tray.show()

        # Timer
        self.update_timer = QTimer(self)
        self.update_timer.timeout.connect(self._update_ui)
        self.update_timer.start(500)

        # Cleanup timer (every 60s)
        self.cleanup_timer = QTimer(self)
        self.cleanup_timer.timeout.connect(dl_manager.cleanup_old)
        self.cleanup_timer.start(60000)

        # Connect signals
        dl_manager.progress_updated.connect(self._update_ui)

        # Server state
        self.server_running = False
        self.server_thread = None
        self.server_start_time = None

        if start_minimized:
            QTimer.singleShot(100, self._minimize_to_tray)

    def _build_dashboard(self):
        page = QWidget()
        layout = QVBoxLayout(page)
        layout.setContentsMargins(24, 20, 24, 20)

        layout.addWidget(QLabel("Dashboard", objectName="heading"))
        layout.itemAt(0).widget().setStyleSheet("font-size: 22px; font-weight: bold; margin-bottom: 16px;")

        # Server control
        ctrl = make_card()
        ctrl_layout = QHBoxLayout(ctrl)
        left = QVBoxLayout()
        self.dash_status = QLabel("Server Stopped")
        self.dash_status.setStyleSheet("font-size: 16px; font-weight: 600;")
        self.dash_endpoint = QLabel(f"http://127.0.0.1:{self.config.get('ServerPort', SERVER_PORT)}")
        self.dash_endpoint.setStyleSheet("color: #525a65; font-size: 11px;")
        left.addWidget(self.dash_status)
        left.addWidget(self.dash_endpoint)
        ctrl_layout.addLayout(left)
        ctrl_layout.addStretch()
        self.btn_startstop = QPushButton("Start Server")
        self.btn_startstop.setProperty("class", "primary")
        self.btn_startstop.clicked.connect(self._toggle_server)
        ctrl_layout.addWidget(self.btn_startstop)
        btn_folder = QPushButton("Open Folder")
        btn_folder.clicked.connect(self._open_folder)
        ctrl_layout.addWidget(btn_folder)
        layout.addWidget(ctrl)

        # Stats — keep refs to frames (else Python GC deletes the underlying Qt objects)
        stats_layout = QHBoxLayout()
        self._stat_frame_active, self.stat_active = make_stat("Active", "0")
        self.stat_active.setStyleSheet("font-size: 24px; font-weight: bold; color: #22c55e;")
        self._stat_frame_completed, self.stat_completed = make_stat("Completed", "0")
        self._stat_frame_uptime, self.stat_uptime = make_stat("Uptime", "--")
        self._stat_frame_port, self.stat_port = make_stat("Port", str(self.config.get("ServerPort", SERVER_PORT)))
        for frame in (self._stat_frame_active, self._stat_frame_completed,
                      self._stat_frame_uptime, self._stat_frame_port):
            stats_layout.addWidget(frame)
        layout.addLayout(stats_layout)

        # Log
        log_label = QLabel("Server Log")
        log_label.setStyleSheet("color: #525a65; font-size: 12px; font-weight: bold; margin-top: 8px;")
        layout.addWidget(log_label)
        self.log_text = QTextEdit()
        self.log_text.setReadOnly(True)
        self.log_text.setMaximumHeight(180)
        self.log_text.setPlainText("Ready.")
        layout.addWidget(self.log_text)

        layout.addStretch()
        self.tabs.addTab(page, "Dashboard")

    def _build_downloads(self):
        page = QWidget()
        self.downloads_layout = QVBoxLayout(page)
        self.downloads_layout.setContentsMargins(24, 20, 24, 20)
        self.downloads_layout.addWidget(QLabel("Active Downloads", styleSheet="font-size: 22px; font-weight: bold; margin-bottom: 12px;"))
        self.no_downloads_label = QLabel("No active downloads.")
        self.no_downloads_label.setStyleSheet("color: #525a65; font-size: 13px;")
        self.downloads_layout.addWidget(self.no_downloads_label)
        self.downloads_layout.addStretch()
        self.tabs.addTab(page, "Downloads")

    def _build_history(self):
        page = QWidget()
        self.history_layout = QVBoxLayout(page)
        self.history_layout.setContentsMargins(24, 20, 24, 20)
        header = QHBoxLayout()
        header.addWidget(QLabel("Download History", styleSheet="font-size: 22px; font-weight: bold;"))
        header.addStretch()
        btn_clear = QPushButton("Clear History")
        btn_clear.clicked.connect(self._clear_history)
        header.addWidget(btn_clear)
        self.history_layout.addLayout(header)
        self.history_container = QVBoxLayout()
        self.history_layout.addLayout(self.history_container)
        self.history_layout.addStretch()
        self.tabs.addTab(page, "History")

    def _build_settings(self):
        page = QWidget()
        scroll = QScrollArea()
        scroll.setWidgetResizable(True)
        scroll.setWidget(page)
        layout = QVBoxLayout(page)
        layout.setContentsMargins(24, 20, 24, 20)

        layout.addWidget(QLabel("Settings", styleSheet="font-size: 22px; font-weight: bold; margin-bottom: 16px;"))

        # Paths
        layout.addWidget(QLabel("PATHS", styleSheet="color: #525a65; font-size: 10px; font-weight: bold;"))
        paths_card = make_card()
        paths_l = QVBoxLayout(paths_card)
        paths_l.addWidget(QLabel("Video Download Folder", styleSheet="color: #8b949e; font-size: 11px;"))
        row = QHBoxLayout()
        self.cfg_dl_path = QLineEdit(self.config.get("DownloadPath", ""))
        row.addWidget(self.cfg_dl_path)
        btn = QPushButton("...")
        btn.setFixedWidth(36)
        btn.clicked.connect(lambda: self._browse(self.cfg_dl_path))
        row.addWidget(btn)
        paths_l.addLayout(row)
        paths_l.addWidget(QLabel("Audio Download Folder (blank = same as video)", styleSheet="color: #8b949e; font-size: 11px;"))
        row2 = QHBoxLayout()
        self.cfg_audio_path = QLineEdit(self.config.get("AudioDownloadPath", ""))
        row2.addWidget(self.cfg_audio_path)
        btn2 = QPushButton("...")
        btn2.setFixedWidth(36)
        btn2.clicked.connect(lambda: self._browse(self.cfg_audio_path))
        row2.addWidget(btn2)
        paths_l.addLayout(row2)
        layout.addWidget(paths_card)

        # Post-processing
        layout.addWidget(QLabel("POST-PROCESSING", styleSheet="color: #525a65; font-size: 10px; font-weight: bold;"))
        pp_card = make_card()
        pp_l = QVBoxLayout(pp_card)
        self.cfg_metadata = QCheckBox("Embed metadata (title, artist, date)")
        self.cfg_metadata.setChecked(self.config.get("EmbedMetadata", True))
        self.cfg_thumbnail = QCheckBox("Embed thumbnail as cover art")
        self.cfg_thumbnail.setChecked(self.config.get("EmbedThumbnail", True))
        self.cfg_chapters = QCheckBox("Embed chapter markers")
        self.cfg_chapters.setChecked(self.config.get("EmbedChapters", True))
        self.cfg_subs = QCheckBox("Embed subtitles")
        self.cfg_subs.setChecked(self.config.get("EmbedSubs", False))
        sub_row = QHBoxLayout()
        sub_row.addSpacing(20)
        sub_row.addWidget(QLabel("Languages:", styleSheet="color: #525a65; font-size: 11px;"))
        self.cfg_sublangs = QLineEdit(self.config.get("SubLangs", "en"))
        self.cfg_sublangs.setFixedWidth(120)
        sub_row.addWidget(self.cfg_sublangs)
        sub_row.addStretch()
        self.cfg_sponsorblock = QCheckBox("SponsorBlock (remove sponsored segments)")
        self.cfg_sponsorblock.setChecked(self.config.get("SponsorBlock", False))
        for w in [self.cfg_metadata, self.cfg_thumbnail, self.cfg_chapters, self.cfg_subs]:
            pp_l.addWidget(w)
        pp_l.addLayout(sub_row)
        pp_l.addWidget(self.cfg_sponsorblock)
        layout.addWidget(pp_card)

        # Performance
        layout.addWidget(QLabel("PERFORMANCE", styleSheet="color: #525a65; font-size: 10px; font-weight: bold;"))
        perf_card = make_card()
        perf_l = QVBoxLayout(perf_card)
        frag_row = QHBoxLayout()
        frag_row.addWidget(QLabel("Concurrent fragments:", styleSheet="color: #8b949e; font-size: 12px;"))
        self.cfg_fragments = QLineEdit(str(self.config.get("ConcurrentFragments", 4)))
        self.cfg_fragments.setFixedWidth(50)
        frag_row.addWidget(self.cfg_fragments)
        frag_row.addStretch()
        perf_l.addLayout(frag_row)
        rate_row = QHBoxLayout()
        rate_row.addWidget(QLabel("Rate limit (e.g. 500K, 2M):", styleSheet="color: #8b949e; font-size: 12px;"))
        self.cfg_ratelimit = QLineEdit(self.config.get("RateLimit", ""))
        self.cfg_ratelimit.setFixedWidth(80)
        rate_row.addWidget(self.cfg_ratelimit)
        rate_row.addStretch()
        perf_l.addLayout(rate_row)
        proxy_row = QHBoxLayout()
        proxy_row.addWidget(QLabel("Proxy:", styleSheet="color: #8b949e; font-size: 12px;"))
        self.cfg_proxy = QLineEdit(self.config.get("Proxy", ""))
        self.cfg_proxy.setFixedWidth(200)
        proxy_row.addWidget(self.cfg_proxy)
        proxy_row.addStretch()
        perf_l.addLayout(proxy_row)
        layout.addWidget(perf_card)

        # Behavior
        layout.addWidget(QLabel("BEHAVIOR", styleSheet="color: #525a65; font-size: 10px; font-weight: bold;"))
        beh_card = make_card()
        beh_l = QVBoxLayout(beh_card)
        self.cfg_autoupdate = QCheckBox("Auto-update yt-dlp on server start")
        self.cfg_autoupdate.setChecked(self.config.get("AutoUpdateYtDlp", True))
        self.cfg_archive = QCheckBox("Skip already-downloaded videos")
        self.cfg_archive.setChecked(self.config.get("DownloadArchive", True))
        self.cfg_closetotray = QCheckBox("Close to system tray instead of quitting")
        self.cfg_closetotray.setChecked(self.config.get("CloseToTray", True))
        self.cfg_startmin = QCheckBox("Start minimized to tray")
        self.cfg_startmin.setChecked(self.config.get("StartMinimized", False))
        for w in [self.cfg_autoupdate, self.cfg_archive, self.cfg_closetotray, self.cfg_startmin]:
            beh_l.addWidget(w)
        layout.addWidget(beh_card)

        btn_save = QPushButton("Save Settings")
        btn_save.setProperty("class", "primary")
        btn_save.clicked.connect(self._save_settings)
        self.btn_save = btn_save
        layout.addWidget(btn_save)
        layout.addStretch()

        self.tabs.addTab(scroll, "Settings")

    # ── Navigation ──
    def _nav_click(self, name):
        idx = ["Dashboard", "Downloads", "History", "Settings"].index(name)
        self.tabs.setCurrentIndex(idx)
        for i, btn in enumerate(self.nav_buttons):
            btn.setProperty("active", "true" if i == idx else "false")
            btn.style().unpolish(btn)
            btn.style().polish(btn)
        if name == "History":
            self._refresh_history()

    # ── Server ──
    def _toggle_server(self):
        if self.server_running:
            self._stop_server()
        else:
            self._start_server()

    def _start_server(self):
        if self.server_running:
            return
        if not YTDLP_PATH.exists():
            self._append_log("ERROR: yt-dlp not found. Running setup...")
            self._run_setup()
            return

        port = self.config.get("ServerPort", SERVER_PORT)
        api = create_api(self.config, self.dl_manager, self.history_mgr)

        def run():
            try:
                api.run(host='127.0.0.1', port=port, threaded=True, use_reloader=False)
            except Exception as e:
                self._append_log(f"Server error: {e}")

        self.server_thread = threading.Thread(target=run, daemon=True)
        self.server_thread.start()
        self.server_running = True
        self.server_start_time = time.time()
        self._append_log(f"Server started on port {port}")
        self._update_server_ui()

        # Auto-update yt-dlp
        if self.config.get("AutoUpdateYtDlp") and YTDLP_PATH.exists():
            threading.Thread(target=lambda: subprocess.run(
                [str(YTDLP_PATH), '-U'], capture_output=True,
                creationflags=subprocess.CREATE_NO_WINDOW
            ), daemon=True).start()

    def _stop_server(self):
        self.server_running = False
        self.server_start_time = None
        # Flask doesn't have a clean shutdown from outside — just let the daemon thread die
        self._append_log("Server stopped")
        self._update_server_ui()

    def _update_server_ui(self):
        if self.server_running:
            self.status_dot.setStyleSheet("color: #22c55e; font-size: 16px;")
            self.status_label.setText("Running")
            self.status_label.setStyleSheet("color: #22c55e; font-size: 11px;")
            self.dash_status.setText("Server Running")
            self.btn_startstop.setText("Stop Server")
            self.btn_startstop.setProperty("class", "danger")
            self.tray_startstop.setText("Stop Server")
            self.tray.setToolTip(f"{APP_NAME} - Running")
        else:
            self.status_dot.setStyleSheet("color: #525a65; font-size: 16px;")
            self.status_label.setText("Stopped")
            self.status_label.setStyleSheet("color: #525a65; font-size: 11px;")
            self.dash_status.setText("Server Stopped")
            self.btn_startstop.setText("Start Server")
            self.btn_startstop.setProperty("class", "primary")
            self.tray_startstop.setText("Start Server")
            self.tray.setToolTip(f"{APP_NAME} - Stopped")
        self.btn_startstop.style().unpolish(self.btn_startstop)
        self.btn_startstop.style().polish(self.btn_startstop)

    def _update_ui(self):
        # Stats
        self.stat_active.setText(str(self.dl_manager.active_count()))
        self.stat_completed.setText(str(self.dl_manager.total_completed))
        if self.server_start_time:
            elapsed = time.time() - self.server_start_time
            if elapsed >= 3600:
                self.stat_uptime.setText(f"{elapsed/3600:.0f}h")
            elif elapsed >= 60:
                self.stat_uptime.setText(f"{elapsed/60:.0f}m")
            else:
                self.stat_uptime.setText(f"{elapsed:.0f}s")
        else:
            self.stat_uptime.setText("--")

        # Downloads tab
        active = [d for d in self.dl_manager.downloads.values()
                  if d.status not in ('complete', 'failed', 'cancelled')]
        # Clear old widgets (skip the title label)
        while self.downloads_layout.count() > 1:
            item = self.downloads_layout.takeAt(1)
            if item.widget():
                item.widget().deleteLater()

        if not active:
            lbl = QLabel("No active downloads.")
            lbl.setStyleSheet("color: #525a65; font-size: 13px;")
            self.downloads_layout.addWidget(lbl)
        else:
            for dl in active:
                card = QFrame()
                card.setProperty("class", "card")
                card_l = QVBoxLayout(card)
                card_l.setContentsMargins(14, 10, 14, 10)
                title = QLabel(dl.title or "Downloading...")
                title.setStyleSheet("font-size: 13px; font-weight: 600;")
                title.setWordWrap(False)
                card_l.addWidget(title)
                bar = QProgressBar()
                bar.setRange(0, 100)
                bar.setValue(int(min(max(dl.progress, 0), 100)))
                bar.setTextVisible(False)
                bar.setFixedHeight(6)
                card_l.addWidget(bar)
                meta_parts = [f"{dl.progress:.1f}%"]
                if dl.speed:
                    meta_parts.append(dl.speed)
                if dl.eta:
                    meta_parts.append(f"ETA {dl.eta}")
                meta_parts.append(dl.status)
                meta = QLabel("  |  ".join(meta_parts))
                meta.setStyleSheet("color: #8b949e; font-size: 10px;")
                card_l.addWidget(meta)
                self.downloads_layout.addWidget(card)
        self.downloads_layout.addStretch()

    def _refresh_history(self):
        # Clear
        while self.history_container.count():
            item = self.history_container.takeAt(0)
            if item.widget():
                item.widget().deleteLater()

        data = self.history_mgr.load()
        if not data:
            lbl = QLabel("No downloads yet.")
            lbl.setStyleSheet("color: #525a65; font-size: 13px;")
            self.history_container.addWidget(lbl)
            return

        for h in reversed(data[-50:]):
            card = QFrame()
            card.setProperty("class", "card")
            card_l = QVBoxLayout(card)
            card_l.setContentsMargins(12, 8, 12, 8)
            title = QLabel(h.get("title", "(untitled)"))
            title.setStyleSheet("font-size: 12px; font-weight: 600;")
            card_l.addWidget(title)
            parts = [p for p in [h.get("date"), h.get("format"), h.get("quality"),
                                 f"{h.get('duration', 0)}s"] if p]
            meta = QLabel("  |  ".join(parts))
            meta.setStyleSheet("color: #525a65; font-size: 10px;")
            card_l.addWidget(meta)
            self.history_container.addWidget(card)

    def _clear_history(self):
        self.history_mgr.clear()
        self._refresh_history()

    def _save_settings(self):
        self.config.set("DownloadPath", self.cfg_dl_path.text().strip())
        self.config.set("AudioDownloadPath", self.cfg_audio_path.text().strip())
        self.config.set("EmbedMetadata", self.cfg_metadata.isChecked())
        self.config.set("EmbedThumbnail", self.cfg_thumbnail.isChecked())
        self.config.set("EmbedChapters", self.cfg_chapters.isChecked())
        self.config.set("EmbedSubs", self.cfg_subs.isChecked())
        self.config.set("SubLangs", self.cfg_sublangs.text().strip())
        self.config.set("SponsorBlock", self.cfg_sponsorblock.isChecked())
        try:
            v = int(self.cfg_fragments.text())
            if 1 <= v <= 32:
                self.config.set("ConcurrentFragments", v)
        except ValueError:
            pass
        self.config.set("RateLimit", self.cfg_ratelimit.text().strip())
        self.config.set("Proxy", self.cfg_proxy.text().strip())
        self.config.set("AutoUpdateYtDlp", self.cfg_autoupdate.isChecked())
        self.config.set("DownloadArchive", self.cfg_archive.isChecked())
        self.config.set("CloseToTray", self.cfg_closetotray.isChecked())
        self.config.set("StartMinimized", self.cfg_startmin.isChecked())
        self.config.save()
        self.btn_save.setText("Saved!")
        QTimer.singleShot(1500, lambda: self.btn_save.setText("Save Settings"))

    def _browse(self, line_edit):
        path = QFileDialog.getExistingDirectory(self, "Select Folder", line_edit.text())
        if path:
            line_edit.setText(path)

    def _open_folder(self):
        p = self.config.get("DownloadPath", "")
        if p and Path(p).exists():
            os.startfile(p)
        else:
            os.startfile(str(INSTALL_DIR))

    def _append_log(self, msg):
        ts = datetime.now().strftime("%H:%M:%S")
        self.log_text.append(f"{ts} {msg}")

    # ── Tray ──
    def _tray_activated(self, reason):
        if reason == QSystemTrayIcon.ActivationReason.DoubleClick:
            self._show_from_tray()

    def _show_from_tray(self):
        self.show()
        self.setWindowState(self.windowState() & ~Qt.WindowState.WindowMinimized)
        self.activateWindow()

    def _minimize_to_tray(self):
        self.hide()

    def _force_close(self):
        self._force_exit = True
        self.close()

    def closeEvent(self, event):
        if not self._force_exit and self.config.get("CloseToTray", True):
            event.ignore()
            self.hide()
        else:
            self.tray.hide()
            self.update_timer.stop()
            self.cleanup_timer.stop()
            event.accept()

    # ── First-run setup ──
    def _run_setup(self):
        self._append_log("Running first-time setup...")
        self.setup_worker = SetupWorker()
        self.setup_worker.log.connect(self._append_log)
        self.setup_worker.progress.connect(lambda v: None)
        self.setup_worker.finished_ok.connect(self._setup_done)
        self.setup_worker.finished_err.connect(lambda e: self._append_log(f"Setup error: {e}"))
        self.setup_worker.start()

    def _setup_done(self):
        self._append_log("Setup complete. Starting server...")
        self._start_server()

# ══════════════════════════════════════════════════════════════
# SINGLE INSTANCE GUARD
# ══════════════════════════════════════════════════════════════
def check_single_instance():
    """Use a socket lock on port 9752 to prevent multiple instances."""
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        s.bind(('127.0.0.1', 9752))
        s.listen(1)
        return s  # Keep alive
    except OSError:
        return None

# ══════════════════════════════════════════════════════════════
# MAIN
# ══════════════════════════════════════════════════════════════
def main():
    # Handle --uninstall flag
    if '--uninstall' in sys.argv:
        run_uninstall()
        return

    start_minimized = '-Background' in sys.argv or '--background' in sys.argv

    # Single instance check
    lock = check_single_instance()
    if lock is None:
        # Already running
        sys.exit(0)

    app = QApplication(sys.argv)
    app.setApplicationName(APP_NAME)
    app.setApplicationVersion(APP_VERSION)
    app.setStyleSheet(STYLESHEET)
    if ICON_PATH.exists():
        app.setWindowIcon(QIcon(str(ICON_PATH)))

    # Init
    config = Config()
    history = History()
    dl_manager = DownloadManager(config, history)

    start_min = start_minimized or config.get("StartMinimized", False)
    window = MainWindow(config, dl_manager, history, start_minimized=start_min)

    # First-run check
    needs_setup = not YTDLP_PATH.exists() or not FFMPEG_PATH.exists()
    if needs_setup:
        window.show()
        window._run_setup()
    else:
        if not start_min:
            window.show()
        window._start_server()

    sys.exit(app.exec())

if __name__ == '__main__':
    main()
