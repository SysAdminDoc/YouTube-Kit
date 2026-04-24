#!/usr/bin/env python3
"""
Astra Downloader — Desktop GUI + HTTP API server for Astra Deck.
Manages yt-dlp downloads with a PyQt6 GUI, system tray, and REST API on port 9751.

First run auto-downloads yt-dlp + ffmpeg. No separate installer needed.
"""

import sys, os, json, time, re, uuid, subprocess, threading, socket, shutil, traceback, hmac
from pathlib import Path
from datetime import datetime
from urllib.parse import urlparse

# ── Bootstrap: auto-install dependencies ──
def _bootstrap():
    """Install required packages before importing them."""
    if getattr(sys, "frozen", False):
        return
    if os.environ.get("ASTRA_DOWNLOADER_NO_BOOTSTRAP"):
        return
    required = {'PyQt6': 'PyQt6', 'flask': 'flask', 'requests': 'requests', 'waitress': 'waitress'}
    missing = []
    for mod, pkg in required.items():
        try:
            __import__(mod)
        except ImportError:
            missing.append(pkg)
    if not missing:
        return
    # v3.15.0: Keep the last failure's stderr so we can surface a useful error
    # if every strategy fails. Previously all three silently fell through and
    # the user saw a cryptic ImportError at line 43+ instead of the pip output.
    last_error = None
    for strategy in [
        [sys.executable, '-m', 'pip', 'install', '--quiet'],
        [sys.executable, '-m', 'pip', 'install', '--quiet', '--user'],
        [sys.executable, '-m', 'pip', 'install', '--quiet', '--break-system-packages'],
    ]:
        try:
            subprocess.check_call(strategy + missing, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            return
        except FileNotFoundError as e:
            last_error = f"python/pip not on PATH ({e.filename or 'unknown'})"
            break  # No pip at all — retrying won't help
        except subprocess.CalledProcessError as e:
            last_error = f"pip install exited with code {e.returncode}"
            continue
        except Exception as e:
            last_error = f"{type(e).__name__}: {e}"
            continue
    # All strategies failed — emit a helpful message so the ImportError that
    # will follow has context.
    sys.stderr.write(
        f"[Astra Downloader] Failed to auto-install dependencies "
        f"({', '.join(missing)}): {last_error}\n"
        f"Install manually with: pip install {' '.join(missing)}\n"
    )

_bootstrap()

from PyQt6.QtWidgets import (
    QApplication, QMainWindow, QWidget, QVBoxLayout, QHBoxLayout,
    QLabel, QPushButton, QTabWidget, QScrollArea, QFrame, QCheckBox, QLineEdit,
    QFileDialog, QSystemTrayIcon, QMenu, QMessageBox, QProgressBar, QTextEdit,
    QSpinBox, QComboBox, QGraphicsOpacityEffect, QStyle
)
from PyQt6.QtCore import Qt, QTimer, pyqtSignal, QObject, QThread, QSize, QPropertyAnimation, QEasingCurve
from PyQt6.QtGui import QIcon, QFont, QTextCursor
from flask import Flask, request, jsonify
import requests as http_requests

# ══════════════════════════════════════════════════════════════
# CONSTANTS
# ══════════════════════════════════════════════════════════════
APP_NAME = "Astra Downloader"
APP_VERSION = "1.2.0"
SERVICE_ID = "astra-downloader"
# SERVICE_API_VERSION is the wire-schema version. 1.2.0 adds /health fields
# (ytDlpVersion, ffmpegVersion, rateLimit) but older clients ignore unknown
# keys, so the major version stays at 2 (additive, backward-compatible).
SERVICE_API_VERSION = 2
SERVER_PORT = 9751
# Ordered fallback ports the server tries when the configured port is unavailable.
# The browser extension probes the same list to discover the running port.
PORT_FALLBACKS = [9751, 9761, 9771, 9781, 9791, 9851]
MAX_CONCURRENT = 3
INSTALL_DIR = Path(os.environ.get('LOCALAPPDATA', Path.home() / 'AppData' / 'Local')) / 'AstraDownloader'
CONFIG_PATH = INSTALL_DIR / 'config.json'
HISTORY_PATH = INSTALL_DIR / 'history.json'
ARCHIVE_PATH = INSTALL_DIR / 'archive.txt'
LOG_PATH = INSTALL_DIR / 'server.log'
CRASH_LOG_PATH = INSTALL_DIR / 'crash.log'
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
    # v1.2.0: throttled auto-update (was fire-and-forget on every launch).
    # ISO-ish timestamp of the last successful yt-dlp -U attempt. Empty = never.
    "LastYtDlpUpdateCheck": "",
    # v1.2.0: optional explicit allowlist of extra output roots. The server
    # always allows DownloadPath + AudioDownloadPath; this adds more without
    # forcing users to widen DownloadPath itself.
    "ExtraOutputRoots": [],
    # v1.2.0: last ffmpeg freshness stamp (used for the monthly update nag).
    "LastFfmpegCheck": "",
}

# v1.2.0: rate-limit for /download. Token-bucket sliding window — tuned so a
# legitimate user spamming the download button hits MAX_CONCURRENT long before
# this kicks in, but a compromised extension can't queue 10k /download calls
# in a burst.
RATE_LIMIT_DOWNLOAD_MAX = 30
RATE_LIMIT_DOWNLOAD_WINDOW_SECONDS = 60
# v1.2.0: CORS preflight cache horizon — keeps browsers from re-asking OPTIONS
# for every POST /download during a multi-video session.
CORS_MAX_AGE_SECONDS = 600
# v1.2.0: upstream publishes per-release checksum sidecars. We verify when
# reachable and log + continue when the sidecar is missing so a sidecar
# outage doesn't block legitimate installs.
YTDLP_SHA256_URL = "https://github.com/yt-dlp/yt-dlp/releases/latest/download/SHA2-256SUMS"
YTDLP_SHA256_ASSET = "yt-dlp.exe"
FFMPEG_SHA256_URL = FFMPEG_URL + ".sha256"
# v1.2.0: stamp we write under HKCU so shortcut/protocol/task/uninstall
# registration is skipped on subsequent launches at the same version.
INTEGRATIONS_STAMP_KEY = r'Software\Classes\AstraDownloader'
INTEGRATIONS_STAMP_VALUE = 'IntegrationsVersion'

CREATE_NO_WINDOW = getattr(subprocess, "CREATE_NO_WINDOW", 0)
CREATE_NEW_PROCESS_GROUP = getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0)
DOWNLOAD_ACTIVE_STATES = {'queued', 'downloading', 'merging', 'extracting'}
DOWNLOAD_TERMINAL_STATES = {'complete', 'failed', 'cancelled'}
CONTROL_CHARS_RE = re.compile(r'[\x00-\x1f\x7f]')
MAX_TEXT_FIELD = 500
MAX_PATH_FIELD = 2048
LOG_MAX_BYTES = 1024 * 1024
_LOG_LOCK = threading.Lock()


def write_persistent_log(message, path=LOG_PATH):
    """Best-effort disk log for diagnostics when the windowed exe has no console."""
    try:
        path = Path(path)
        path.parent.mkdir(parents=True, exist_ok=True)
        with _LOG_LOCK:
            if path.exists() and path.stat().st_size > LOG_MAX_BYTES:
                backup = path.with_suffix(path.suffix + ".1")
                try:
                    if backup.exists():
                        backup.unlink()
                    path.replace(backup)
                except Exception:
                    pass
            ts = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
            with open(path, 'a', encoding='utf-8') as f:
                f.write(f"{ts} {message}\n")
    except Exception:
        pass


def log_crash(context="Unhandled exception"):
    try:
        write_persistent_log(f"{context}\n{traceback.format_exc()}", CRASH_LOG_PATH)
    except Exception:
        pass


def _timestamp_suffix():
    return datetime.now().strftime("%Y%m%d%H%M%S")


def atomic_write_json(path, data):
    """Write JSON atomically so crashes do not leave truncated config/history files."""
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(f".{path.name}.{uuid.uuid4().hex}.tmp")
    try:
        with open(tmp, 'w', encoding='utf-8') as f:
            json.dump(data, f, indent=2)
            f.write("\n")
            f.flush()
            os.fsync(f.fileno())
        os.replace(tmp, path)
    finally:
        try:
            if tmp.exists():
                tmp.unlink()
        except Exception:
            pass


def download_file_atomic(url, path, timeout=60, chunk_size=65536, progress_cb=None):
    """Download with atomic replacement.

    progress_cb(downloaded_bytes, total_bytes_or_None) is fired roughly each
    chunk when supplied. It MUST be cheap and thread-safe — the caller is
    responsible for marshaling back to Qt.
    """
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(f".{path.name}.{uuid.uuid4().hex}.download")
    try:
        with http_requests.get(url, stream=True, timeout=timeout) as r:
            r.raise_for_status()
            total = None
            try:
                total = int(r.headers.get('content-length', '') or 0) or None
            except (TypeError, ValueError):
                total = None
            downloaded = 0
            last_cb = 0.0
            with open(tmp, 'wb') as f:
                for chunk in r.iter_content(chunk_size):
                    if chunk:
                        f.write(chunk)
                        if progress_cb is not None:
                            downloaded += len(chunk)
                            now = time.monotonic()
                            # Throttle to ~10 Hz so very fast downloads don't
                            # flood the Qt event loop with progress signals.
                            if now - last_cb > 0.1:
                                last_cb = now
                                try:
                                    progress_cb(downloaded, total)
                                except Exception:
                                    # reason: progress reporting must never
                                    # abort a successful download.
                                    pass
                f.flush()
                os.fsync(f.fileno())
            if progress_cb is not None:
                try:
                    progress_cb(downloaded, total)
                except Exception:
                    pass
        if tmp.stat().st_size <= 0:
            raise RuntimeError("Downloaded file was empty")
        os.replace(tmp, path)
    finally:
        try:
            if tmp.exists():
                tmp.unlink()
        except Exception:
            pass


# ── v1.2.0 helpers: SHA-256 verification, path confinement, rate limiting ──
def _compute_sha256(path, chunk_size=65536):
    """Return lowercase hex SHA-256 of a file's contents, or None on error."""
    import hashlib
    try:
        h = hashlib.sha256()
        with open(path, 'rb') as f:
            for chunk in iter(lambda: f.read(chunk_size), b''):
                h.update(chunk)
        return h.hexdigest().lower()
    except Exception as e:
        write_persistent_log(f"SHA-256 compute failed for {path}: {e}")
        return None


def _parse_sha256_sums(body, target_asset=None):
    """Parse a SHA256SUMS-style document.

    Supports two formats:
      <hex>  <filename>
      <hex> *<filename>
      <hex>
    Returns the hex digest for target_asset, or the single digest if the file
    contains exactly one entry with no filename.
    """
    if not body:
        return None
    body = body.strip()
    if not body:
        return None
    # Single-line "<hex>" sidecar (some ffmpeg-builds assets ship this form).
    lines = [ln.strip() for ln in body.splitlines() if ln.strip()]
    if len(lines) == 1 and re.fullmatch(r'[0-9A-Fa-f]{64}', lines[0]):
        return lines[0].lower()
    for line in lines:
        # Tolerate "<hex>  <name>" and "<hex> *<name>" variants.
        m = re.match(r'^([0-9A-Fa-f]{64})\s+\*?(.+)$', line)
        if not m:
            continue
        digest, name = m.group(1).lower(), m.group(2).strip()
        if target_asset and Path(name).name != target_asset:
            continue
        return digest
    return None


def fetch_expected_sha256(sidecar_url, target_asset=None, timeout=15):
    """Best-effort checksum fetch. Returns None when the sidecar is missing,
    malformed, or the request fails — caller decides whether to hard-fail."""
    try:
        with http_requests.get(sidecar_url, timeout=timeout) as r:
            if r.status_code != 200:
                return None
            return _parse_sha256_sums(r.text, target_asset=target_asset)
    except Exception:
        return None


def verify_file_sha256(path, expected_hex):
    """Raise RuntimeError on mismatch, return True on success, False when
    expected_hex is missing (soft skip — upstream sidecar not reachable)."""
    if not expected_hex:
        return False
    expected = expected_hex.strip().lower()
    if not re.fullmatch(r'[0-9a-f]{64}', expected):
        return False
    actual = _compute_sha256(path)
    if actual is None:
        raise RuntimeError(f"Could not hash {path} for integrity verification")
    if actual != expected:
        raise RuntimeError(
            f"SHA-256 mismatch for {Path(path).name}: "
            f"expected {expected[:12]}…, got {actual[:12]}…. "
            "Delete the downloaded file and retry setup."
        )
    return True


def cleanup_stale_cookie_jars(older_than_seconds=300):
    """Sweep orphan .cookies.{id}.txt files left behind by a crash.

    Cookie jars normally clean up in the download's finally block. When the
    server is killed mid-download (power loss, taskkill /F), session cookies
    leak into INSTALL_DIR. This sweep runs on server start.
    """
    try:
        now = time.time()
        for entry in INSTALL_DIR.glob('.cookies.*.txt'):
            try:
                if now - entry.stat().st_mtime > older_than_seconds:
                    entry.unlink()
            except Exception:
                # reason: filesystem churn; we'll try again next start.
                pass
    except Exception:
        # reason: install dir unreadable — nothing actionable at this level.
        pass


def allowed_output_roots(config):
    """Return the resolved allowlist of directories downloads may land in.

    Always includes DownloadPath + AudioDownloadPath (when set), plus any
    explicitly configured ExtraOutputRoots. Non-existent paths are still
    resolved so confinement checks work for subfolders that don't exist yet.
    """
    raw_roots = []
    for key in ('DownloadPath', 'AudioDownloadPath'):
        val = config.get(key, "") if config else ""
        if val:
            raw_roots.append(val)
    extra = (config.get("ExtraOutputRoots", []) if config else []) or []
    if isinstance(extra, list):
        raw_roots.extend(str(x) for x in extra if isinstance(x, str) and x)
    resolved = []
    seen = set()
    for raw in raw_roots:
        try:
            p = Path(raw).expanduser()
            if not p.is_absolute():
                continue
            # Path.resolve(strict=False) follows symlinks on Windows too, and
            # normalizes ".." / drive-case so confinement cannot be evaded.
            resolved_path = p.resolve()
        except Exception:
            continue
        if resolved_path in seen:
            continue
        seen.add(resolved_path)
        resolved.append(resolved_path)
    return resolved


def is_path_under(child, root):
    """True when `child` is equal to or inside `root`, resolved."""
    try:
        child.resolve().relative_to(root)
        return True
    except (ValueError, OSError):
        return False


class RateLimiter:
    """Sliding-window rate limiter.

    Local-only service, so per-IP bucketing is unnecessary — every client is
    127.0.0.1. Bucket key exists so we can separate /download (strict) from
    eventual other endpoints without reshuffling state.
    """

    def __init__(self, max_events, window_seconds):
        from collections import deque as _deque
        self._deque = _deque
        self.max_events = max_events
        self.window_seconds = window_seconds
        self._lock = threading.Lock()
        self._buckets = {}

    def allow(self, key='default'):
        """Returns (allowed: bool, retry_after_seconds: float)."""
        now = time.monotonic()
        cutoff = now - self.window_seconds
        with self._lock:
            q = self._buckets.get(key)
            if q is None:
                q = self._deque()
                self._buckets[key] = q
            while q and q[0] < cutoff:
                q.popleft()
            if len(q) >= self.max_events:
                retry = max(0.0, self.window_seconds - (now - q[0]))
                return False, retry
            q.append(now)
            return True, 0.0


# ── v1.2.0: cached version strings for /health ──
_version_cache = {
    'ytdlp': {'value': None, 'checked_at': 0.0},
    'ffmpeg': {'value': None, 'checked_at': 0.0},
}
_VERSION_CACHE_TTL_SECONDS = 3600


def _run_captured(args, timeout=5):
    """Capture subprocess output with CREATE_NO_WINDOW. Returns '' on failure."""
    try:
        result = subprocess.run(
            args,
            capture_output=True,
            text=True,
            timeout=timeout,
            creationflags=CREATE_NO_WINDOW,
        )
        return (result.stdout or '') + (result.stderr or '')
    except Exception:
        return ''


def get_ytdlp_version(force=False):
    if not YTDLP_PATH.exists():
        return None
    cache = _version_cache['ytdlp']
    now = time.time()
    if not force and cache['value'] and (now - cache['checked_at']) < _VERSION_CACHE_TTL_SECONDS:
        return cache['value']
    output = _run_captured([str(YTDLP_PATH), '--version'])
    version = output.strip().splitlines()[0] if output.strip() else ''
    if re.match(r'^\d{4}\.\d{1,2}\.\d{1,2}', version):
        cache['value'] = version
    elif version:
        cache['value'] = version[:32]
    cache['checked_at'] = now
    return cache['value']


def get_ffmpeg_version(force=False):
    if not FFMPEG_PATH.exists():
        return None
    cache = _version_cache['ffmpeg']
    now = time.time()
    if not force and cache['value'] and (now - cache['checked_at']) < _VERSION_CACHE_TTL_SECONDS:
        return cache['value']
    output = _run_captured([str(FFMPEG_PATH), '-version'])
    first = output.splitlines()[0] if output else ''
    m = re.search(r'ffmpeg version (\S+)', first)
    cache['value'] = (m.group(1) if m else '')[:64] or None
    cache['checked_at'] = now
    return cache['value']


# ── v1.2.0: throttled yt-dlp auto-update helpers ──
_YTDLP_UPDATE_INTERVAL_HOURS = 24


def _parse_iso_like(value):
    if not value:
        return None
    try:
        return datetime.strptime(value, "%Y-%m-%d %H:%M:%S")
    except (TypeError, ValueError):
        return None


def should_check_ytdlp_update(config, interval_hours=_YTDLP_UPDATE_INTERVAL_HOURS):
    last = config.get("LastYtDlpUpdateCheck", "") if config else ""
    parsed = _parse_iso_like(last)
    if parsed is None:
        return True
    return (datetime.now() - parsed).total_seconds() > interval_hours * 3600


def mark_ytdlp_update_check(config):
    if not config:
        return
    try:
        config.set("LastYtDlpUpdateCheck", datetime.now().strftime("%Y-%m-%d %H:%M:%S"))
        config.save()
    except Exception as e:
        write_persistent_log(f"Could not persist yt-dlp update timestamp: {e}")


def maybe_auto_update_ytdlp(config):
    """Background-run yt-dlp -U when more than a day has passed.

    Fire-and-forget in a daemon thread so startup isn't blocked. The exit code
    is logged (previously swallowed entirely).
    """
    if not YTDLP_PATH.exists():
        return
    if not config.get("AutoUpdateYtDlp", True):
        return
    if not should_check_ytdlp_update(config):
        return

    def run():
        try:
            result = subprocess.run(
                [str(YTDLP_PATH), '-U'],
                capture_output=True,
                text=True,
                timeout=120,
                creationflags=CREATE_NO_WINDOW,
            )
            if result.returncode == 0:
                mark_ytdlp_update_check(config)
                # Invalidate version cache so /health reports the new version.
                _version_cache['ytdlp']['checked_at'] = 0.0
                write_persistent_log(
                    f"yt-dlp auto-update ok: {(result.stdout or '').strip()[:200]}"
                )
            else:
                write_persistent_log(
                    f"yt-dlp auto-update failed (exit {result.returncode}): "
                    f"{(result.stderr or result.stdout or '').strip()[:200]}"
                )
        except Exception as e:
            write_persistent_log(f"yt-dlp auto-update error: {e}")

    threading.Thread(target=run, daemon=True).start()


# ── v1.2.0: integrations stamp (idempotent shortcut/protocol/task registration) ──
def _get_integrations_stamp():
    if sys.platform != 'win32':
        return None
    try:
        import winreg
        key = winreg.OpenKey(winreg.HKEY_CURRENT_USER, INTEGRATIONS_STAMP_KEY)
        try:
            value, _ = winreg.QueryValueEx(key, INTEGRATIONS_STAMP_VALUE)
            return value
        finally:
            winreg.CloseKey(key)
    except FileNotFoundError:
        return None
    except Exception:
        return None


def _set_integrations_stamp():
    if sys.platform != 'win32':
        return
    try:
        import winreg
        key = winreg.CreateKeyEx(winreg.HKEY_CURRENT_USER, INTEGRATIONS_STAMP_KEY, 0, winreg.KEY_WRITE)
        try:
            winreg.SetValueEx(key, INTEGRATIONS_STAMP_VALUE, 0, winreg.REG_SZ, APP_VERSION)
        finally:
            winreg.CloseKey(key)
    except Exception as e:
        write_persistent_log(f"Could not persist integrations stamp: {e}")


def backup_corrupt_file(path):
    path = Path(path)
    if not path.exists():
        return
    backup = path.with_name(f"{path.name}.corrupt-{_timestamp_suffix()}")
    try:
        path.replace(backup)
    except Exception:
        pass


def load_json_file(path, fallback):
    path = Path(path)
    if not path.exists():
        return fallback
    try:
        with open(path, 'r', encoding='utf-8') as f:
            return json.load(f)
    except Exception:
        backup_corrupt_file(path)
        return fallback


def clean_text(value, default="", max_len=MAX_TEXT_FIELD):
    if value is None:
        return default
    value = CONTROL_CHARS_RE.sub("", str(value)).strip()
    if len(value) > max_len:
        return value[:max_len].rstrip()
    return value


def clean_path_text(value):
    return clean_text(value, "", MAX_PATH_FIELD)


def normalize_long_text(value, default="", max_len=MAX_TEXT_FIELD):
    if value is None:
        return default, False
    value = CONTROL_CHARS_RE.sub("", str(value)).strip()
    if len(value) > max_len:
        return value, True
    return value, False


def ps_single_quote(value):
    return "'" + str(value).replace("'", "''") + "'"


def coerce_bool(value, default=False):
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        lowered = value.strip().lower()
        if lowered in ("1", "true", "yes", "on"):
            return True
        if lowered in ("0", "false", "no", "off"):
            return False
    return default


def normalize_rate_limit(value):
    value = clean_text(value, "", 32).upper()
    return value if re.fullmatch(r'\d+[KMG]?', value) else ""


def normalize_proxy(value):
    value = clean_text(value, "", 512)
    if not value:
        return ""
    parsed = urlparse(value)
    if parsed.scheme.lower() in {"http", "https", "socks", "socks4", "socks4a", "socks5", "socks5h"} and parsed.netloc:
        return value
    return ""


def normalize_sublangs(value):
    value = clean_text(value, "en", 80)
    value = re.sub(r'[^a-zA-Z0-9,\-]', '', value)
    return value or "en"


def normalize_url(value):
    url, too_long = normalize_long_text(value, "", 4096)
    if too_long:
        return None, "URL is too long to download safely."
    if not url or any(ch.isspace() for ch in url):
        return None, "Enter a valid http or https URL."
    parsed = urlparse(url)
    if parsed.scheme.lower() not in {"http", "https"} or not parsed.netloc:
        return None, "Enter a valid http or https URL."
    return url, None


def normalize_output_dir(value, default_dir=None, allowed_roots=None):
    """Validate and normalize an output directory.

    When `allowed_roots` is supplied (v1.2.0 path confinement), the resolved
    path must be inside one of the listed roots. This matters for the HTTP
    `/download` endpoint where a client-supplied `outputDir` would otherwise
    land anywhere the server user can write. The check runs BEFORE `mkdir` so
    a rejected request doesn't leave a directory behind.
    """
    raw, too_long = normalize_long_text(value, "", MAX_PATH_FIELD)
    if too_long:
        return None, "Output folder path is too long."
    if not raw:
        raw, too_long = normalize_long_text(default_dir, "", MAX_PATH_FIELD)
        if too_long:
            return None, "Default output folder path is too long."
    if not raw:
        raw = str(Path.home() / "Videos")
    try:
        path = Path(raw).expanduser()
        if not path.is_absolute():
            return None, "Choose an absolute output folder."
        if allowed_roots:
            try:
                # Path.resolve(strict=False) normalizes ".." and drive casing
                # even for paths that don't exist yet, so users can target a
                # not-yet-created subfolder like DownloadPath/channel-name.
                resolved = path.resolve()
            except Exception:
                return None, "Output folder path could not be resolved."
            inside = False
            for root in allowed_roots:
                try:
                    resolved.relative_to(root)
                    inside = True
                    break
                except ValueError:
                    continue
            if not inside:
                return None, "Output folder is outside the configured download locations."
        path.mkdir(parents=True, exist_ok=True)
        if not path.is_dir():
            return None, "Output path is not a folder."
        return str(path), None
    except Exception as e:
        return None, f"Cannot use output folder: {e}"


def sanitize_config(raw):
    raw = raw if isinstance(raw, dict) else {}
    data = dict(DEFAULT_CONFIG)
    for key in DEFAULT_CONFIG:
        if key in raw:
            data[key] = raw[key]

    data["DownloadPath"] = clean_path_text(data.get("DownloadPath")) or DEFAULT_CONFIG["DownloadPath"]
    data["AudioDownloadPath"] = clean_path_text(data.get("AudioDownloadPath"))
    data["ServerPort"] = clamp_int(data.get("ServerPort"), SERVER_PORT, 1024, 65535)
    token = clean_text(data.get("ServerToken"), "", 128)
    data["ServerToken"] = token if re.fullmatch(r'[A-Za-z0-9_\-]{16,128}', token) else uuid.uuid4().hex
    for key in ("EmbedMetadata", "EmbedThumbnail", "EmbedChapters", "EmbedSubs",
                "SponsorBlock", "DownloadArchive", "AutoUpdateYtDlp",
                "StartMinimized", "CloseToTray"):
        data[key] = coerce_bool(data.get(key), DEFAULT_CONFIG[key])
    data["SubLangs"] = normalize_sublangs(data.get("SubLangs"))
    data["SponsorBlockAction"] = "mark" if data.get("SponsorBlockAction") == "mark" else "remove"
    data["ConcurrentFragments"] = clamp_int(data.get("ConcurrentFragments"), 4, 1, 32)
    data["RateLimit"] = normalize_rate_limit(data.get("RateLimit"))
    data["Proxy"] = normalize_proxy(data.get("Proxy"))
    data["LastYtDlpUpdateCheck"] = clean_text(data.get("LastYtDlpUpdateCheck"), "", 40)
    data["LastFfmpegCheck"] = clean_text(data.get("LastFfmpegCheck"), "", 40)
    extra = data.get("ExtraOutputRoots")
    if not isinstance(extra, list):
        extra = []
    clean_extra = []
    for item in extra[:16]:  # bound the list so a corrupt config can't balloon memory
        if not isinstance(item, str):
            continue
        candidate = clean_path_text(item)
        if candidate:
            clean_extra.append(candidate)
    data["ExtraOutputRoots"] = clean_extra
    return data


def _netscape_bool(value):
    return "TRUE" if value else "FALSE"


def _sanitize_cookie_field(value, max_len=4096):
    """Strip whitespace, tabs, and control chars — Netscape format is tab-separated."""
    if value is None:
        return ""
    value = CONTROL_CHARS_RE.sub("", str(value))
    # Netscape cookie format is tab-delimited; any internal tab or newline
    # corrupts the file. Spaces and semicolons are fine in values.
    value = value.replace("\t", " ").replace("\r", " ").replace("\n", " ").strip()
    if len(value) > max_len:
        value = value[:max_len]
    return value


def write_cookies_netscape(cookies, target_path):
    """
    Persist browser-supplied cookies in the Netscape cookies.txt format
    consumed by yt-dlp's --cookies flag. Returns the path on success, None if
    the input list is empty or every entry is malformed. Intentionally
    defensive: the extension's cookie bridge pushes raw objects and a single
    malformed entry should not poison the whole file.
    """
    if not isinstance(cookies, list) or not cookies:
        return None
    target_path = Path(target_path)
    target_path.parent.mkdir(parents=True, exist_ok=True)
    lines = [
        "# Netscape HTTP Cookie File",
        "# Auto-generated by Astra Downloader — do not edit",
        "",
    ]
    emitted = 0
    for entry in cookies:
        if not isinstance(entry, dict):
            continue
        name = _sanitize_cookie_field(entry.get("name"), 256)
        if not name:
            continue
        domain = _sanitize_cookie_field(entry.get("domain"), 256)
        if not domain:
            continue
        value = _sanitize_cookie_field(entry.get("value"), 4096)
        path_field = _sanitize_cookie_field(entry.get("path"), 512) or "/"
        secure = bool(entry.get("secure"))
        http_only = bool(entry.get("httpOnly"))
        # Session cookies arrive as 0 (missing expirationDate from Chrome).
        # Treat 0 as "session" per Netscape format.
        try:
            raw_expiry = entry.get("expirationDate")
            expiry = int(float(raw_expiry)) if raw_expiry not in (None, "") else 0
            if expiry < 0:
                expiry = 0
        except (TypeError, ValueError):
            expiry = 0
        include_subdomains = domain.startswith(".")
        prefix = "#HttpOnly_" if http_only else ""
        lines.append(
            f"{prefix}{domain}\t{_netscape_bool(include_subdomains)}\t{path_field}\t"
            f"{_netscape_bool(secure)}\t{expiry}\t{name}\t{value}"
        )
        emitted += 1
    if emitted == 0:
        return None
    tmp = target_path.with_name(f".{target_path.name}.{uuid.uuid4().hex}.tmp")
    try:
        with open(tmp, "w", encoding="utf-8", newline="\n") as fh:
            fh.write("\n".join(lines) + "\n")
            fh.flush()
            os.fsync(fh.fileno())
        os.replace(tmp, target_path)
        try:
            # Best-effort tighten perms so cookie jar is not world-readable.
            os.chmod(target_path, 0o600)
        except OSError:
            pass
        return str(target_path)
    except Exception as exc:
        write_persistent_log(f"Cookie jar write failed: {exc}")
        try:
            if tmp.exists():
                tmp.unlink()
        except Exception:
            pass
        return None


def sanitize_history_entries(raw):
    if not isinstance(raw, list):
        return []
    entries = []
    for item in raw[-500:]:
        if not isinstance(item, dict):
            continue
        entries.append({
            "id": clean_text(item.get("id"), "", 120),
            "url": clean_text(item.get("url"), "", 4096),
            "title": clean_text(item.get("title"), "(untitled)", 500) or "(untitled)",
            "filename": clean_path_text(item.get("filename")),
            "format": clean_text(item.get("format"), "", 16),
            "quality": clean_text(item.get("quality"), "", 16),
            "audioOnly": coerce_bool(item.get("audioOnly"), False),
            "date": clean_text(item.get("date"), "", 40),
            "duration": max(0, clamp_int(item.get("duration"), 0, 0, 60 * 60 * 24 * 30)),
        })
    return entries


def is_frozen_app():
    return bool(getattr(sys, "frozen", False))


def current_executable_path():
    if is_frozen_app():
        return Path(sys.executable).resolve()
    return Path(__file__).resolve()


def install_target_exe():
    return INSTALL_DIR / "AstraDownloader.exe"


def ensure_installed_executable():
    """Copy a downloaded one-file exe into the managed install directory."""
    current = current_executable_path()
    if not is_frozen_app():
        return current

    target = install_target_exe()
    try:
        if current == target.resolve():
            return target
    except Exception:
        pass

    try:
        INSTALL_DIR.mkdir(parents=True, exist_ok=True)
        tmp = target.with_name(f".{target.name}.{uuid.uuid4().hex}.tmp")
        shutil.copy2(current, tmp)
        os.replace(tmp, target)
        write_persistent_log(f"Installed executable updated: {target}")
        return target
    except Exception as e:
        write_persistent_log(f"Could not update installed executable from {current}: {e}")
        try:
            if 'tmp' in locals() and tmp.exists():
                tmp.unlink()
        except Exception:
            pass
        return current


def launch_command_parts(prefer_installed=True):
    if is_frozen_app():
        exe = ensure_installed_executable() if prefer_installed else current_executable_path()
        return str(exe), []
    return sys.executable, [str(Path(__file__).resolve())]


def command_line(parts):
    return subprocess.list2cmdline([str(p) for p in parts])


def register_desktop_shortcut(target, base_args):
    try:
        desktop = Path.home() / "Desktop"
        lnk = desktop / "Astra Downloader.lnk"
        ico = str(ICON_PATH) if ICON_PATH.exists() else ""
        arguments = command_line(base_args)
        workdir = str(Path(target).parent if Path(target).parent.exists() else INSTALL_DIR)
        ps_cmd = (
            f'$ws = New-Object -ComObject WScript.Shell; '
            f'$sc = $ws.CreateShortcut({ps_single_quote(lnk)}); '
            f'$sc.TargetPath = {ps_single_quote(target)}; '
            f'$sc.WorkingDirectory = {ps_single_quote(workdir)}; '
            f'$sc.Arguments = {ps_single_quote(arguments)}; '
            + (f'$sc.IconLocation = {ps_single_quote(ico)}; ' if ico else '')
            + f'$sc.Description = "Astra Deck Download Server"; '
            f'$sc.Save()'
        )
        subprocess.run(['powershell', '-NoProfile', '-Command', ps_cmd],
                       capture_output=True, creationflags=CREATE_NO_WINDOW)
    except Exception as e:
        write_persistent_log(f"Shortcut registration failed: {e}")


def register_startup_task(target, base_args):
    try:
        task_cmd = command_line([target] + list(base_args) + ['-Background'])
        subprocess.run([
            'schtasks', '/Create', '/TN', 'AstraDownloader',
            '/TR', task_cmd, '/SC', 'ONLOGON', '/RL', 'LIMITED', '/F'
        ], capture_output=True, creationflags=CREATE_NO_WINDOW)
    except Exception as e:
        write_persistent_log(f"Startup task registration failed: {e}")


def register_protocol_handlers(target, base_args):
    try:
        import winreg
        open_cmd = command_line([target] + list(base_args)) + ' "%1"'
        for proto in ('ytdl', 'mediadl'):
            key = winreg.CreateKeyEx(winreg.HKEY_CURRENT_USER, f'Software\\Classes\\{proto}', 0, winreg.KEY_WRITE)
            winreg.SetValueEx(key, '', 0, winreg.REG_SZ, f'URL:{proto} Protocol')
            winreg.SetValueEx(key, 'URL Protocol', 0, winreg.REG_SZ, '')
            winreg.CloseKey(key)
            cmd_key = winreg.CreateKeyEx(winreg.HKEY_CURRENT_USER, f'Software\\Classes\\{proto}\\shell\\open\\command', 0, winreg.KEY_WRITE)
            winreg.SetValueEx(cmd_key, '', 0, winreg.REG_SZ, open_cmd)
            winreg.CloseKey(cmd_key)
    except Exception as e:
        write_persistent_log(f"Protocol registration failed: {e}")


def register_uninstall_entry(target, base_args):
    try:
        import winreg
        uninstall_cmd = command_line([target] + list(base_args) + ['--uninstall'])
        key = winreg.CreateKeyEx(winreg.HKEY_CURRENT_USER, 'Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\AstraDownloader', 0, winreg.KEY_WRITE)
        winreg.SetValueEx(key, 'DisplayName', 0, winreg.REG_SZ, APP_NAME)
        winreg.SetValueEx(key, 'DisplayVersion', 0, winreg.REG_SZ, APP_VERSION)
        winreg.SetValueEx(key, 'Publisher', 0, winreg.REG_SZ, 'SysAdminDoc')
        winreg.SetValueEx(key, 'InstallLocation', 0, winreg.REG_SZ, str(INSTALL_DIR))
        if ICON_PATH.exists():
            winreg.SetValueEx(key, 'DisplayIcon', 0, winreg.REG_SZ, f'{ICON_PATH},0')
        winreg.SetValueEx(key, 'UninstallString', 0, winreg.REG_SZ, uninstall_cmd)
        winreg.SetValueEx(key, 'NoModify', 0, winreg.REG_DWORD, 1)
        winreg.SetValueEx(key, 'NoRepair', 0, winreg.REG_DWORD, 1)
        winreg.CloseKey(key)
    except Exception as e:
        write_persistent_log(f"Uninstall registration failed: {e}")


def ensure_system_integrations(prefer_installed=True, force=False):
    """Register shortcut / startup task / protocol handlers / uninstall entry.

    v1.2.0: idempotent — writes a version stamp to HKCU after success and
    short-circuits on subsequent launches when the stamp matches APP_VERSION.
    Previously fired a PowerShell process + 3 winreg writes + schtasks on
    every launch, even when nothing had changed.
    """
    target, base_args = launch_command_parts(prefer_installed=prefer_installed)
    if not force and _get_integrations_stamp() == APP_VERSION:
        return target, base_args
    register_desktop_shortcut(target, base_args)
    register_startup_task(target, base_args)
    register_protocol_handlers(target, base_args)
    register_uninstall_entry(target, base_args)
    _set_integrations_stamp()
    return target, base_args

# ── Dark theme stylesheet ──
STYLESHEET = """
QMainWindow, QWidget {
    background-color: #0b0f14;
    color: #edf2f7;
    font-family: "Segoe UI", "Inter", "Arial";
    font-size: 12px;
}
QLabel { color: #edf2f7; background: transparent; }
QLabel[class="title"] { font-size: 23px; font-weight: 700; color: #f8fafc; }
QLabel[class="subtitle"] { color: #9aa6b2; font-size: 12px; line-height: 18px; }
QLabel[class="muted"] { color: #7b8794; }
QLabel[class="secondary"] { color: #aab5c2; }
QLabel[class="section"] {
    color: #7b8794;
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 1.1px;
    text-transform: uppercase;
}
QLabel[class="fieldLabel"] { color: #edf2f7; font-size: 12px; font-weight: 600; }
QLabel[class="fieldHint"] { color: #7b8794; font-size: 11px; }
QLabel[class="emptyTitle"] { color: #edf2f7; font-size: 15px; font-weight: 700; }
QLabel[class="emptyBody"] { color: #8793a0; font-size: 12px; }
QLabel[class="badge"] {
    border-radius: 10px;
    padding: 3px 8px;
    font-size: 10px;
    font-weight: 700;
}
QLabel[class="badge"][tone="success"] { color: #b9f6ce; background: #0f2c1e; border: 1px solid #1d5c39; }
QLabel[class="badge"][tone="warning"] { color: #ffe4a3; background: #30250e; border: 1px solid #6c5318; }
QLabel[class="badge"][tone="danger"] { color: #ffc8c8; background: #351718; border: 1px solid #773033; }
QLabel[class="badge"][tone="info"] { color: #b9dcff; background: #10283e; border: 1px solid #24567e; }
QLabel[class="badge"][tone="neutral"] { color: #b7c1cc; background: #111923; border: 1px solid #263241; }

QPushButton {
    background-color: #141b24;
    color: #d7dee7;
    border: 1px solid #263241;
    border-radius: 7px;
    padding: 8px 14px;
    min-height: 34px;
    font-size: 12px;
    font-weight: 650;
}
QPushButton:hover { background-color: #1b2531; border-color: #344457; color: #f8fafc; }
QPushButton:pressed { background-color: #111821; border-color: #233142; }
QPushButton:focus { border-color: #3ddc84; }
QPushButton:disabled { color: #5d6875; background-color: #101720; border-color: #1c2632; }
QPushButton[class="primary"] {
    background-color: #2dd36f;
    color: #06100a;
    border: 1px solid #38e984;
    font-weight: 750;
}
QPushButton[class="primary"]:hover { background-color: #38e984; }
QPushButton[class="secondary"] {
    background-color: #111821;
    color: #c7d0da;
    border: 1px solid #2a3747;
}
QPushButton[class="danger"] {
    background-color: #2a1517;
    color: #ffd1d1;
    border: 1px solid #6e2a2e;
    font-weight: 700;
}
QPushButton[class="danger"]:hover { background-color: #3b1c1f; border-color: #a34449; }
QPushButton[class="ghost"] {
    background-color: transparent;
    border-color: transparent;
    color: #9aa6b2;
    padding-left: 10px;
    padding-right: 10px;
}
QPushButton[class="ghost"]:hover { background-color: #121923; border-color: #263241; color: #edf2f7; }
QPushButton[class="nav"] {
    background-color: transparent;
    color: #9aa6b2;
    border: 1px solid transparent;
    text-align: left;
    padding: 10px 14px;
    margin: 0 10px 4px 10px;
    font-size: 13px;
    font-weight: 650;
    border-radius: 8px;
}
QPushButton[class="nav"]:hover { background-color: #111821; color: #edf2f7; }
QPushButton[class="nav"][active="true"] {
    color: #dfffea;
    background-color: #102117;
    border-color: #214d34;
    font-weight: 750;
}

QLineEdit, QSpinBox, QComboBox {
    background-color: #111821;
    color: #edf2f7;
    border: 1px solid #263241;
    border-radius: 7px;
    padding: 7px 9px;
    min-height: 34px;
    font-size: 12px;
    selection-background-color: #2dd36f;
    selection-color: #06100a;
}
QLineEdit:focus, QSpinBox:focus, QComboBox:focus { border-color: #3ddc84; background-color: #141d28; }
QLineEdit[state="error"], QSpinBox[state="error"] { border-color: #d25b61; background-color: #1d1216; }
QLineEdit:disabled, QSpinBox:disabled, QComboBox:disabled { color: #65717f; background: #0f151d; border-color: #1d2733; }
QComboBox::drop-down { border: none; width: 24px; }
QSpinBox::up-button, QSpinBox::down-button { width: 18px; border: none; background: transparent; }

QCheckBox { color: #c7d0da; font-size: 12px; spacing: 9px; min-height: 28px; }
QCheckBox::indicator { width: 18px; height: 18px; border-radius: 5px; border: 1px solid #2c3a4a; background: #111821; }
QCheckBox::indicator:hover { border-color: #3a4c60; }
QCheckBox::indicator:checked { background: #2dd36f; border-color: #38e984; }
QCheckBox:disabled { color: #677281; }

QFrame[class="card"] {
    background-color: #121922;
    border: 1px solid #243142;
    border-radius: 8px;
}
QFrame[class="sidebar"] {
    background-color: #080c11;
    border-right: 1px solid #1e2835;
}
QFrame[class="stat"] {
    background-color: #111821;
    border: 1px solid #243142;
    border-radius: 8px;
}
QFrame[class="empty"] {
    background-color: #0e141c;
    border: 1px dashed #2a3747;
    border-radius: 8px;
}
QFrame[class="download"] {
    background-color: #121922;
    border: 1px solid #243142;
    border-radius: 8px;
}
QFrame[class="download"][state="failed"] { border-color: #6e2a2e; background-color: #171315; }
QFrame[class="download"][state="complete"] { border-color: #1d5c39; background-color: #101915; }
QFrame[class="divider"] {
    background-color: #1e2835;
    border: none;
    min-height: 1px;
    max-height: 1px;
}

QTextEdit {
    background-color: #0e141c;
    color: #9aa6b2;
    border: 1px solid #243142;
    border-radius: 8px;
    font-family: "Cascadia Code", "Consolas", monospace;
    font-size: 11px;
    padding: 10px;
}

QScrollArea { border: none; background: transparent; }
QScrollBar:vertical { background: transparent; width: 10px; border: none; margin: 2px; }
QScrollBar::handle:vertical { background: #2a3747; border-radius: 4px; min-height: 24px; }
QScrollBar::handle:vertical:hover { background: #3a4c60; }
QScrollBar::add-line:vertical, QScrollBar::sub-line:vertical { height: 0; }

QProgressBar { background: #0c1219; border: 1px solid #223042; border-radius: 5px; height: 8px; text-align: center; }
QProgressBar::chunk { background: #2dd36f; border-radius: 4px; }

QTabWidget::pane { border: none; }
QTabBar { background: transparent; }
QTabBar::tab { height: 0; width: 0; }

QMenu {
    background-color: #111821;
    color: #edf2f7;
    border: 1px solid #263241;
    border-radius: 8px;
    padding: 6px;
}
QMenu::item { padding: 7px 24px 7px 10px; border-radius: 6px; }
QMenu::item:selected { background-color: #182331; }
QToolTip {
    background-color: #111821;
    color: #edf2f7;
    border: 1px solid #2a3747;
    border-radius: 6px;
    padding: 6px 8px;
}
QMessageBox { background-color: #0b0f14; }
"""

# ══════════════════════════════════════════════════════════════
# CONFIG
# ══════════════════════════════════════════════════════════════
class Config:
    def __init__(self):
        INSTALL_DIR.mkdir(parents=True, exist_ok=True)
        self._data = sanitize_config(load_json_file(CONFIG_PATH, {}))
        self.save()

    def get(self, key, default=None):
        return self._data.get(key, default)

    def set(self, key, value):
        self._data[key] = value

    def save(self):
        try:
            self._data = sanitize_config(self._data)
            atomic_write_json(CONFIG_PATH, self._data)
            return True
        except Exception as e:
            write_persistent_log(f"Config save failed: {e}")
            return False

    @property
    def data(self):
        return dict(self._data)

# ══════════════════════════════════════════════════════════════
# HISTORY
# ══════════════════════════════════════════════════════════════
class History:
    def __init__(self):
        self._lock = threading.Lock()
        if not HISTORY_PATH.exists():
            self._write([])

    def load(self):
        with self._lock:
            return sanitize_history_entries(load_json_file(HISTORY_PATH, []))

    def add(self, entry):
        with self._lock:
            data = sanitize_history_entries(load_json_file(HISTORY_PATH, []))
            data.append(entry)
            if len(data) > 500:
                data = data[-500:]
            self._write_unlocked(data)

    def clear(self):
        with self._lock:
            self._write_unlocked([])

    def _write(self, data):
        with self._lock:
            self._write_unlocked(data)

    def _write_unlocked(self, data):
        try:
            atomic_write_json(HISTORY_PATH, sanitize_history_entries(data))
        except Exception as e:
            write_persistent_log(f"History save failed: {e}")


def is_playlist_url(url):
    try:
        parsed = urlparse(url)
        params = {}
        for part in parsed.query.split('&'):
            if '=' in part:
                key, value = part.split('=', 1)
                params.setdefault(key, []).append(value)
        has_list = bool(params.get('list', [''])[0])
        has_video = bool(params.get('v', [''])[0])
        return has_list and not has_video
    except Exception:
        return False


def terminate_process_tree(proc, timeout=3):
    if not proc or proc.poll() is not None:
        return
    try:
        proc.terminate()
        proc.wait(timeout=timeout)
        return
    except subprocess.TimeoutExpired:
        pass
    except Exception:
        pass

    if sys.platform == 'win32':
        try:
            subprocess.run(
                ['taskkill', '/PID', str(proc.pid), '/T', '/F'],
                capture_output=True,
                creationflags=CREATE_NO_WINDOW,
                timeout=5,
            )
            return
        except Exception as e:
            write_persistent_log(f"Process tree termination warning: {e}")

    try:
        proc.kill()
    except Exception:
        pass

# ══════════════════════════════════════════════════════════════
# DOWNLOAD MANAGER
# ══════════════════════════════════════════════════════════════
class Download:
    def __init__(self, dl_id, url, audio_only=False, fmt=None, quality='best',
                 output_dir=None, title=None, referer=None, cookies_file=None):
        self.id = dl_id
        self.url = url
        self.audio_only = audio_only
        self.format = fmt or ('mp3' if audio_only else 'mp4')
        self.quality = quality
        self.output_dir = output_dir
        self.title = title or "Unknown"
        self.referer = referer
        self.cookies_file = cookies_file  # optional path to a Netscape cookie jar
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
        # v1.2.0: sweep any cookie jars left by a previous crash before any
        # new download starts. Session cookies shouldn't outlive the process
        # that needed them.
        cleanup_stale_cookie_jars()

    def start_download(self, url, audio_only=False, fmt=None, quality=None,
                       output_dir=None, title=None, referer=None, cookies=None):
        url, err = normalize_url(url)
        if err:
            return None, err
        audio_only = coerce_bool(audio_only, False)

        with self._lock:
            active = sum(1 for d in self.downloads.values()
                         if d.status in DOWNLOAD_ACTIVE_STATES)
            if active >= MAX_CONCURRENT:
                return None, "Download limit reached. Wait for an active download to finish."

        # Sanitize format/quality
        if audio_only:
            fmt = fmt if fmt in self.ALLOWED_AUDIO_FMT else 'mp3'
        else:
            fmt = fmt if fmt in self.ALLOWED_VIDEO_FMT else 'mp4'
        quality = quality if quality in self.ALLOWED_QUALITY else 'best'

        # Output directory — path-confined to the server's configured roots.
        # A compromised extension or malicious content script would otherwise
        # be able to hand us any absolute path and watch us mkdir + write
        # there. See HARDENING.md Pass 6 S2 (outputDir allowlist).
        client_supplied_output = bool(output_dir)
        if not output_dir:
            if audio_only and self.config.get("AudioDownloadPath"):
                output_dir = self.config.get("AudioDownloadPath")
            else:
                output_dir = self.config.get("DownloadPath", str(Path.home() / "Videos"))
        # Only enforce confinement when the client supplied the path. The
        # fallback defaults above are always inside the allowlist by
        # construction, and enforcing for them would create a chicken-and-egg
        # when the user is first setting DownloadPath from the Settings UI.
        roots = allowed_output_roots(self.config) if client_supplied_output else None
        output_dir, err = normalize_output_dir(
            output_dir,
            self.config.get("DownloadPath", str(Path.home() / "Videos")),
            allowed_roots=roots,
        )
        if err:
            return None, err
        title = clean_text(title, None, 500) or None
        referer, _ = normalize_url(referer) if referer else (None, None)

        with self._lock:
            active = sum(1 for d in self.downloads.values()
                         if d.status in DOWNLOAD_ACTIVE_STATES)
            if active >= MAX_CONCURRENT:
                return None, "Download limit reached. Wait for an active download to finish."
            self._next_id += 1
            dl_id = f"dl_{self._next_id}_{uuid.uuid4().hex[:6]}"
            cookies_file = None
            if cookies:
                # Scope the cookie jar to this download so concurrent downloads
                # cannot stomp each other's jar. Best-effort: if the write
                # fails we still proceed without cookies rather than fail the
                # whole request.
                jar_path = INSTALL_DIR / f".cookies.{dl_id}.txt"
                cookies_file = write_cookies_netscape(cookies, jar_path)
            dl = Download(dl_id, url, audio_only, fmt, quality, output_dir, title, referer, cookies_file)
            self.downloads[dl_id] = dl

        thread = threading.Thread(target=self._run_download, args=(dl,), daemon=True)
        thread.start()

        return dl_id, None

    def _run_download(self, dl):
        dl.status = "downloading"
        self.progress_updated.emit()

        ytdlp = str(YTDLP_PATH)
        ffmpeg_dir = str(FFMPEG_PATH.parent)
        is_playlist = is_playlist_url(dl.url)

        # Output template
        if is_playlist:
            out_tpl = str(Path(dl.output_dir) / "%(playlist_title).200B" / "%(title).200B.%(ext)s")
        else:
            out_tpl = str(Path(dl.output_dir) / "%(title).200B.%(ext)s")

        # Build args. v1.2.0: emit progress as JSON alongside the legacy MDLP
        # line so we can parse robustly when yt-dlp tweaks its human-readable
        # format. We keep the legacy line as a fallback.
        args = [ytdlp, '--newline', '--progress', '--no-colors',
                '--windows-filenames', '--trim-filenames', '180',
                '--ffmpeg-location', ffmpeg_dir, '-o', out_tpl,
                '--progress-template',
                'download:MDLP %(progress._percent_str)s %(progress._speed_str)s %(progress._eta_str)s',
                '--progress-template',
                'download:MDLP_JSON %(progress)j']

        frags = clamp_int(self.config.get("ConcurrentFragments", 4), 4, 1, 32)
        args += ['--concurrent-fragments', str(frags)]
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
        rate = str(self.config.get("RateLimit", "")).strip().upper()
        if rate and re.match(r'^\d+[KMG]?$', rate):
            args += ['--limit-rate', rate]
        proxy = self.config.get("Proxy", "")
        if proxy and re.match(r'^(socks(?:4a?|5h?)?|https?)://', proxy):
            args += ['--proxy', proxy]
        if dl.referer:
            args += ['--referer', dl.referer]
        if dl.cookies_file:
            args += ['--cookies', dl.cookies_file]
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
                args, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                text=True, encoding='utf-8', errors='replace', bufsize=1,
                creationflags=CREATE_NO_WINDOW | CREATE_NEW_PROCESS_GROUP
            )
            dl.process = proc
            last_lines = []
            error_lines = []

            for line in proc.stdout:
                line = line.strip()
                if not line:
                    continue
                last_lines.append(line)
                if len(last_lines) > 30:
                    last_lines = last_lines[-30:]
                if 'ERROR' in line.upper():
                    error_lines.append(line)

                # Preferred structured progress (JSON — robust to yt-dlp
                # format changes). Falls through to the legacy MDLP regex
                # only if JSON parsing fails.
                if line.startswith('MDLP_JSON '):
                    try:
                        payload = json.loads(line[len('MDLP_JSON '):])
                        total = payload.get('total_bytes') or payload.get('total_bytes_estimate') or 0
                        downloaded_bytes = payload.get('downloaded_bytes') or 0
                        if isinstance(total, (int, float)) and total > 0:
                            dl.progress = max(0.0, min(100.0, (downloaded_bytes / total) * 100.0))
                        spd = (payload.get('_speed_str') or '').strip()
                        eta = (payload.get('_eta_str') or '').strip()
                        if spd and spd not in ('NA', 'Unknown'):
                            dl.speed = spd
                        if eta and eta not in ('NA', 'Unknown'):
                            dl.eta = eta
                        self.progress_updated.emit()
                        continue
                    except Exception:
                        # reason: yt-dlp occasionally emits a malformed JSON
                        # line on extractor exit. Fall through to MDLP.
                        pass

                # Structured progress (MDLP prefix, legacy fallback)
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

            if dl.status != "complete":
                if dl.status == "cancelled":
                    dl.error = dl.error or "Cancelled by user."
                elif proc.returncode == 0 or dl.progress >= 99:
                    dl.status = "complete"
                    dl.progress = 100
                else:
                    dl.status = "failed"
                    dl.error = error_lines[-1] if error_lines else " ".join(last_lines)[-240:] if last_lines else "Unknown error"

        except FileNotFoundError:
            if dl.status != "cancelled":
                dl.status = "failed"
                dl.error = "yt-dlp not found. Run setup first."
        except Exception as e:
            if dl.status != "cancelled":
                dl.status = "failed"
                dl.error = str(e)[:200]
                write_persistent_log(f"Download {dl.id} failed unexpectedly: {e}")
        finally:
            dl.process = None
            # Cookie jar holds session credentials — purge it as soon as the
            # download process exits so it never outlives the one request that
            # needed it.
            if dl.cookies_file:
                try:
                    Path(dl.cookies_file).unlink(missing_ok=True)
                except Exception:
                    pass
                dl.cookies_file = None

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
        with self._lock:
            dl = self.downloads.get(dl_id)
        if not dl:
            return False
        if dl.status in DOWNLOAD_TERMINAL_STATES:
            return False
        dl.status = "cancelled"
        dl.error = "Cancelled by user."
        proc = dl.process
        if proc and proc.poll() is None:
            def terminate():
                terminate_process_tree(proc)
            threading.Thread(target=terminate, daemon=True).start()
        self.progress_updated.emit()
        return True

    def active_count(self):
        with self._lock:
            return sum(1 for d in self.downloads.values()
                       if d.status in DOWNLOAD_ACTIVE_STATES)

    def snapshot(self):
        with self._lock:
            return list(self.downloads.values())

    def cleanup_old(self):
        cutoff = time.time() - 300  # 5 min
        with self._lock:
            to_remove = [k for k, d in self.downloads.items()
                         if d.status in DOWNLOAD_TERMINAL_STATES and d.start_time < cutoff]
            for k in to_remove:
                del self.downloads[k]

# ══════════════════════════════════════════════════════════════
# HTTP SERVER (Flask in background thread)
# ══════════════════════════════════════════════════════════════
class _ServerAdapter:
    """Uniform run()/stop() over waitress and werkzeug.

    Waitress is the v1.2.0 production default: proper thread pool, graceful
    close, not marked "dev only" by its upstream. Werkzeug's make_server is
    kept only as a last-resort fallback for source runs where waitress isn't
    installed (legacy dev environments / test containers).
    """

    def __init__(self, backend, server):
        self.backend = backend
        self._server = server

    def run(self):
        if self.backend == 'waitress':
            self._server.run()
        else:
            self._server.serve_forever()

    def stop(self):
        try:
            if self.backend == 'waitress':
                # TcpWSGIServer.close() asks the worker threads to drain and
                # the listener to stop accepting; run() returns shortly after.
                self._server.close()
            else:
                self._server.shutdown()
                self._server.server_close()
        except Exception:
            # reason: server teardown is best-effort from the UI thread; we
            # log the warning at the call site.
            pass


def _build_wsgi_server(chosen_port, api):
    """Build a running WSGI server on chosen_port. Prefers waitress."""
    try:
        from waitress.server import create_server as _waitress_create  # type: ignore
        # threads=8 matches the extension's expected fan-out (up to
        # MAX_CONCURRENT downloads + health + queue + status polls).
        server = _waitress_create(
            api,
            host='127.0.0.1',
            port=chosen_port,
            threads=8,
            ident='Astra Downloader',
        )
        return _ServerAdapter('waitress', server)
    except ImportError:
        # Fallback path — werkzeug's dev server.
        from werkzeug.serving import make_server
        try:
            server = make_server('127.0.0.1', chosen_port, api, threaded=True)
        except SystemExit:
            # reason: werkzeug raises SystemExit on bind failure in some
            # build configs; normalize into OSError so the caller's error
            # UI path handles it.
            raise OSError(f"Werkzeug aborted while binding port {chosen_port}")
        return _ServerAdapter('werkzeug', server)


def create_api(config, dl_manager, history):
    api = Flask(__name__)
    api.logger.disabled = True
    import logging
    logging.getLogger('werkzeug').disabled = True

    token = config.get("ServerToken")
    # v1.2.0: token-bucket rate limit on /download. Other endpoints are
    # cheap and read-only; we don't limit them (local-only service, no
    # realistic DoS vector beyond /download work queue).
    download_rate_limiter = RateLimiter(
        max_events=RATE_LIMIT_DOWNLOAD_MAX,
        window_seconds=RATE_LIMIT_DOWNLOAD_WINDOW_SECONDS,
    )

    def check_auth():
        provided = request.headers.get("X-Auth-Token", "")
        return bool(token and provided and hmac.compare_digest(str(provided), str(token)))

    def is_extension_origin(origin):
        try:
            parsed = urlparse(origin or "")
            return parsed.scheme in {"chrome-extension", "moz-extension"} and bool(parsed.netloc)
        except Exception:
            return False

    # v3.15.0: DNS-rebinding defense. A browser visiting attacker.com that
    # rebinds the host to 127.0.0.1 will send `Host: attacker.com` — legitimate
    # local clients always send `Host: 127.0.0.1:PORT` or `localhost:PORT`.
    # Werkzeug does not validate Host by default, so we have to do it ourselves.
    def is_allowed_host():
        host = (request.headers.get("Host") or "").strip().lower()
        if not host:
            return False
        # Strip the port so we compare hostnames reliably across port fallbacks.
        if host.startswith('['):  # ipv6 literal like "[::1]:9751"
            end = host.find(']')
            hostname = host[1:end] if end != -1 else host
        else:
            hostname = host.split(':', 1)[0]
        return hostname in {'127.0.0.1', 'localhost', '::1'}

    def cors_response(data, status=200, extra_headers=None):
        resp = jsonify(data)
        resp.status_code = status
        origin = request.headers.get("Origin", "")
        if is_extension_origin(origin):
            resp.headers["Access-Control-Allow-Origin"] = origin
            resp.headers["Vary"] = "Origin"
        resp.headers["Access-Control-Allow-Methods"] = "GET,POST,PUT,DELETE,OPTIONS"
        resp.headers["Access-Control-Allow-Headers"] = "Content-Type,X-Auth-Token,X-MDL-Client"
        # v1.2.0: cache preflight for 10 minutes. Multi-video downloads
        # previously re-negotiated OPTIONS on every POST /download.
        resp.headers["Access-Control-Max-Age"] = str(CORS_MAX_AGE_SECONDS)
        if extra_headers:
            for k, v in extra_headers.items():
                resp.headers[k] = v
        return resp

    @api.before_request
    def guard_request():
        # Reject DNS-rebinding probes before any route handler sees them.
        if not is_allowed_host():
            return cors_response({"error": "Invalid Host header"}, 421)
        if request.method == 'OPTIONS':
            return cors_response({"ok": True})

    @api.route('/health')
    def health():
        resp = {
            "status": "ok", "service": SERVICE_ID, "api": SERVICE_API_VERSION,
            "name": APP_NAME, "version": APP_VERSION,
            "port": clamp_int(config.get("ServerPort", SERVER_PORT), SERVER_PORT, 1024, 65535),
            "downloads": dl_manager.active_count(),
            "token_required": True,
            # v1.2.0: surface tool versions so the extension can show
            # "yt-dlp 2026.04.01" in the repair panel + warn on stale binaries.
            "ytDlpVersion": get_ytdlp_version(),
            "ffmpegVersion": get_ffmpeg_version(),
            "rateLimit": {
                "downloadMaxPerWindow": RATE_LIMIT_DOWNLOAD_MAX,
                "downloadWindowSeconds": RATE_LIMIT_DOWNLOAD_WINDOW_SECONDS,
            },
        }
        # v3.15.0: Token disclosure is now gated by the Host check at
        # `guard_request()` — DNS-rebinding attacks send `Host: attacker.com`
        # and are rejected before reaching this handler. Any request that
        # gets here proves it targeted 127.0.0.1/localhost directly, which is
        # either the extension (extension Origin) or a local-machine tool
        # (no Origin). Keeping both paths so local dev tooling (curl, the
        # downloader GUI's own self-test) can still probe the service.
        origin = request.headers.get("Origin", "")
        if request.headers.get("X-MDL-Client") == "MediaDL" and (not origin or is_extension_origin(origin)):
            resp["token"] = token
        return cors_response(resp)

    @api.route('/download', methods=['POST'])
    def download():
        if not check_auth():
            return cors_response({"error": "Astra Downloader rejected the request. Refresh the private token in Astra Deck."}, 401)
        # v1.2.0: rate limit BEFORE we do any body parsing or normalization so
        # a burst can't burn CPU on 10k rejected requests.
        allowed, retry_after = download_rate_limiter.allow('download')
        if not allowed:
            return cors_response(
                {"error": "Too many download requests in a short period. Please wait a moment."},
                429,
                extra_headers={"Retry-After": str(int(retry_after) + 1)},
            )
        body = request.get_json(silent=True)
        if not isinstance(body, dict) or not body.get('url'):
            return cors_response({"error": "Missing download URL."}, 400)
        url, url_err = normalize_url(body['url'])
        if url_err:
            return cors_response({"error": url_err}, 400)

        raw_cookies = body.get('cookies')
        cookies = raw_cookies if isinstance(raw_cookies, list) else None
        # Cap the cookie list so a hostile extension context can't cause the
        # server to write a multi-megabyte cookie jar. 200 is far higher than
        # a real YouTube session ever produces but still bounded.
        if cookies is not None and len(cookies) > 200:
            cookies = cookies[:200]
        dl_id, err = dl_manager.start_download(
            url=url,
            audio_only=body.get('audioOnly', False),
            fmt=body.get('format'),
            quality=body.get('quality', 'best'),
            output_dir=body.get('outputDir'),
            title=body.get('title'),
            referer=body.get('referer'),
            cookies=cookies,
        )
        if err:
            return cors_response({"error": err}, 429 if "limit" in err.lower() else 400)
        return cors_response({"id": dl_id, "status": "downloading"})

    @api.route('/status/<dl_id>')
    def status(dl_id):
        if not check_auth():
            return cors_response({"error": "Astra Downloader rejected the request. Refresh the private token in Astra Deck."}, 401)
        with dl_manager._lock:
            dl = dl_manager.downloads.get(dl_id)
        if not dl:
            return cors_response({"error": "Download no longer exists in the active queue."}, 404)
        return cors_response(dl.to_dict())

    @api.route('/queue')
    def queue():
        if not check_auth():
            return cors_response({"error": "Astra Downloader rejected the request. Refresh the private token in Astra Deck."}, 401)
        items = [d.to_dict() for d in dl_manager.snapshot()]
        return cors_response({"downloads": items, "count": len(items)})

    @api.route('/history')
    def hist():
        if not check_auth():
            return cors_response({"error": "Astra Downloader rejected the request. Refresh the private token in Astra Deck."}, 401)
        h = history.load()
        limit = request.args.get('limit', type=int)
        if limit is not None:
            limit = clamp_int(limit, 50, 1, 500)
        if limit and len(h) > limit:
            h = h[-limit:]
        return cors_response({"history": h, "count": len(h)})

    @api.route('/config', methods=['GET'])
    def get_config():
        if not check_auth():
            return cors_response({"error": "Astra Downloader rejected the request. Refresh the private token in Astra Deck."}, 401)
        c = config.data
        c['videoFormats'] = ['mp4', 'mkv', 'webm']
        c['audioFormats'] = ['mp3', 'm4a', 'opus', 'flac', 'wav']
        c['qualities'] = ['best', '2160', '1440', '1080', '720', '480']
        return cors_response(c)

    @api.route('/cancel/<dl_id>', methods=['DELETE'])
    def cancel(dl_id):
        if not check_auth():
            return cors_response({"error": "Astra Downloader rejected the request. Refresh the private token in Astra Deck."}, 401)
        with dl_manager._lock:
            exists = dl_id in dl_manager.downloads
        if dl_manager.cancel(dl_id):
            return cors_response({"id": dl_id, "cancelled": True})
        if exists:
            return cors_response({"error": "Download is already finished and cannot be cancelled."}, 409)
        return cors_response({"error": "Download no longer exists in the active queue."}, 404)

    @api.route('/shutdown')
    def shutdown():
        if not check_auth():
            return cors_response({"error": "Astra Downloader rejected the request. Refresh the private token in Astra Deck."}, 401)
        # Waitress has no in-handler shutdown hook (and werkzeug's was removed
        # in 2.1). The GUI's _stop_server() is the authoritative kill path;
        # this endpoint exists so the extension can *request* teardown and
        # know whether the app-level path must be used instead.
        func = request.environ.get('werkzeug.server.shutdown')
        if func:
            func()
            return cors_response({"status": "shutting_down"})
        return cors_response({"status": "stop_from_app_required"}, 202)

    return api

# ══════════════════════════════════════════════════════════════
# FIRST-RUN SETUP
# ══════════════════════════════════════════════════════════════
class SetupWorker(QThread):
    log = pyqtSignal(str)
    progress = pyqtSignal(int)
    finished_ok = pyqtSignal()
    finished_err = pyqtSignal(str)

    def _ranged_progress_cb(self, low, high):
        """Return a progress callback that maps bytes into [low, high]% of overall.

        We can only report a bounded range because the setup flow has many
        steps; the callback closes over the ffmpeg zip's download bounds and
        emits integers so the Qt signal connection stays cheap.
        """
        def cb(downloaded, total):
            if total and total > 0:
                pct = low + ((high - low) * downloaded / total)
                self.progress.emit(int(max(low, min(high, pct))))
        return cb

    def _verify_or_warn(self, path, sidecar_url, asset_name=None, label=""):
        """Fetch the SHA-256 sidecar and verify. Hard-fail on mismatch, soft-
        fail (log + continue) when the sidecar is unreachable.

        Hard-fail on mismatch is the correct default for something that will
        run with user privileges forever — if upstream ships a checksum, a
        mismatch means the download was tampered with or corrupted in transit.
        Soft-fail on missing sidecar keeps us working when the sidecar URL is
        rate-limited, 404s, or upstream stops publishing it.
        """
        expected = fetch_expected_sha256(sidecar_url, target_asset=asset_name)
        if not expected:
            self.log.emit(f"  {label} checksum sidecar unavailable — skipping verification")
            write_persistent_log(f"SHA-256 sidecar missing for {label} ({sidecar_url})")
            return False
        try:
            verify_file_sha256(path, expected)
        except RuntimeError as e:
            # Mismatch: nuke the downloaded file so the next retry re-fetches
            # from scratch instead of trusting a poisoned copy on disk.
            try:
                Path(path).unlink(missing_ok=True)
            except Exception:
                pass
            raise
        self.log.emit(f"  {label} checksum OK")
        return True

    def run(self):
        try:
            INSTALL_DIR.mkdir(parents=True, exist_ok=True)
            dl_path = Path(DEFAULT_CONFIG["DownloadPath"])
            dl_path.mkdir(parents=True, exist_ok=True)

            # yt-dlp (10-30% of overall progress)
            if not YTDLP_PATH.exists():
                self.log.emit("Downloading yt-dlp...")
                self.progress.emit(10)
                download_file_atomic(
                    YTDLP_URL, YTDLP_PATH, timeout=60, chunk_size=65536,
                    progress_cb=self._ranged_progress_cb(10, 28),
                )
                # Verify against the release SHA-256 sidecar before trusting
                # the binary — it'll be executed with user privileges for
                # every download from now on.
                self._verify_or_warn(
                    YTDLP_PATH, YTDLP_SHA256_URL,
                    asset_name=YTDLP_SHA256_ASSET, label="yt-dlp",
                )
                self.log.emit("  Done")
            else:
                self.log.emit("yt-dlp already installed")
            self.progress.emit(30)

            # ffmpeg (35-58% — the heaviest step, now byte-level progress)
            if not FFMPEG_PATH.exists():
                self.log.emit("Downloading ffmpeg (this may take a moment)...")
                self.progress.emit(35)
                import zipfile
                tmp_zip = INSTALL_DIR / f".ffmpeg.{uuid.uuid4().hex}.zip"
                zip_progress_cb = self._ranged_progress_cb(35, 55)
                try:
                    with http_requests.get(FFMPEG_URL, stream=True, timeout=120) as r:
                        r.raise_for_status()
                        total = None
                        try:
                            total = int(r.headers.get('content-length', '') or 0) or None
                        except (TypeError, ValueError):
                            total = None
                        downloaded = 0
                        last_cb = 0.0
                        with open(tmp_zip, 'wb') as data:
                            for chunk in r.iter_content(65536):
                                if chunk:
                                    data.write(chunk)
                                    downloaded += len(chunk)
                                    now = time.monotonic()
                                    if now - last_cb > 0.1:
                                        last_cb = now
                                        zip_progress_cb(downloaded, total)
                            data.flush()
                            os.fsync(data.fileno())
                    if tmp_zip.stat().st_size <= 0:
                        raise RuntimeError("Downloaded ffmpeg archive was empty")
                    # Verify the zip before we crack it open.
                    try:
                        self._verify_or_warn(
                            tmp_zip, FFMPEG_SHA256_URL, label="ffmpeg",
                        )
                    except RuntimeError:
                        # Verification failed — cleanup handled by finally + raise
                        raise
                    self.progress.emit(56)
                    found = False
                    tmp_ffmpeg = FFMPEG_PATH.with_name(f".{FFMPEG_PATH.name}.{uuid.uuid4().hex}.download")
                    try:
                        with zipfile.ZipFile(tmp_zip) as zf:
                            for entry in zf.namelist():
                                normalized = entry.replace('\\', '/')
                                if normalized.endswith('/ffmpeg.exe') or normalized == 'ffmpeg.exe':
                                    with zf.open(entry) as src, open(tmp_ffmpeg, 'wb') as dst:
                                        shutil.copyfileobj(src, dst)
                                        dst.flush()
                                        os.fsync(dst.fileno())
                                    if tmp_ffmpeg.stat().st_size <= 0:
                                        raise RuntimeError("ffmpeg.exe in archive was empty")
                                    os.replace(tmp_ffmpeg, FFMPEG_PATH)
                                    found = True
                                    break
                    finally:
                        try:
                            if tmp_ffmpeg.exists():
                                tmp_ffmpeg.unlink()
                        except Exception:
                            pass
                    if not found:
                        raise RuntimeError("ffmpeg.exe was not found in the downloaded archive")
                    self.log.emit("  Done")
                finally:
                    try:
                        if tmp_zip.exists():
                            tmp_zip.unlink()
                    except Exception:
                        pass
            else:
                self.log.emit("ffmpeg already installed")
            self.progress.emit(60)

            # Icon
            if not ICON_PATH.exists():
                self.log.emit("Downloading icon...")
                try:
                    download_file_atomic(ICON_URL, ICON_PATH, timeout=10, chunk_size=65536)
                except Exception as e:
                    # reason: icon is cosmetic; a failure here shouldn't
                    # block the rest of setup. Log so it's debuggable.
                    write_persistent_log(f"Icon download skipped: {e}")
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

            # Persist the integrations stamp so subsequent launches skip the
            # shortcut/protocol/task re-registration pass (v1.2.0 idempotency).
            _set_integrations_stamp()

            # Auto-update yt-dlp (throttled: only if we don't have a recent stamp)
            if DEFAULT_CONFIG.get("AutoUpdateYtDlp", True):
                self.log.emit("Updating yt-dlp...")
                try:
                    subprocess.Popen([str(YTDLP_PATH), '-U'],
                                     creationflags=CREATE_NO_WINDOW)
                except Exception as e:
                    write_persistent_log(f"yt-dlp -U launch failed during setup: {e}")

            self.progress.emit(100)
            self.log.emit("\nSetup complete!")
            self.finished_ok.emit()

        except Exception as e:
            log_crash("Setup worker")
            self.finished_err.emit(str(e))

    def _create_shortcut(self):
        target, base_args = launch_command_parts(prefer_installed=True)
        register_desktop_shortcut(target, base_args)

    def _register_startup(self):
        target, base_args = launch_command_parts(prefer_installed=True)
        register_startup_task(target, base_args)

    def _register_protocols(self):
        target, base_args = launch_command_parts(prefer_installed=True)
        register_protocol_handlers(target, base_args)

    def _register_uninstall(self):
        target, base_args = launch_command_parts(prefer_installed=True)
        register_uninstall_entry(target, base_args)

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
        current_pid = str(os.getpid())
        subprocess.run(['taskkill', '/F', '/T', '/IM', 'AstraDownloader.exe', '/FI', f'PID ne {current_pid}'],
                       capture_output=True, creationflags=CREATE_NO_WINDOW)
        subprocess.run(['taskkill', '/F', '/T', '/IM', 'yt-dlp.exe'], capture_output=True, creationflags=CREATE_NO_WINDOW)
        subprocess.run(['taskkill', '/F', '/T', '/IM', 'ffmpeg.exe'], capture_output=True, creationflags=CREATE_NO_WINDOW)

    # Remove scheduled task
    subprocess.run(['schtasks', '/Delete', '/TN', 'AstraDownloader', '/F'],
                   capture_output=True, creationflags=CREATE_NO_WINDOW)

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
        try:
            shutil.rmtree(INSTALL_DIR, ignore_errors=False)
        except Exception:
            write_persistent_log("Install directory will be removed after exit.")
            if is_frozen_app():
                cleanup_cmd = (
                    f'ping 127.0.0.1 -n 3 > nul & '
                    f'rmdir /S /Q {subprocess.list2cmdline([str(INSTALL_DIR)])}'
                )
                subprocess.Popen(['cmd', '/C', cleanup_cmd],
                                 stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                                 creationflags=CREATE_NO_WINDOW)

    QMessageBox.information(None, "Uninstall Complete",
                            "Astra Downloader has been uninstalled.\nYour downloaded videos were not removed.")
    sys.exit(0)

# ══════════════════════════════════════════════════════════════
# GUI WIDGETS
# ══════════════════════════════════════════════════════════════
def repolish(widget):
    widget.style().unpolish(widget)
    widget.style().polish(widget)
    widget.update()


def make_label(text, class_name=None, word_wrap=False):
    lbl = QLabel(text)
    if class_name:
        lbl.setProperty("class", class_name)
    lbl.setWordWrap(word_wrap)
    return lbl


def make_section_label(text):
    return make_label(text, "section")


def make_divider():
    divider = QFrame()
    divider.setProperty("class", "divider")
    return divider


def make_card(class_name="card"):
    f = QFrame()
    f.setProperty("class", class_name)
    return f


def make_status_badge(text, tone="neutral"):
    badge = QLabel(text)
    badge.setProperty("class", "badge")
    badge.setProperty("tone", tone)
    badge.setAlignment(Qt.AlignmentFlag.AlignCenter)
    badge.setMinimumHeight(22)
    return badge


def download_status_tone(status):
    if status in ("complete",):
        return "success"
    if status in ("failed", "cancelled"):
        return "danger"
    if status in ("merging", "extracting", "queued"):
        return "warning"
    if status in ("downloading",):
        return "info"
    return "neutral"


def human_status(status):
    return {
        "queued": "Queued",
        "downloading": "Downloading",
        "merging": "Merging",
        "extracting": "Extracting",
        "complete": "Complete",
        "failed": "Failed",
        "cancelled": "Cancelled",
    }.get(status, str(status).title())


def format_duration(seconds):
    try:
        seconds = int(seconds or 0)
    except (TypeError, ValueError):
        return ""
    if seconds <= 0:
        return ""
    mins, secs = divmod(seconds, 60)
    hours, mins = divmod(mins, 60)
    if hours:
        return f"{hours}h {mins}m"
    if mins:
        return f"{mins}m {secs}s"
    return f"{secs}s"


def clamp_int(value, default, minimum, maximum):
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        parsed = default
    return max(minimum, min(maximum, parsed))


def make_empty_state(title, body):
    frame = make_card("empty")
    layout = QVBoxLayout(frame)
    layout.setContentsMargins(18, 18, 18, 18)
    layout.setSpacing(6)
    layout.addWidget(make_label(title, "emptyTitle"))
    layout.addWidget(make_label(body, "emptyBody", word_wrap=True))
    return frame


def make_stat(label_text, value_text="0", hint_text=""):
    f = QFrame()
    f.setProperty("class", "stat")
    layout = QVBoxLayout(f)
    layout.setContentsMargins(16, 14, 16, 14)
    layout.setSpacing(4)
    lbl = make_label(label_text, "section")
    val = QLabel(value_text)
    val.setAlignment(Qt.AlignmentFlag.AlignLeft)
    val.setStyleSheet("font-size: 25px; font-weight: 750; color: #f8fafc;")
    val.setObjectName(f"stat_{label_text.lower()}")
    layout.addWidget(lbl)
    layout.addWidget(val)
    if hint_text:
        hint = make_label(hint_text, "fieldHint")
        layout.addWidget(hint)
    return f, val

# ══════════════════════════════════════════════════════════════
# MAIN WINDOW
# ══════════════════════════════════════════════════════════════
class MainWindow(QMainWindow):
    log_message = pyqtSignal(str)

    def __init__(self, config, dl_manager, history, start_minimized=False):
        super().__init__()
        self.config = config
        self.dl_manager = dl_manager
        self.history_mgr = history
        self._force_exit = False
        self._page_anim = None
        self._setup_running = False
        self._tray_hint_shown = False
        self._downloads_signature = None
        self.log_message.connect(self._append_log)

        self.setWindowTitle(APP_NAME)
        self.setMinimumSize(760, 560)
        self.resize(980, 680)

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
        sidebar.setFixedWidth(196)
        sidebar_layout = QVBoxLayout(sidebar)
        sidebar_layout.setContentsMargins(0, 0, 0, 0)
        sidebar_layout.setSpacing(0)

        # Brand
        brand = QWidget()
        brand_layout = QVBoxLayout(brand)
        brand_layout.setContentsMargins(18, 22, 18, 24)
        brand_layout.setSpacing(3)
        title_lbl = make_label(APP_NAME)
        title_lbl.setStyleSheet("font-size: 16px; font-weight: 750; color: #f8fafc;")
        ver_lbl = make_label(f"Companion service  v{APP_VERSION}", "muted")
        ver_lbl.setStyleSheet("font-size: 10px; color: #7b8794;")
        brand_layout.addWidget(title_lbl)
        brand_layout.addWidget(ver_lbl)
        sidebar_layout.addWidget(brand)

        # Nav buttons
        self.nav_buttons = []
        nav_icons = {
            "Dashboard": QStyle.StandardPixmap.SP_ComputerIcon,
            "Downloads": QStyle.StandardPixmap.SP_ArrowDown,
            "History": QStyle.StandardPixmap.SP_FileDialogDetailedView,
            "Settings": QStyle.StandardPixmap.SP_FileDialogInfoView,
        }
        for name in ["Dashboard", "Downloads", "History", "Settings"]:
            btn = QPushButton(name)
            btn.setProperty("class", "nav")
            btn.setIcon(self.style().standardIcon(nav_icons[name]))
            btn.setIconSize(QSize(15, 15))
            btn.setCursor(Qt.CursorShape.PointingHandCursor)
            btn.setToolTip(f"Open {name.lower()}")
            btn.clicked.connect(lambda checked, n=name: self._nav_click(n))
            sidebar_layout.addWidget(btn)
            self.nav_buttons.append(btn)

        sidebar_layout.addStretch()

        # Status dot
        status_row = QHBoxLayout()
        status_row.setContentsMargins(18, 0, 18, 18)
        status_row.setSpacing(8)
        self.status_dot = QLabel("\u2022")
        self.status_dot.setStyleSheet("color: #7b8794; font-size: 20px;")
        self.status_label = make_label("Stopped", "muted")
        self.status_label.setStyleSheet("font-size: 11px; color: #7b8794;")
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
        folder_action = tray_menu.addAction("Open Downloads Folder")
        folder_action.triggered.connect(self._open_folder)
        tray_menu.addSeparator()
        exit_action = tray_menu.addAction("Quit Astra Downloader")
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
        self.server_obj = None
        self.server_start_time = None

        if start_minimized:
            QTimer.singleShot(100, self._minimize_to_tray)

    def _make_page_header(self, title, subtitle):
        header = QVBoxLayout()
        header.setSpacing(5)
        header.addWidget(make_label(title, "title"))
        header.addWidget(make_label(subtitle, "subtitle", word_wrap=True))
        return header

    def _make_tool_button(self, text, icon, class_name="secondary"):
        btn = QPushButton(text)
        btn.setProperty("class", class_name)
        btn.setIcon(self.style().standardIcon(icon))
        btn.setIconSize(QSize(15, 15))
        btn.setCursor(Qt.CursorShape.PointingHandCursor)
        btn.setAccessibleName(text)
        return btn

    def _build_dashboard(self):
        page = QWidget()
        layout = QVBoxLayout(page)
        layout.setContentsMargins(28, 24, 28, 24)
        layout.setSpacing(18)

        layout.addLayout(self._make_page_header(
            "Control Center",
            "Run the local Astra Deck download service, monitor activity, and keep the companion ready in the tray."
        ))

        # Server control
        ctrl = make_card()
        ctrl_layout = QVBoxLayout(ctrl)
        ctrl_layout.setContentsMargins(20, 18, 20, 18)
        ctrl_layout.setSpacing(14)

        top = QHBoxLayout()
        top.setSpacing(16)
        left = QVBoxLayout()
        left.setSpacing(5)
        self.dash_status = make_label("Server stopped")
        self.dash_status.setStyleSheet("font-size: 17px; font-weight: 750; color: #f8fafc;")
        self.dash_endpoint = make_label(f"http://127.0.0.1:{self.config.get('ServerPort', SERVER_PORT)}", "secondary")
        self.dash_endpoint.setTextInteractionFlags(Qt.TextInteractionFlag.TextSelectableByMouse)
        self.dash_hint = make_label("Local-only API. Requests require your private Astra token.", "fieldHint", word_wrap=True)
        left.addWidget(self.dash_status)
        left.addWidget(self.dash_endpoint)
        left.addWidget(self.dash_hint)
        top.addLayout(left, 1)
        self.server_badge = make_status_badge("Stopped", "neutral")
        top.addWidget(self.server_badge, 0, Qt.AlignmentFlag.AlignTop)
        ctrl_layout.addLayout(top)

        actions = QHBoxLayout()
        actions.setSpacing(10)
        self.btn_startstop = self._make_tool_button("Start Server", QStyle.StandardPixmap.SP_MediaPlay, "primary")
        self.btn_startstop.clicked.connect(self._toggle_server)
        actions.addWidget(self.btn_startstop)
        btn_copy = self._make_tool_button("Copy URL", QStyle.StandardPixmap.SP_FileDialogContentsView)
        btn_copy.clicked.connect(self._copy_endpoint)
        actions.addWidget(btn_copy)
        btn_folder = self._make_tool_button("Open Folder", QStyle.StandardPixmap.SP_DirOpenIcon)
        btn_folder.clicked.connect(self._open_folder)
        actions.addWidget(btn_folder)
        actions.addStretch()
        ctrl_layout.addLayout(actions)

        self.setup_status = make_label("", "fieldHint")
        self.setup_status.hide()
        self.setup_progress = QProgressBar()
        self.setup_progress.setRange(0, 100)
        self.setup_progress.setValue(0)
        self.setup_progress.setTextVisible(False)
        self.setup_progress.hide()
        ctrl_layout.addWidget(self.setup_status)
        ctrl_layout.addWidget(self.setup_progress)
        layout.addWidget(ctrl)

        # Stats — keep refs to frames (else Python GC deletes the underlying Qt objects)
        stats_layout = QHBoxLayout()
        stats_layout.setSpacing(10)
        self._stat_frame_active, self.stat_active = make_stat("Active", "0", "In progress")
        self.stat_active.setStyleSheet("font-size: 25px; font-weight: 750; color: #61f09a;")
        self._stat_frame_completed, self.stat_completed = make_stat("Completed", "0", "This session")
        self._stat_frame_uptime, self.stat_uptime = make_stat("Uptime", "--", "Since launch")
        self._stat_frame_port, self.stat_port = make_stat("Port", str(self.config.get("ServerPort", SERVER_PORT)), "Local API")
        for frame in (self._stat_frame_active, self._stat_frame_completed,
                      self._stat_frame_uptime, self._stat_frame_port):
            stats_layout.addWidget(frame)
        layout.addLayout(stats_layout)

        log_header = QHBoxLayout()
        log_header.addWidget(make_section_label("Server log"))
        log_header.addStretch()
        btn_clear_log = self._make_tool_button("Clear Log", QStyle.StandardPixmap.SP_DialogResetButton, "ghost")
        btn_clear_log.clicked.connect(self._clear_log)
        log_header.addWidget(btn_clear_log)
        btn_diag = self._make_tool_button("Copy Diagnostics", QStyle.StandardPixmap.SP_FileDialogContentsView, "ghost")
        btn_diag.clicked.connect(self._copy_diagnostics)
        log_header.addWidget(btn_diag)
        log_header.addWidget(make_status_badge("Local only", "neutral"))
        layout.addLayout(log_header)
        self.log_text = QTextEdit()
        self.log_text.setReadOnly(True)
        self.log_text.setMinimumHeight(180)
        self.log_text.document().setMaximumBlockCount(300)
        self.log_text.setPlainText("Ready.")
        layout.addWidget(self.log_text, 1)

        self.tabs.addTab(page, "Dashboard")

    def _build_downloads(self):
        page = QWidget()
        layout = QVBoxLayout(page)
        layout.setContentsMargins(28, 24, 28, 24)
        layout.setSpacing(16)
        layout.addLayout(self._make_page_header(
            "Downloads",
            "Live queue activity from Astra Deck, including progress, speed, failures, and recent completions."
        ))

        scroll = QScrollArea()
        scroll.setWidgetResizable(True)
        content = QWidget()
        self.downloads_list_layout = QVBoxLayout(content)
        self.downloads_list_layout.setContentsMargins(0, 0, 0, 0)
        self.downloads_list_layout.setSpacing(10)
        scroll.setWidget(content)
        layout.addWidget(scroll, 1)
        self.tabs.addTab(page, "Downloads")

    def _build_history(self):
        page = QWidget()
        layout = QVBoxLayout(page)
        layout.setContentsMargins(28, 24, 28, 24)
        layout.setSpacing(16)
        header = QHBoxLayout()
        header.addLayout(self._make_page_header(
            "History",
            "The latest completed downloads are kept here for quick confirmation."
        ), 1)
        btn_clear = self._make_tool_button("Clear History", QStyle.StandardPixmap.SP_TrashIcon, "danger")
        btn_clear.clicked.connect(self._clear_history)
        header.addWidget(btn_clear, 0, Qt.AlignmentFlag.AlignTop)
        layout.addLayout(header)

        scroll = QScrollArea()
        scroll.setWidgetResizable(True)
        content = QWidget()
        self.history_container = QVBoxLayout(content)
        self.history_container.setContentsMargins(0, 0, 0, 0)
        self.history_container.setSpacing(10)
        scroll.setWidget(content)
        layout.addWidget(scroll, 1)
        self.tabs.addTab(page, "History")

    def _build_settings(self):
        page = QWidget()
        scroll = QScrollArea()
        scroll.setWidgetResizable(True)
        scroll.setWidget(page)
        layout = QVBoxLayout(page)
        layout.setContentsMargins(28, 24, 28, 24)
        layout.setSpacing(14)

        layout.addLayout(self._make_page_header(
            "Settings",
            "Tune storage, post-processing, performance, and tray behavior for the companion service."
        ))

        # Connection
        layout.addWidget(make_section_label("Connection"))
        conn_card = make_card()
        conn_l = QVBoxLayout(conn_card)
        conn_l.setContentsMargins(18, 16, 18, 16)
        conn_l.setSpacing(12)
        port_row = QHBoxLayout()
        port_copy = QVBoxLayout()
        port_copy.setSpacing(2)
        port_copy.addWidget(make_label("Local API port", "fieldLabel"))
        port_copy.addWidget(make_label("Astra Deck uses 9751 by default. Change this only for custom clients or troubleshooting.", "fieldHint", word_wrap=True))
        port_row.addLayout(port_copy, 1)
        self.cfg_port = QSpinBox()
        self.cfg_port.setAccessibleName("Local API port")
        self.cfg_port.setRange(1024, 65535)
        self.cfg_port.setValue(clamp_int(self.config.get("ServerPort", SERVER_PORT), SERVER_PORT, 1024, 65535))
        self.cfg_port.setFixedWidth(100)
        port_row.addWidget(self.cfg_port)
        conn_l.addLayout(port_row)
        conn_l.addWidget(make_divider())
        token_copy = QVBoxLayout()
        token_copy.setSpacing(2)
        token_copy.addWidget(make_label("Private token", "fieldLabel"))
        token_copy.addWidget(make_label("Required for extension requests. Regenerate only if you want to revoke the current token.", "fieldHint", word_wrap=True))
        conn_l.addLayout(token_copy)
        token_row = QHBoxLayout()
        token_row.setSpacing(8)
        self.cfg_token = QLineEdit(self.config.get("ServerToken", ""))
        self.cfg_token.setAccessibleName("Private API token")
        self.cfg_token.setReadOnly(True)
        self.cfg_token.setEchoMode(QLineEdit.EchoMode.Password)
        token_row.addWidget(self.cfg_token, 1)
        self.btn_token_reveal = self._make_tool_button("Reveal", QStyle.StandardPixmap.SP_FileDialogInfoView)
        self.btn_token_reveal.clicked.connect(self._toggle_token_visible)
        token_row.addWidget(self.btn_token_reveal)
        btn_token_copy = self._make_tool_button("Copy", QStyle.StandardPixmap.SP_FileDialogContentsView)
        btn_token_copy.clicked.connect(self._copy_token)
        token_row.addWidget(btn_token_copy)
        btn_token_reset = self._make_tool_button("Regenerate", QStyle.StandardPixmap.SP_BrowserReload, "danger")
        btn_token_reset.clicked.connect(self._regenerate_token)
        token_row.addWidget(btn_token_reset)
        conn_l.addLayout(token_row)
        layout.addWidget(conn_card)

        # Storage
        layout.addWidget(make_section_label("Storage"))
        paths_card = make_card()
        paths_l = QVBoxLayout(paths_card)
        paths_l.setContentsMargins(18, 16, 18, 16)
        paths_l.setSpacing(10)
        paths_l.addWidget(make_label("Video download folder", "fieldLabel"))
        paths_l.addWidget(make_label("Used for video downloads unless a request specifies a custom destination.", "fieldHint", word_wrap=True))
        row = QHBoxLayout()
        row.setSpacing(8)
        self.cfg_dl_path = QLineEdit(self.config.get("DownloadPath", ""))
        self.cfg_dl_path.setAccessibleName("Video download folder")
        self.cfg_dl_path.setPlaceholderText(str(Path.home() / "Videos" / "YouTube"))
        row.addWidget(self.cfg_dl_path, 1)
        btn = self._make_tool_button("Browse", QStyle.StandardPixmap.SP_DirOpenIcon)
        btn.clicked.connect(lambda: self._browse(self.cfg_dl_path))
        row.addWidget(btn)
        paths_l.addLayout(row)
        paths_l.addWidget(make_divider())
        paths_l.addWidget(make_label("Audio download folder", "fieldLabel"))
        paths_l.addWidget(make_label("Leave blank to save audio beside video downloads.", "fieldHint", word_wrap=True))
        row2 = QHBoxLayout()
        row2.setSpacing(8)
        self.cfg_audio_path = QLineEdit(self.config.get("AudioDownloadPath", ""))
        self.cfg_audio_path.setAccessibleName("Audio download folder")
        self.cfg_audio_path.setPlaceholderText("Same as video folder")
        row2.addWidget(self.cfg_audio_path, 1)
        btn2 = self._make_tool_button("Browse", QStyle.StandardPixmap.SP_DirOpenIcon)
        btn2.clicked.connect(lambda: self._browse(self.cfg_audio_path))
        row2.addWidget(btn2)
        paths_l.addLayout(row2)
        layout.addWidget(paths_card)

        # Post-processing
        layout.addWidget(make_section_label("Post-processing"))
        pp_card = make_card()
        pp_l = QVBoxLayout(pp_card)
        pp_l.setContentsMargins(18, 16, 18, 16)
        pp_l.setSpacing(8)
        self.cfg_metadata = QCheckBox("Embed metadata: title, artist, upload date")
        self.cfg_metadata.setChecked(self.config.get("EmbedMetadata", True))
        self.cfg_thumbnail = QCheckBox("Embed thumbnail as cover art")
        self.cfg_thumbnail.setChecked(self.config.get("EmbedThumbnail", True))
        self.cfg_chapters = QCheckBox("Embed chapter markers")
        self.cfg_chapters.setChecked(self.config.get("EmbedChapters", True))
        self.cfg_subs = QCheckBox("Embed subtitles when available")
        self.cfg_subs.setChecked(self.config.get("EmbedSubs", False))
        for w in [self.cfg_metadata, self.cfg_thumbnail, self.cfg_chapters, self.cfg_subs]:
            pp_l.addWidget(w)
        sub_row = QHBoxLayout()
        sub_row.setSpacing(8)
        sub_row.addSpacing(28)
        sub_row.addWidget(make_label("Subtitle languages", "fieldHint"))
        self.cfg_sublangs = QLineEdit(self.config.get("SubLangs", "en"))
        self.cfg_sublangs.setAccessibleName("Subtitle languages")
        self.cfg_sublangs.setPlaceholderText("en,es")
        self.cfg_sublangs.setFixedWidth(140)
        sub_row.addWidget(self.cfg_sublangs)
        sub_row.addStretch()
        pp_l.addLayout(sub_row)
        pp_l.addWidget(make_divider())
        self.cfg_sponsorblock = QCheckBox("Use SponsorBlock segments")
        self.cfg_sponsorblock.setChecked(self.config.get("SponsorBlock", False))
        pp_l.addWidget(self.cfg_sponsorblock)
        sb_row = QHBoxLayout()
        sb_row.setSpacing(8)
        sb_row.addSpacing(28)
        sb_row.addWidget(make_label("Action", "fieldHint"))
        self.cfg_sb_action = QComboBox()
        self.cfg_sb_action.setAccessibleName("SponsorBlock action")
        self.cfg_sb_action.addItem("Remove segments", "remove")
        self.cfg_sb_action.addItem("Mark segments", "mark")
        current_action = self.config.get("SponsorBlockAction", "remove")
        self.cfg_sb_action.setCurrentIndex(1 if current_action == "mark" else 0)
        self.cfg_sb_action.setEnabled(self.cfg_sponsorblock.isChecked())
        self.cfg_sponsorblock.toggled.connect(self.cfg_sb_action.setEnabled)
        sb_row.addWidget(self.cfg_sb_action)
        sb_row.addStretch()
        pp_l.addLayout(sb_row)
        layout.addWidget(pp_card)

        # Performance
        layout.addWidget(make_section_label("Performance"))
        perf_card = make_card()
        perf_l = QVBoxLayout(perf_card)
        perf_l.setContentsMargins(18, 16, 18, 16)
        perf_l.setSpacing(12)
        frag_row = QHBoxLayout()
        frag_copy = QVBoxLayout()
        frag_copy.setSpacing(2)
        frag_copy.addWidget(make_label("Concurrent fragments", "fieldLabel"))
        frag_copy.addWidget(make_label("Higher values may improve speed on fast connections.", "fieldHint", word_wrap=True))
        frag_row.addLayout(frag_copy, 1)
        self.cfg_fragments = QSpinBox()
        self.cfg_fragments.setAccessibleName("Concurrent fragments")
        self.cfg_fragments.setRange(1, 32)
        self.cfg_fragments.setValue(clamp_int(self.config.get("ConcurrentFragments", 4), 4, 1, 32))
        self.cfg_fragments.setFixedWidth(86)
        frag_row.addWidget(self.cfg_fragments)
        perf_l.addLayout(frag_row)
        perf_l.addWidget(make_divider())
        rate_row = QHBoxLayout()
        rate_copy = QVBoxLayout()
        rate_copy.setSpacing(2)
        rate_copy.addWidget(make_label("Rate limit", "fieldLabel"))
        rate_copy.addWidget(make_label("Optional yt-dlp limit such as 500K or 2M.", "fieldHint", word_wrap=True))
        rate_row.addLayout(rate_copy, 1)
        self.cfg_ratelimit = QLineEdit(self.config.get("RateLimit", ""))
        self.cfg_ratelimit.setAccessibleName("Rate limit")
        self.cfg_ratelimit.setPlaceholderText("No limit")
        self.cfg_ratelimit.setFixedWidth(120)
        rate_row.addWidget(self.cfg_ratelimit)
        perf_l.addLayout(rate_row)
        proxy_row = QHBoxLayout()
        proxy_copy = QVBoxLayout()
        proxy_copy.setSpacing(2)
        proxy_copy.addWidget(make_label("Proxy", "fieldLabel"))
        proxy_copy.addWidget(make_label("Optional http, https, or socks proxy URL.", "fieldHint", word_wrap=True))
        proxy_row.addLayout(proxy_copy, 1)
        self.cfg_proxy = QLineEdit(self.config.get("Proxy", ""))
        self.cfg_proxy.setAccessibleName("Proxy")
        self.cfg_proxy.setPlaceholderText("https://proxy.example:8080")
        self.cfg_proxy.setMinimumWidth(260)
        proxy_row.addWidget(self.cfg_proxy)
        perf_l.addLayout(proxy_row)
        layout.addWidget(perf_card)

        # Behavior
        layout.addWidget(make_section_label("Behavior"))
        beh_card = make_card()
        beh_l = QVBoxLayout(beh_card)
        beh_l.setContentsMargins(18, 16, 18, 16)
        beh_l.setSpacing(8)
        self.cfg_autoupdate = QCheckBox("Update yt-dlp automatically when the server starts")
        self.cfg_autoupdate.setChecked(self.config.get("AutoUpdateYtDlp", True))
        self.cfg_archive = QCheckBox("Skip videos already recorded in the download archive")
        self.cfg_archive.setChecked(self.config.get("DownloadArchive", True))
        self.cfg_closetotray = QCheckBox("Close to the system tray instead of quitting")
        self.cfg_closetotray.setChecked(self.config.get("CloseToTray", True))
        self.cfg_startmin = QCheckBox("Start minimized to the tray")
        self.cfg_startmin.setChecked(self.config.get("StartMinimized", False))
        for w in [self.cfg_autoupdate, self.cfg_archive, self.cfg_closetotray, self.cfg_startmin]:
            beh_l.addWidget(w)
        layout.addWidget(beh_card)

        # Tools — v1.2.0 downloader-maintenance actions
        layout.addWidget(make_section_label("Tools"))
        tools_card = make_card()
        tools_l = QVBoxLayout(tools_card)
        tools_l.setContentsMargins(18, 16, 18, 16)
        tools_l.setSpacing(10)
        tools_l.addWidget(make_label("Installed tools", "fieldLabel"))
        self.tools_status = make_label(self._tools_status_text(), "fieldHint", word_wrap=True)
        tools_l.addWidget(self.tools_status)
        tools_row = QHBoxLayout()
        tools_row.setSpacing(8)
        btn_check_updates = self._make_tool_button(
            "Check yt-dlp Update", QStyle.StandardPixmap.SP_BrowserReload,
        )
        btn_check_updates.setToolTip("Force an immediate yt-dlp self-update and refresh the version readout.")
        btn_check_updates.clicked.connect(self._force_ytdlp_update)
        tools_row.addWidget(btn_check_updates)
        btn_reinstall_ffmpeg = self._make_tool_button(
            "Reinstall ffmpeg", QStyle.StandardPixmap.SP_DialogResetButton, "danger",
        )
        btn_reinstall_ffmpeg.setToolTip("Delete the installed ffmpeg and re-download from source with checksum verification.")
        btn_reinstall_ffmpeg.clicked.connect(self._reinstall_ffmpeg)
        tools_row.addWidget(btn_reinstall_ffmpeg)
        tools_row.addStretch()
        tools_l.addLayout(tools_row)
        layout.addWidget(tools_card)

        save_row = QHBoxLayout()
        self.settings_status = make_label("", "fieldHint")
        save_row.addWidget(self.settings_status, 1)
        btn_save = self._make_tool_button("Save Settings", QStyle.StandardPixmap.SP_DialogSaveButton, "primary")
        btn_save.clicked.connect(self._save_settings)
        self.btn_save = btn_save
        save_row.addWidget(btn_save)
        layout.addLayout(save_row)
        layout.addStretch()

        self.tabs.addTab(scroll, "Settings")

    # ── Navigation ──
    def _nav_click(self, name):
        idx = ["Dashboard", "Downloads", "History", "Settings"].index(name)
        self.tabs.setCurrentIndex(idx)
        for i, btn in enumerate(self.nav_buttons):
            btn.setProperty("active", "true" if i == idx else "false")
            repolish(btn)
        self._animate_page()
        if name == "History":
            self._refresh_history()

    def _animate_page(self):
        widget = self.tabs.currentWidget()
        if not widget:
            return
        effect = QGraphicsOpacityEffect(widget)
        widget.setGraphicsEffect(effect)
        anim = QPropertyAnimation(effect, b"opacity", self)
        anim.setDuration(120)
        anim.setStartValue(0.86)
        anim.setEndValue(1.0)
        anim.setEasingCurve(QEasingCurve.Type.OutCubic)
        anim.finished.connect(lambda: widget.setGraphicsEffect(None))
        self._page_anim = anim
        anim.start()

    # ── Server ──
    def _toggle_server(self):
        if self.server_running:
            self._stop_server()
        else:
            self._start_server()

    def _start_server(self):
        if self.server_running:
            return
        if self._setup_running:
            self._append_log("Setup is already running. The server will start when it finishes.")
            return
        if not YTDLP_PATH.exists() or not FFMPEG_PATH.exists():
            self._append_log("Required tools are missing. Starting setup...")
            self._run_setup()
            return

        configured_port = clamp_int(self.config.get("ServerPort", SERVER_PORT), SERVER_PORT, 1024, 65535)
        api = create_api(self.config, self.dl_manager, self.history_mgr)

        # Port discovery: try configured port first, then fall back to well-known
        # alternatives. Fixes systems where Windows/Hyper-V has blocked the default
        # (WinError 10013) or another process holds it (WinError 10048).
        fallback_ports = [configured_port] + [p for p in PORT_FALLBACKS if p != configured_port]
        chosen_port = None
        last_err: Exception | None = None
        for candidate in fallback_ports:
            probe = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            try:
                probe.bind(('127.0.0.1', candidate))
                chosen_port = candidate
                break
            except OSError as e:
                last_err = e
                continue
            finally:
                try:
                    probe.close()
                except OSError:
                    pass

        if chosen_port is None:
            assert last_err is not None
            if getattr(last_err, 'winerror', None) == 10013:
                msg = ("All candidate ports are blocked by Windows.\n\n"
                       "Run as Administrator in PowerShell:\n"
                       "  net stop winnat\n"
                       "  netsh int ipv4 delete excludedportrange protocol=tcp "
                       f"startport={configured_port} numberofports=1\n"
                       "  net start winnat")
            elif getattr(last_err, 'winerror', None) == 10048:
                msg = "All candidate ports are already in use by other processes."
            else:
                msg = f"Cannot bind any server port: {last_err}"
            self._append_log(f"Server error: {msg}")
            self._show_server_error(msg)
            return

        if chosen_port != configured_port:
            self._append_log(
                f"Port {configured_port} is unavailable; using fallback port {chosen_port}."
            )
            # Persist so future starts prefer the working port.
            self.config.set("ServerPort", chosen_port)
            self.config.save()
            self._sync_connection_ui()

        try:
            # v1.2.0: prefer waitress (production-grade WSGI) and fall back
            # to werkzeug's dev server only when waitress isn't available
            # (source runs without `pip install -r requirements.txt`).
            self.server_obj = _build_wsgi_server(chosen_port, api)
        except Exception as e:
            self.server_obj = None
            self._append_log(f"Server error: {e}")
            self._show_server_error(str(e))
            return

        port = chosen_port

        def run():
            try:
                self.server_obj.run()
            except Exception as e:
                self.log_message.emit(f"Server error: {e}")

        self.server_thread = threading.Thread(target=run, daemon=True)
        self.server_thread.start()
        self.server_running = True
        self.server_start_time = time.time()
        self._append_log(
            f"Server started on http://127.0.0.1:{port} "
            f"(backend: {self.server_obj.backend})"
        )
        self._update_server_ui()

        # Auto-update yt-dlp — throttled (once per 24h) so we don't re-run
        # it on every single launch. Logs exit code instead of silently
        # discarding it.
        maybe_auto_update_ytdlp(self.config)

    def _stop_server(self):
        if self.server_obj:
            try:
                self.server_obj.stop()
                if self.server_thread and self.server_thread.is_alive():
                    self.server_thread.join(timeout=2)
            except Exception as e:
                self._append_log(f"Server shutdown warning: {e}")
            self.server_obj = None
        self.server_thread = None
        self.server_running = False
        self.server_start_time = None
        self._append_log("Server stopped")
        self._update_server_ui()

    def _update_server_ui(self):
        if self.server_running:
            self.status_dot.setStyleSheet("color: #2dd36f; font-size: 20px;")
            self.status_label.setText("Running")
            self.status_label.setStyleSheet("color: #9ff3bd; font-size: 11px;")
            self.dash_status.setText("Server running")
            self.dash_hint.setText("Ready for Astra Deck requests. The service only listens on this computer.")
            self.server_badge.setText("Running")
            self.server_badge.setProperty("tone", "success")
            self.btn_startstop.setText("Stop Server")
            self.btn_startstop.setIcon(self.style().standardIcon(QStyle.StandardPixmap.SP_MediaStop))
            self.btn_startstop.setProperty("class", "secondary")
            self.tray_startstop.setText("Stop Server")
            self.tray.setToolTip(f"{APP_NAME} - Running")
        else:
            self.status_dot.setStyleSheet("color: #7b8794; font-size: 20px;")
            self.status_label.setText("Stopped")
            self.status_label.setStyleSheet("color: #7b8794; font-size: 11px;")
            self.dash_status.setText("Server stopped")
            self.dash_hint.setText("Start the service before using download actions in Astra Deck.")
            self.server_badge.setText("Stopped")
            self.server_badge.setProperty("tone", "neutral")
            self.btn_startstop.setText("Start Server")
            self.btn_startstop.setIcon(self.style().standardIcon(QStyle.StandardPixmap.SP_MediaPlay))
            self.btn_startstop.setProperty("class", "primary")
            self.tray_startstop.setText("Start Server")
            self.tray.setToolTip(f"{APP_NAME} - Stopped")
        repolish(self.btn_startstop)
        repolish(self.server_badge)

    def _clear_layout(self, layout):
        while layout.count():
            item = layout.takeAt(0)
            if item.widget():
                item.widget().deleteLater()
            elif item.layout():
                self._clear_layout(item.layout())

    def _download_card(self, dl, recent=False):
        card = QFrame()
        card.setProperty("class", "download")
        if dl.status in ("failed", "complete"):
            card.setProperty("state", dl.status)
        card_l = QVBoxLayout(card)
        card_l.setContentsMargins(16, 13, 16, 13)
        card_l.setSpacing(9)

        top = QHBoxLayout()
        title = make_label(dl.title if dl.title and dl.title != "Unknown" else "Preparing download", "fieldLabel", word_wrap=True)
        top.addWidget(title, 1)
        top.addWidget(make_status_badge(human_status(dl.status), download_status_tone(dl.status)))
        if not recent and dl.status in ("queued", "downloading", "merging", "extracting"):
            btn_cancel = self._make_tool_button("Cancel", QStyle.StandardPixmap.SP_DialogCancelButton, "ghost")
            btn_cancel.clicked.connect(lambda checked=False, dl_id=dl.id: self.dl_manager.cancel(dl_id))
            top.addWidget(btn_cancel)
        elif recent and dl.status in ("failed", "cancelled"):
            btn_retry = self._make_tool_button("Retry", QStyle.StandardPixmap.SP_BrowserReload, "ghost")
            btn_retry.clicked.connect(lambda checked=False, item=dl: self._retry_download(item))
            top.addWidget(btn_retry)
        elif recent and dl.status == "complete" and dl.filename:
            btn_show = self._make_tool_button("Show", QStyle.StandardPixmap.SP_DirOpenIcon, "ghost")
            btn_show.clicked.connect(lambda checked=False, path=dl.filename: self._show_download_location(path))
            top.addWidget(btn_show)
        card_l.addLayout(top)

        if dl.status in ("queued", "downloading", "merging", "extracting"):
            bar = QProgressBar()
            bar.setRange(0, 100)
            bar.setValue(int(min(max(dl.progress, 0), 100)))
            bar.setTextVisible(False)
            card_l.addWidget(bar)

        meta_parts = []
        if dl.status in ("downloading", "merging", "extracting"):
            meta_parts.append(f"{dl.progress:.1f}%")
        if dl.speed:
            meta_parts.append(dl.speed)
        if dl.eta:
            meta_parts.append(f"ETA {dl.eta}")
        if dl.format:
            meta_parts.append(dl.format.upper())
        if dl.quality:
            meta_parts.append(str(dl.quality))
        if dl.error:
            meta_parts.append(dl.error)
        elif dl.filename:
            meta_parts.append(Path(dl.filename).name)
        meta = make_label("  /  ".join(meta_parts) if meta_parts else dl.url, "fieldHint", word_wrap=True)
        card_l.addWidget(meta)
        return card

    def _update_ui(self):
        if self.server_running and self.server_thread and not self.server_thread.is_alive():
            self.server_running = False
            self.server_start_time = None
            self.server_obj = None
            self._append_log("Server stopped unexpectedly")
            self._update_server_ui()

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
        downloads = self.dl_manager.snapshot()
        active = [d for d in downloads
                  if d.status in ('queued', 'downloading', 'merging', 'extracting')]
        recent = [d for d in downloads
                  if d.status in ('complete', 'failed', 'cancelled')]
        active.sort(key=lambda d: d.start_time, reverse=True)
        recent.sort(key=lambda d: d.start_time, reverse=True)
        signature = tuple(
            (d.id, d.status, round(d.progress, 1), d.speed, d.eta, d.title, d.error, d.filename)
            for d in active + recent[:8]
        )
        if signature == self._downloads_signature:
            return
        self._downloads_signature = signature

        self._clear_layout(self.downloads_list_layout)
        if not active and not recent:
            self.downloads_list_layout.addWidget(make_empty_state(
                "Queue is clear",
                "Downloads sent from Astra Deck will appear here with progress, speed, and failure details."
            ))
        if active:
            self.downloads_list_layout.addWidget(make_section_label("In progress"))
            for dl in active:
                self.downloads_list_layout.addWidget(self._download_card(dl))
        if recent:
            self.downloads_list_layout.addWidget(make_section_label("Recent activity"))
            for dl in recent[:8]:
                self.downloads_list_layout.addWidget(self._download_card(dl, recent=True))
        self.downloads_list_layout.addStretch()

    def _refresh_history(self):
        self._clear_layout(self.history_container)

        data = self.history_mgr.load()
        if not data:
            self.history_container.addWidget(make_empty_state(
                "No downloads yet",
                "Completed downloads will be listed here with format, quality, and duration."
            ))
            self.history_container.addStretch()
            return

        for h in reversed(data[-50:]):
            card = make_card("download")
            card.setProperty("state", "complete")
            card_l = QVBoxLayout(card)
            card_l.setContentsMargins(16, 13, 16, 13)
            card_l.setSpacing(7)
            top = QHBoxLayout()
            title = make_label(h.get("title", "(untitled)"), "fieldLabel", word_wrap=True)
            top.addWidget(title, 1)
            top.addWidget(make_status_badge("Complete", "success"))
            if h.get("filename"):
                btn_show = self._make_tool_button("Show", QStyle.StandardPixmap.SP_DirOpenIcon, "ghost")
                btn_show.clicked.connect(lambda checked=False, path=h.get("filename"): self._show_download_location(path))
                top.addWidget(btn_show)
            card_l.addLayout(top)
            parts = [p for p in [
                h.get("date"),
                str(h.get("format", "")).upper() if h.get("format") else "",
                h.get("quality"),
                format_duration(h.get("duration", 0)),
            ] if p]
            filename = h.get("filename")
            if filename:
                parts.append(Path(filename).name)
            meta = make_label("  /  ".join(parts), "fieldHint", word_wrap=True)
            card_l.addWidget(meta)
            self.history_container.addWidget(card)
        self.history_container.addStretch()

    def _clear_history(self):
        if not self.history_mgr.load():
            self._refresh_history()
            return
        result = QMessageBox.question(
            self,
            "Clear Download History",
            "Clear the saved download history?\n\nDownloaded files will stay on disk.",
            QMessageBox.StandardButton.Yes | QMessageBox.StandardButton.No,
            QMessageBox.StandardButton.No,
        )
        if result != QMessageBox.StandardButton.Yes:
            return
        self.history_mgr.clear()
        self._refresh_history()
        self._append_log("Download history cleared")

    def _retry_download(self, dl):
        dl_id, err = self.dl_manager.start_download(
            url=dl.url,
            audio_only=dl.audio_only,
            fmt=dl.format,
            quality=dl.quality,
            output_dir=dl.output_dir,
            title=dl.title if dl.title != "Unknown" else None,
            referer=dl.referer,
        )
        if err:
            self._append_log(f"Retry failed: {err}")
            return
        self._append_log(f"Retry queued: {dl.title if dl.title != 'Unknown' else dl.url}")
        self._nav_click("Downloads")

    def _show_download_location(self, file_path):
        if not file_path:
            self._open_folder()
            return
        path = Path(file_path)
        try:
            target = path.parent if path.suffix else path
            if target.exists():
                os.startfile(str(target))
                return
            self._append_log("Download location is no longer available")
        except Exception as e:
            self._append_log(f"Could not open download location: {e}")

    def _set_input_error(self, widget, is_error):
        widget.setProperty("state", "error" if is_error else "")
        repolish(widget)

    def _show_settings_status(self, message, tone="neutral"):
        colors = {
            "success": "#9ff3bd",
            "danger": "#ffb8b8",
            "warning": "#ffe4a3",
            "neutral": "#7b8794",
        }
        self.settings_status.setText(message)
        self.settings_status.setStyleSheet(f"color: {colors.get(tone, colors['neutral'])}; font-size: 11px;")

    def _sync_connection_ui(self):
        port = clamp_int(self.config.get("ServerPort", SERVER_PORT), SERVER_PORT, 1024, 65535)
        self.dash_endpoint.setText(f"http://127.0.0.1:{port}")
        self.stat_port.setText(str(port))

    # ── Tools: yt-dlp / ffmpeg maintenance (v1.2.0) ──
    def _tools_status_text(self):
        ytv = get_ytdlp_version() or "not installed"
        ffv = get_ffmpeg_version() or "not installed"
        return f"yt-dlp {ytv}    •    ffmpeg {ffv}"

    def _refresh_tools_status(self):
        try:
            self.tools_status.setText(self._tools_status_text())
        except Exception:
            pass

    def _force_ytdlp_update(self):
        if not YTDLP_PATH.exists():
            self._append_log("yt-dlp is not installed yet — run setup first.")
            return
        self._append_log("Forcing yt-dlp self-update…")

        def run():
            try:
                result = subprocess.run(
                    [str(YTDLP_PATH), '-U'],
                    capture_output=True, text=True, timeout=120,
                    creationflags=CREATE_NO_WINDOW,
                )
                if result.returncode == 0:
                    mark_ytdlp_update_check(self.config)
                    _version_cache['ytdlp']['checked_at'] = 0.0
                    self.log_message.emit(
                        f"yt-dlp update: {(result.stdout or '').strip()[:200]}"
                    )
                else:
                    self.log_message.emit(
                        f"yt-dlp update failed (exit {result.returncode}): "
                        f"{(result.stderr or result.stdout or '').strip()[:200]}"
                    )
            except Exception as e:
                self.log_message.emit(f"yt-dlp update error: {e}")
            finally:
                # Marshal the UI refresh back to the Qt thread.
                QTimer.singleShot(0, self._refresh_tools_status)

        threading.Thread(target=run, daemon=True).start()

    def _reinstall_ffmpeg(self):
        """Delete the installed ffmpeg.exe and re-run the setup download path
        so integrity verification re-runs from scratch."""
        if not FFMPEG_PATH.exists():
            # Still reasonable to trigger: lets the user install ffmpeg from
            # the Settings page without having to exit and re-launch.
            pass
        result = QMessageBox.question(
            self,
            "Reinstall ffmpeg",
            "Delete the installed ffmpeg and re-download it from source?\n\n"
            "The download is verified against the upstream checksum before being trusted.",
            QMessageBox.StandardButton.Yes | QMessageBox.StandardButton.No,
            QMessageBox.StandardButton.No,
        )
        if result != QMessageBox.StandardButton.Yes:
            return
        try:
            if FFMPEG_PATH.exists():
                FFMPEG_PATH.unlink()
        except Exception as e:
            self._append_log(f"Could not remove existing ffmpeg: {e}")
            return
        # Clear cached version string so /health reflects reality during the
        # window where ffmpeg is not yet re-downloaded.
        _version_cache['ffmpeg'] = {'value': None, 'checked_at': 0.0}
        self._refresh_tools_status()
        try:
            self.config.set("LastFfmpegCheck", datetime.now().strftime("%Y-%m-%d %H:%M:%S"))
            self.config.save()
        except Exception:
            pass
        # Re-run the setup worker — it short-circuits the yt-dlp + shortcuts
        # steps because those already exist, so effectively only the ffmpeg
        # download + SHA-256 verification runs.
        self._run_setup()

    def _save_settings(self):
        for field in (self.cfg_dl_path, self.cfg_audio_path, self.cfg_sublangs,
                      self.cfg_ratelimit, self.cfg_proxy):
            self._set_input_error(field, False)

        old_port = clamp_int(self.config.get("ServerPort", SERVER_PORT), SERVER_PORT, 1024, 65535)
        old_token = self.config.get("ServerToken", "")
        new_port = self.cfg_port.value()
        new_token = self.cfg_token.text().strip()
        dl_path = self.cfg_dl_path.text().strip()
        audio_path = self.cfg_audio_path.text().strip()
        sublangs = normalize_sublangs(self.cfg_sublangs.text())
        rate = normalize_rate_limit(self.cfg_ratelimit.text())
        proxy = self.cfg_proxy.text().strip()
        has_error = False

        dl_path, dl_path_err = normalize_output_dir(dl_path, DEFAULT_CONFIG["DownloadPath"])
        audio_path, audio_path_err = normalize_output_dir(audio_path, dl_path) if audio_path else ("", None)

        if dl_path_err:
            self._set_input_error(self.cfg_dl_path, True)
            has_error = True
        if audio_path_err:
            self._set_input_error(self.cfg_audio_path, True)
            has_error = True
        if not sublangs:
            self._set_input_error(self.cfg_sublangs, True)
            has_error = True
        if self.cfg_ratelimit.text().strip() and not rate:
            self._set_input_error(self.cfg_ratelimit, True)
            has_error = True
        if proxy and not normalize_proxy(proxy):
            self._set_input_error(self.cfg_proxy, True)
            has_error = True
        else:
            proxy = normalize_proxy(proxy)
        if not new_token:
            self._show_settings_status("Token cannot be empty.", "danger")
            has_error = True

        if has_error:
            self._show_settings_status("Check the highlighted fields before saving.", "danger")
            return

        connection_changed = new_port != old_port or new_token != old_token
        restart_now = False
        connection_change_blocked = False
        if connection_changed and self.server_running:
            result = QMessageBox.question(
                self,
                "Restart Server",
                "Connection settings changed.\n\nRestart the local server now so Astra Deck can use the updated values?",
                QMessageBox.StandardButton.Yes | QMessageBox.StandardButton.No,
                QMessageBox.StandardButton.Yes,
            )
            restart_now = result == QMessageBox.StandardButton.Yes
            if not restart_now:
                new_port = old_port
                new_token = old_token
                self.cfg_port.setValue(old_port)
                self.cfg_token.setText(old_token)
                connection_changed = False
                connection_change_blocked = True

        if restart_now:
            self._stop_server()

        self.cfg_dl_path.setText(dl_path)
        self.cfg_audio_path.setText(audio_path)
        self.cfg_sublangs.setText(sublangs)
        self.cfg_ratelimit.setText(rate)
        self.cfg_proxy.setText(proxy)
        self.config.set("ServerPort", new_port)
        self.config.set("ServerToken", new_token)
        self.config.set("DownloadPath", dl_path)
        self.config.set("AudioDownloadPath", audio_path)
        self.config.set("EmbedMetadata", self.cfg_metadata.isChecked())
        self.config.set("EmbedThumbnail", self.cfg_thumbnail.isChecked())
        self.config.set("EmbedChapters", self.cfg_chapters.isChecked())
        self.config.set("EmbedSubs", self.cfg_subs.isChecked())
        self.config.set("SubLangs", sublangs)
        self.config.set("SponsorBlock", self.cfg_sponsorblock.isChecked())
        self.config.set("SponsorBlockAction", self.cfg_sb_action.currentData())
        self.config.set("ConcurrentFragments", self.cfg_fragments.value())
        self.config.set("RateLimit", rate)
        self.config.set("Proxy", proxy)
        self.config.set("AutoUpdateYtDlp", self.cfg_autoupdate.isChecked())
        self.config.set("DownloadArchive", self.cfg_archive.isChecked())
        self.config.set("CloseToTray", self.cfg_closetotray.isChecked())
        self.config.set("StartMinimized", self.cfg_startmin.isChecked())
        self.config.save()
        self._sync_connection_ui()
        if restart_now:
            self._start_server()
            self._show_settings_status("Settings saved and server restarted.", "success")
        elif connection_change_blocked:
            self._show_settings_status("Other settings saved. Stop or restart the server before changing connection details.", "warning")
        else:
            self._show_settings_status("Settings saved.", "success")
        self.btn_save.setText("Saved")
        QTimer.singleShot(1500, lambda: self.btn_save.setText("Save Settings"))
        QTimer.singleShot(3200, lambda: self._show_settings_status(""))

    def _browse(self, line_edit):
        path = QFileDialog.getExistingDirectory(self, "Select Folder", line_edit.text())
        if path:
            line_edit.setText(path)

    def _copy_endpoint(self):
        QApplication.clipboard().setText(self.dash_endpoint.text())
        self._append_log("Endpoint copied to clipboard")
        old = self.dash_hint.text()
        self.dash_hint.setText("Endpoint copied.")
        QTimer.singleShot(1600, lambda: self.dash_hint.setText(old))

    def _copy_token(self):
        QApplication.clipboard().setText(self.cfg_token.text())
        self._show_settings_status("Token copied to clipboard.", "success")
        QTimer.singleShot(2200, lambda: self._show_settings_status(""))

    def _copy_diagnostics(self):
        active = self.dl_manager.active_count()
        diagnostics = [
            f"{APP_NAME} {APP_VERSION}",
            f"Server: {'running' if self.server_running else 'stopped'}",
            f"Endpoint: {self.dash_endpoint.text()}",
            f"Active downloads: {active}",
            f"Completed this session: {self.dl_manager.total_completed}",
            f"yt-dlp installed: {YTDLP_PATH.exists()}",
            f"ffmpeg installed: {FFMPEG_PATH.exists()}",
            f"Install directory: {INSTALL_DIR}",
            "",
            "Recent log:",
            self.log_text.toPlainText()[-3000:],
        ]
        QApplication.clipboard().setText("\n".join(diagnostics))
        self._append_log("Diagnostics copied to clipboard")

    def _clear_log(self):
        self.log_text.setPlainText("Ready.")

    def _toggle_token_visible(self):
        showing = self.cfg_token.echoMode() == QLineEdit.EchoMode.Normal
        self.cfg_token.setEchoMode(QLineEdit.EchoMode.Password if showing else QLineEdit.EchoMode.Normal)
        self.btn_token_reveal.setText("Reveal" if showing else "Hide")

    def _regenerate_token(self):
        result = QMessageBox.question(
            self,
            "Regenerate Private Token",
            "Generate a new private token?\n\nExisting extension requests will need the refreshed token after you save.",
            QMessageBox.StandardButton.Yes | QMessageBox.StandardButton.No,
            QMessageBox.StandardButton.No,
        )
        if result != QMessageBox.StandardButton.Yes:
            return
        self.cfg_token.setText(uuid.uuid4().hex)
        self._show_settings_status("New token ready. Save settings to apply it.", "warning")

    def _open_folder(self):
        p = self.config.get("DownloadPath", "")
        try:
            target = Path(p) if p else INSTALL_DIR
            if not target.exists():
                target.mkdir(parents=True, exist_ok=True)
            os.startfile(str(target))
        except Exception as e:
            self._append_log(f"Could not open folder: {e}")

    def _append_log(self, msg):
        ts = datetime.now().strftime("%H:%M:%S")
        self.log_text.append(f"{ts} {msg}")
        write_persistent_log(msg)
        cursor = self.log_text.textCursor()
        cursor.movePosition(QTextCursor.MoveOperation.End)
        self.log_text.setTextCursor(cursor)

    def _show_server_error(self, msg):
        """Show a blocking error dialog and ensure the main window is visible."""
        try:
            self.show()
            self.raise_()
            self.activateWindow()
            QMessageBox.warning(self, "Astra Downloader — Server failed to start", msg)
        except Exception:
            pass

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
            if not self._tray_hint_shown and self.tray.isVisible():
                self.tray.showMessage(
                    APP_NAME,
                    "Still running in the tray so Astra Deck can keep sending downloads.",
                    QSystemTrayIcon.MessageIcon.Information,
                    3000,
                )
                self._tray_hint_shown = True
        else:
            if self.server_running:
                self._stop_server()
            self.tray.hide()
            self.update_timer.stop()
            self.cleanup_timer.stop()
            event.accept()

    # ── First-run setup ──
    def _run_setup(self):
        if self._setup_running:
            return
        self._setup_running = True
        self._append_log("Running first-time setup...")
        self.setup_status.setText("Installing required download tools...")
        self.setup_status.show()
        self.setup_progress.setValue(0)
        self.setup_progress.show()
        self.btn_startstop.setEnabled(False)
        self.btn_startstop.setText("Setting Up")
        self.setup_worker = SetupWorker()
        self.setup_worker.log.connect(self._append_log)
        self.setup_worker.progress.connect(self._setup_progress)
        self.setup_worker.finished_ok.connect(self._setup_done)
        self.setup_worker.finished_err.connect(self._setup_failed)
        self.setup_worker.start()

    def _setup_progress(self, value):
        self.setup_progress.setValue(value)
        if value < 30:
            self.setup_status.setText("Installing yt-dlp...")
        elif value < 70:
            self.setup_status.setText("Installing ffmpeg...")
        elif value < 95:
            self.setup_status.setText("Registering shortcuts and protocols...")
        else:
            self.setup_status.setText("Finishing setup...")

    def _setup_done(self):
        self._setup_running = False
        self.btn_startstop.setEnabled(True)
        self.setup_progress.setValue(100)
        self.setup_status.setText("Setup complete.")
        self._append_log("Setup complete. Starting server...")
        # v1.2.0: refresh the Tools panel version readout now that the
        # binaries are (re)installed.
        self._refresh_tools_status()
        if not self.server_running:
            self._start_server()
        QTimer.singleShot(1400, self.setup_status.hide)
        QTimer.singleShot(1400, self.setup_progress.hide)

    def _setup_failed(self, error):
        self._setup_running = False
        self.btn_startstop.setEnabled(True)
        self.btn_startstop.setText("Start Server")
        self.setup_status.setText("Setup failed. Check the log for details.")
        self.setup_progress.hide()
        self._append_log(f"Setup error: {error}")

# ══════════════════════════════════════════════════════════════
# SINGLE INSTANCE GUARD
# ══════════════════════════════════════════════════════════════
def check_single_instance():
    """Prevent multiple GUI instances without relying on a TCP port."""
    if sys.platform == 'win32':
        try:
            import ctypes
            from ctypes import wintypes
            kernel32 = ctypes.WinDLL('kernel32', use_last_error=True)
            kernel32.CreateMutexW.argtypes = (wintypes.LPVOID, wintypes.BOOL, wintypes.LPCWSTR)
            kernel32.CreateMutexW.restype = wintypes.HANDLE
            kernel32.CloseHandle.argtypes = (wintypes.HANDLE,)
            handle = kernel32.CreateMutexW(None, False, "Local\\AstraDownloader.SingleInstance")
            if not handle:
                write_persistent_log(f"Single-instance mutex failed: {ctypes.get_last_error()}")
                return None
            if ctypes.get_last_error() == 183:  # ERROR_ALREADY_EXISTS
                kernel32.CloseHandle(handle)
                return None
            return handle
        except Exception as e:
            write_persistent_log(f"Mutex single-instance guard unavailable: {e}")

    # Cross-platform fallback for source runs outside Windows.
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

    if is_frozen_app():
        ensure_system_integrations(prefer_installed=True)

    # Single instance check
    lock = check_single_instance()
    if lock is None:
        # Already running
        write_persistent_log("Launch ignored because another instance is already running.")
        sys.exit(0)

    app = QApplication(sys.argv)
    app.setApplicationName(APP_NAME)
    app.setApplicationVersion(APP_VERSION)
    app.setFont(QFont("Segoe UI", 9))
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
    try:
        main()
    except Exception:
        log_crash("Fatal startup error")
        raise
