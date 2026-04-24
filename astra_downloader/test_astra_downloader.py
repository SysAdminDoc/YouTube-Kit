import tempfile
import time
import unittest
from pathlib import Path

import astra_downloader as ad


class FakeConfig:
    def __init__(self, data=None):
        self.data = {
            "DownloadPath": str(Path(tempfile.gettempdir()) / "astra-downloader-tests"),
            "AudioDownloadPath": "",
            "ConcurrentFragments": 4,
            "EmbedMetadata": False,
            "EmbedThumbnail": False,
            "EmbedChapters": False,
            "EmbedSubs": False,
            "SponsorBlock": False,
            "DownloadArchive": False,
            "RateLimit": "",
            "Proxy": "",
        }
        if data:
            self.data.update(data)

    def get(self, key, default=None):
        return self.data.get(key, default)


class FakeHistory:
    def __init__(self):
        self.entries = []

    def add(self, entry):
        self.entries.append(entry)

    def load(self):
        return list(self.entries)


class NormalizationTests(unittest.TestCase):
    def test_normalize_url_rejects_invalid_or_ambiguous_values(self):
        for value in ("", "https://", "javascript:alert(1)", "https://exa mple.com"):
            with self.subTest(value=value):
                url, err = ad.normalize_url(value)
                self.assertIsNone(url)
                self.assertIsNotNone(err)

        url, err = ad.normalize_url("https://example.com/watch?v=abc")
        self.assertEqual(url, "https://example.com/watch?v=abc")
        self.assertIsNone(err)

    def test_normalize_url_rejects_overlong_values_without_truncating(self):
        value = "https://example.com/" + ("a" * 5000)
        url, err = ad.normalize_url(value)
        self.assertIsNone(url)
        self.assertEqual(err, "URL is too long to download safely.")

    def test_sanitize_config_clamps_and_normalizes_untrusted_values(self):
        cfg = ad.sanitize_config({
            "ServerPort": "999999",
            "ServerToken": "short",
            "ConcurrentFragments": "999",
            "RateLimit": "2m",
            "Proxy": "file:///tmp/nope",
            "EmbedMetadata": "false",
            "SubLangs": "en,es;<bad>",
        })
        self.assertEqual(cfg["ServerPort"], 65535)
        self.assertEqual(cfg["ConcurrentFragments"], 32)
        self.assertEqual(cfg["RateLimit"], "2M")
        self.assertEqual(cfg["Proxy"], "")
        self.assertFalse(cfg["EmbedMetadata"])
        self.assertEqual(cfg["SubLangs"], "en,esbad")
        self.assertGreaterEqual(len(cfg["ServerToken"]), 16)

    def test_output_directory_must_be_absolute(self):
        path, err = ad.normalize_output_dir("relative-folder")
        self.assertIsNone(path)
        self.assertEqual(err, "Choose an absolute output folder.")

    def test_output_directory_rejects_overlong_values(self):
        path, err = ad.normalize_output_dir("C:\\" + ("a" * 3000))
        self.assertIsNone(path)
        self.assertEqual(err, "Output folder path is too long.")


class PersistenceTests(unittest.TestCase):
    def test_history_load_backs_up_corrupt_json(self):
        with tempfile.TemporaryDirectory() as tmp:
            original = ad.HISTORY_PATH
            try:
                ad.HISTORY_PATH = Path(tmp) / "history.json"
                ad.HISTORY_PATH.write_text("{not-json", encoding="utf-8")
                history = ad.History()
                self.assertEqual(history.load(), [])
                backups = list(Path(tmp).glob("history.json.corrupt-*"))
                self.assertEqual(len(backups), 1)
            finally:
                ad.HISTORY_PATH = original


class DownloadManagerTests(unittest.TestCase):
    def test_queued_downloads_count_toward_concurrency_limit(self):
        manager = ad.DownloadManager(FakeConfig(), FakeHistory())

        def hold_queued(_download):
            time.sleep(0.2)

        manager._run_download = hold_queued

        ids = []
        for i in range(ad.MAX_CONCURRENT):
            dl_id, err = manager.start_download(f"https://example.com/{i}")
            self.assertIsNone(err)
            ids.append(dl_id)

        dl_id, err = manager.start_download("https://example.com/overflow")
        self.assertIsNone(dl_id)
        self.assertIn("limit", err.lower())
        self.assertEqual(manager.active_count(), ad.MAX_CONCURRENT)

    def test_cancel_does_not_relabel_completed_downloads(self):
        manager = ad.DownloadManager(FakeConfig(), FakeHistory())
        dl = ad.Download("done", "https://example.com/done")
        dl.status = "complete"
        manager.downloads[dl.id] = dl

        self.assertFalse(manager.cancel(dl.id))
        self.assertEqual(dl.status, "complete")


class ApiSecurityTests(unittest.TestCase):
    def test_health_advertises_service_identity(self):
        config = FakeConfig({"ServerToken": "a" * 32})
        manager = ad.DownloadManager(config, FakeHistory())
        api = ad.create_api(config, manager, FakeHistory())
        resp = api.test_client().get("/health", headers={"X-MDL-Client": "MediaDL"})
        body = resp.get_json()

        self.assertEqual(body["service"], ad.SERVICE_ID)
        self.assertEqual(body["api"], ad.SERVICE_API_VERSION)
        self.assertTrue(body["token_required"])
        self.assertEqual(body["token"], "a" * 32)

    def test_health_token_is_not_exposed_to_null_origin_pages(self):
        config = FakeConfig({"ServerToken": "a" * 32})
        manager = ad.DownloadManager(config, FakeHistory())
        api = ad.create_api(config, manager, FakeHistory())
        client = api.test_client()

        null_origin = client.get("/health", headers={
            "Origin": "null",
            "X-MDL-Client": "MediaDL",
        })
        self.assertNotIn("Access-Control-Allow-Origin", null_origin.headers)
        self.assertNotIn("token", null_origin.get_json())

        extension_origin = "chrome-extension://abcdefghijklmnop"
        extension_resp = client.get("/health", headers={
            "Origin": extension_origin,
            "X-MDL-Client": "MediaDL",
        })
        self.assertEqual(extension_resp.headers.get("Access-Control-Allow-Origin"), extension_origin)
        self.assertEqual(extension_resp.get_json()["token"], "a" * 32)

        background_resp = client.get("/health", headers={"X-MDL-Client": "MediaDL"})
        self.assertEqual(background_resp.get_json()["token"], "a" * 32)

    def test_download_rejects_non_object_json_body(self):
        token = "c" * 32
        config = FakeConfig({"ServerToken": token})
        manager = ad.DownloadManager(config, FakeHistory())
        api = ad.create_api(config, manager, FakeHistory())
        resp = api.test_client().post(
            "/download",
            json=["https://example.com/video"],
            headers={"X-Auth-Token": token},
        )

        self.assertEqual(resp.status_code, 400)
        self.assertEqual(resp.get_json()["error"], "Missing download URL.")

    def test_history_limit_is_clamped(self):
        token = "d" * 32
        history = FakeHistory()
        history.entries = [{"id": str(i), "url": "https://example.com", "title": str(i)} for i in range(3)]
        config = FakeConfig({"ServerToken": token})
        manager = ad.DownloadManager(config, history)
        api = ad.create_api(config, manager, history)

        resp = api.test_client().get("/history?limit=-5", headers={"X-Auth-Token": token})

        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.get_json()["count"], 1)

    def test_cancel_finished_download_returns_conflict_not_not_found(self):
        token = "b" * 32
        config = FakeConfig({"ServerToken": token})
        manager = ad.DownloadManager(config, FakeHistory())
        dl = ad.Download("done", "https://example.com/done")
        dl.status = "complete"
        manager.downloads[dl.id] = dl
        api = ad.create_api(config, manager, FakeHistory())
        resp = api.test_client().delete(f"/cancel/{dl.id}", headers={"X-Auth-Token": token})

        self.assertEqual(resp.status_code, 409)
        self.assertIn("already finished", resp.get_json()["error"])

    def test_dns_rebinding_attack_is_rejected_before_handler(self):
        """Verify Host-header validation blocks DNS rebinding to attacker-controlled domains."""
        token = "e" * 32
        config = FakeConfig({"ServerToken": token})
        manager = ad.DownloadManager(config, FakeHistory())
        api = ad.create_api(config, manager, FakeHistory())
        client = api.test_client()

        # Simulate a DNS-rebinding attack: the browser resolved attacker.com
        # to 127.0.0.1 after the page loaded, but it still sends the attacker
        # hostname in the Host header. Legitimate local clients always send
        # 127.0.0.1 / localhost / ::1.
        for bad_host in ("attacker.com", "attacker.com:9751", "example.org:80"):
            with self.subTest(host=bad_host):
                resp = client.get(
                    "/health",
                    headers={"Host": bad_host, "X-MDL-Client": "MediaDL"},
                )
                self.assertEqual(resp.status_code, 421, f"Expected 421 Misdirected Request for Host={bad_host}")
                self.assertIn("Invalid Host", resp.get_json().get("error", ""))

        for good_host in ("127.0.0.1:9751", "localhost:9751", "[::1]:9751"):
            with self.subTest(host=good_host):
                resp = client.get(
                    "/health",
                    headers={"Host": good_host, "X-MDL-Client": "MediaDL"},
                )
                self.assertEqual(resp.status_code, 200, f"Expected 200 for Host={good_host}")

    def test_bootstrap_surfaces_failure_to_stderr(self):
        """Verify _bootstrap writes a helpful message to stderr when pip is unreachable."""
        import io
        import unittest.mock as mock
        # Only run if running from source (frozen exe skips bootstrap entirely)
        buf = io.StringIO()
        with mock.patch.object(ad, "subprocess") as fake_subproc, \
             mock.patch.object(ad.sys, "stderr", buf), \
             mock.patch.object(ad.os.environ, "get", return_value=None), \
             mock.patch.object(ad.sys, "frozen", False, create=True):
            # Force each install strategy to report that pip is not on PATH
            fake_subproc.check_call.side_effect = FileNotFoundError(2, "No such file", "pip")
            # Force the import check to report every dependency as missing
            with mock.patch("builtins.__import__", side_effect=ImportError):
                ad._bootstrap()
        stderr = buf.getvalue()
        self.assertIn("Failed to auto-install", stderr)
        self.assertIn("pip install", stderr)


class CookieJarTests(unittest.TestCase):
    """Audit-pass coverage for write_cookies_netscape.

    The extension pushes Chrome cookie objects into the server's /download
    request and yt-dlp needs them in Netscape cookies.txt format. Regressing
    the converter would silently break logged-in/age-gated downloads, so each
    behaviour below is locked down by a dedicated test.
    """

    def _read(self, path):
        with open(path, "r", encoding="utf-8") as fh:
            return fh.read()

    def test_returns_none_for_empty_or_invalid_input(self):
        with tempfile.TemporaryDirectory() as tmp:
            target = Path(tmp) / "cookies.txt"
            self.assertIsNone(ad.write_cookies_netscape(None, target))
            self.assertIsNone(ad.write_cookies_netscape([], target))
            self.assertIsNone(ad.write_cookies_netscape("not a list", target))
            # All entries invalid (missing name/domain) → no jar written.
            self.assertIsNone(ad.write_cookies_netscape(
                [{"name": ""}, {"domain": ".youtube.com"}],
                target,
            ))
            self.assertFalse(target.exists())

    def test_writes_netscape_format_with_httponly_prefix(self):
        with tempfile.TemporaryDirectory() as tmp:
            target = Path(tmp) / "cookies.txt"
            cookies = [
                {
                    "domain": ".youtube.com", "name": "SID", "value": "abc",
                    "path": "/", "secure": True, "httpOnly": True,
                    "expirationDate": 1700000000,
                },
                {
                    "domain": "youtube.com", "name": "PREF", "value": "tz=UTC",
                    "path": "/", "secure": False, "httpOnly": False,
                    # Session cookie (no expirationDate) — must serialize as 0
                    "expirationDate": None,
                },
            ]
            result = ad.write_cookies_netscape(cookies, target)
            self.assertEqual(result, str(target))
            body = self._read(target)
            self.assertIn("# Netscape HTTP Cookie File", body)
            # httpOnly cookie gets the #HttpOnly_ prefix yt-dlp expects.
            self.assertIn("#HttpOnly_.youtube.com\tTRUE\t/\tTRUE\t1700000000\tSID\tabc", body)
            self.assertIn("youtube.com\tFALSE\t/\tFALSE\t0\tPREF\ttz=UTC", body)

    def test_strips_control_chars_that_would_corrupt_tsv(self):
        with tempfile.TemporaryDirectory() as tmp:
            target = Path(tmp) / "cookies.txt"
            cookies = [
                # Tabs/newlines in a value would shift columns in the TSV and
                # make yt-dlp fail to parse the jar. Control-char stripping
                # produces a well-formed single-line value.
                {"domain": ".youtube.com", "name": "X", "value": "a\tb\nc"},
                {"domain": ".youtube.com", "name": "Y", "value": "ok"},
            ]
            self.assertEqual(ad.write_cookies_netscape(cookies, target), str(target))
            body = self._read(target)
            # The line for X must end with a clean value containing no raw
            # tabs or newlines beyond the column separator.
            x_line = [line for line in body.splitlines() if "\tX\t" in line][0]
            self.assertTrue(x_line.endswith("abc"))
            self.assertEqual(x_line.count("\t"), 6)  # 7 columns → 6 separators
            self.assertIn("Y\tok", body)

    def test_rejects_malformed_expiration_without_failing_whole_jar(self):
        with tempfile.TemporaryDirectory() as tmp:
            target = Path(tmp) / "cookies.txt"
            cookies = [
                {"domain": ".youtube.com", "name": "A", "value": "a", "expirationDate": "bogus"},
                {"domain": ".youtube.com", "name": "B", "value": "b", "expirationDate": -42},
                {"domain": ".youtube.com", "name": "C", "value": "c", "expirationDate": 100},
            ]
            self.assertEqual(ad.write_cookies_netscape(cookies, target), str(target))
            body = self._read(target)
            self.assertIn("\tA\ta", body)  # bogus → 0
            self.assertIn("\t0\tA\ta", body)
            self.assertIn("\t0\tB\tb", body)  # negative → 0
            self.assertIn("\t100\tC\tc", body)


class PathConfinementTests(unittest.TestCase):
    """v1.2.0 S1 — outputDir allowlist.

    The server accepts a client-supplied `outputDir` on /download. Before
    v1.2.0 it only checked that the path was absolute — a compromised
    extension could write anywhere the server user had access to. These
    tests lock down the rejection path and the permissive subfolder path.
    """

    def test_confinement_accepts_subfolder_of_allowed_root(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "downloads"
            root.mkdir()
            subfolder = root / "channel-a" / "2026"
            out, err = ad.normalize_output_dir(
                str(subfolder),
                default_dir=str(root),
                allowed_roots=[root.resolve()],
            )
            self.assertIsNone(err)
            self.assertTrue(Path(out).resolve() == subfolder.resolve())
            self.assertTrue(subfolder.exists())

    def test_confinement_rejects_path_outside_allowed_roots(self):
        with tempfile.TemporaryDirectory() as allowed_tmp, tempfile.TemporaryDirectory() as forbidden_tmp:
            allowed_root = Path(allowed_tmp).resolve()
            forbidden = Path(forbidden_tmp) / "escape" / "target"
            out, err = ad.normalize_output_dir(
                str(forbidden),
                default_dir=str(allowed_root),
                allowed_roots=[allowed_root],
            )
            self.assertIsNone(out)
            self.assertEqual(err, "Output folder is outside the configured download locations.")
            # Critical: confinement must reject BEFORE mkdir; a rejected
            # request should not create the forbidden directory.
            self.assertFalse(forbidden.exists())

    def test_confinement_rejects_parent_traversal(self):
        with tempfile.TemporaryDirectory() as tmp:
            allowed_root = Path(tmp) / "downloads"
            allowed_root.mkdir()
            # .. traversal: resolve() normalizes before the check.
            traversal = str(allowed_root / ".." / ".." / "somewhere")
            out, err = ad.normalize_output_dir(
                traversal,
                default_dir=str(allowed_root),
                allowed_roots=[allowed_root.resolve()],
            )
            self.assertIsNone(out)
            self.assertEqual(err, "Output folder is outside the configured download locations.")

    def test_allowed_output_roots_dedupes_and_resolves(self):
        with tempfile.TemporaryDirectory() as tmp:
            video = Path(tmp) / "videos"
            audio = Path(tmp) / "audio"
            video.mkdir()
            audio.mkdir()

            class _Cfg:
                def get(self, key, default=None):
                    return {
                        "DownloadPath": str(video),
                        # Same dir under DownloadPath and ExtraOutputRoots
                        # must collapse in the final list.
                        "AudioDownloadPath": str(video),
                        "ExtraOutputRoots": [str(audio), str(audio)],
                    }.get(key, default)

            roots = ad.allowed_output_roots(_Cfg())
            resolved_video = video.resolve()
            resolved_audio = audio.resolve()
            self.assertIn(resolved_video, roots)
            self.assertIn(resolved_audio, roots)
            self.assertEqual(len(roots), 2)


class RateLimiterTests(unittest.TestCase):
    """v1.2.0 S2 — sliding-window rate limit on /download."""

    def test_allows_up_to_max_events_then_rejects(self):
        limiter = ad.RateLimiter(max_events=3, window_seconds=60)
        for _ in range(3):
            allowed, retry = limiter.allow('download')
            self.assertTrue(allowed)
            self.assertEqual(retry, 0.0)
        allowed, retry = limiter.allow('download')
        self.assertFalse(allowed)
        self.assertGreater(retry, 0.0)

    def test_separate_bucket_keys_are_independent(self):
        limiter = ad.RateLimiter(max_events=1, window_seconds=60)
        self.assertTrue(limiter.allow('a')[0])
        # Second call to 'a' rejected, but 'b' gets its own budget.
        self.assertFalse(limiter.allow('a')[0])
        self.assertTrue(limiter.allow('b')[0])


class Sha256VerifyTests(unittest.TestCase):
    """v1.2.0 S3 — binary integrity verification for yt-dlp/ffmpeg."""

    def test_verify_accepts_matching_hash(self):
        import hashlib
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "bin.exe"
            path.write_bytes(b"hello world")
            expected = hashlib.sha256(b"hello world").hexdigest()
            self.assertTrue(ad.verify_file_sha256(path, expected))

    def test_verify_raises_on_mismatch(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "bin.exe"
            path.write_bytes(b"tampered bytes")
            wrong = "0" * 64
            with self.assertRaises(RuntimeError) as ctx:
                ad.verify_file_sha256(path, wrong)
            self.assertIn("SHA-256 mismatch", str(ctx.exception))

    def test_verify_returns_false_on_missing_or_malformed_sidecar(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "bin.exe"
            path.write_bytes(b"hi")
            self.assertFalse(ad.verify_file_sha256(path, None))
            self.assertFalse(ad.verify_file_sha256(path, ""))
            self.assertFalse(ad.verify_file_sha256(path, "not-a-hash"))

    def test_parse_sha256_sums_with_multiple_assets(self):
        doc = (
            "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa  yt-dlp.exe\n"
            "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb  yt-dlp\n"
            "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc  yt-dlp_macos\n"
        )
        self.assertEqual(
            ad._parse_sha256_sums(doc, target_asset="yt-dlp.exe"),
            "a" * 64,
        )

    def test_parse_sha256_sums_accepts_single_line_sidecar(self):
        digest = "d" * 64
        self.assertEqual(ad._parse_sha256_sums(f"{digest}\n"), digest)


class CookieJarSweepTests(unittest.TestCase):
    """v1.2.0 S4 — orphaned .cookies.*.txt cleanup on server start.

    When the downloader is killed mid-run (power loss, taskkill /F), session
    cookies leak into INSTALL_DIR. A stale sweep on DownloadManager init
    keeps session cookies from outliving the process that needed them.
    """

    def test_cleanup_removes_old_cookie_jars_and_spares_fresh_ones(self):
        with tempfile.TemporaryDirectory() as tmp:
            install_dir = Path(tmp)
            original = ad.INSTALL_DIR
            try:
                ad.INSTALL_DIR = install_dir
                stale = install_dir / ".cookies.abc123.txt"
                fresh = install_dir / ".cookies.def456.txt"
                unrelated = install_dir / "config.json"
                stale.write_text("stale", encoding="utf-8")
                fresh.write_text("fresh", encoding="utf-8")
                unrelated.write_text("{}", encoding="utf-8")
                # Backdate the stale entry to beyond the cleanup horizon.
                old_mtime = time.time() - 3600
                import os as _os
                _os.utime(stale, (old_mtime, old_mtime))
                ad.cleanup_stale_cookie_jars(older_than_seconds=300)
                self.assertFalse(stale.exists(), "stale cookie jar should be removed")
                self.assertTrue(fresh.exists(), "fresh cookie jar should be preserved")
                self.assertTrue(unrelated.exists(), "non-cookie files must not be touched")
            finally:
                ad.INSTALL_DIR = original


class ApiRateLimitTests(unittest.TestCase):
    """End-to-end /download rate limit via the Flask test client."""

    def test_download_endpoint_returns_429_after_burst(self):
        token = "f" * 32
        config = FakeConfig({"ServerToken": token})
        manager = ad.DownloadManager(config, FakeHistory())
        api = ad.create_api(config, manager, FakeHistory())
        client = api.test_client()

        # Force a low limit so we can exhaust it without actually starting
        # 30 real downloads (which would be blocked by MAX_CONCURRENT first).
        # We replicate the burst at the HTTP layer by patching the limiter
        # state after construction.
        # Simpler: send many OPTIONS-bypassed requests with invalid bodies.
        # The rate check runs after auth but BEFORE body parsing, so a
        # missing body still consumes a token.
        saw_429 = False
        for _ in range(ad.RATE_LIMIT_DOWNLOAD_MAX + 2):
            resp = client.post(
                "/download",
                headers={"X-Auth-Token": token, "Content-Type": "application/json"},
                data="{}",
            )
            if resp.status_code == 429:
                saw_429 = True
                self.assertIn("Retry-After", resp.headers)
                break
        self.assertTrue(saw_429, "rate limiter should reject eventually")


class CorsHeaderTests(unittest.TestCase):
    def test_response_advertises_max_age(self):
        token = "g" * 32
        config = FakeConfig({"ServerToken": token})
        manager = ad.DownloadManager(config, FakeHistory())
        api = ad.create_api(config, manager, FakeHistory())
        resp = api.test_client().get("/health", headers={"X-MDL-Client": "MediaDL"})
        self.assertEqual(resp.headers.get("Access-Control-Max-Age"), str(ad.CORS_MAX_AGE_SECONDS))


class HealthAdditionsTests(unittest.TestCase):
    """v1.2.0 additions to /health schema — version strings + rate-limit policy."""

    def test_health_surface_includes_rate_limit_policy(self):
        token = "h" * 32
        config = FakeConfig({"ServerToken": token})
        manager = ad.DownloadManager(config, FakeHistory())
        api = ad.create_api(config, manager, FakeHistory())
        resp = api.test_client().get("/health", headers={"X-MDL-Client": "MediaDL"})
        body = resp.get_json()
        self.assertIn("rateLimit", body)
        self.assertEqual(body["rateLimit"]["downloadMaxPerWindow"], ad.RATE_LIMIT_DOWNLOAD_MAX)
        self.assertEqual(body["rateLimit"]["downloadWindowSeconds"], ad.RATE_LIMIT_DOWNLOAD_WINDOW_SECONDS)
        # ytDlpVersion / ffmpegVersion are present but may be None in CI; the
        # wire contract is "key exists, value is string or null" — assert both.
        self.assertIn("ytDlpVersion", body)
        self.assertIn("ffmpegVersion", body)


class AutoUpdateThrottleTests(unittest.TestCase):
    """v1.2.0 B3 — yt-dlp auto-update runs at most once per 24h."""

    def test_should_check_returns_true_with_no_prior_stamp(self):
        class _C:
            def get(self, key, default=None):
                return "" if key == "LastYtDlpUpdateCheck" else default
        self.assertTrue(ad.should_check_ytdlp_update(_C()))

    def test_should_check_returns_false_with_recent_stamp(self):
        recent = (ad.datetime.now() - ad.datetime.now().__class__.min.__class__.min.__class__.resolution).strftime("%Y-%m-%d %H:%M:%S")
        # Simpler form: use "now" as the stamp.
        import datetime as _dt
        recent = _dt.datetime.now().strftime("%Y-%m-%d %H:%M:%S")

        class _C:
            def get(self, key, default=None):
                return recent if key == "LastYtDlpUpdateCheck" else default
        self.assertFalse(ad.should_check_ytdlp_update(_C()))

    def test_should_check_handles_corrupt_stamp(self):
        class _C:
            def get(self, key, default=None):
                return "not-a-date" if key == "LastYtDlpUpdateCheck" else default
        # Malformed stamps should not wedge the update path — default to True
        # so the next launch can re-establish a valid stamp.
        self.assertTrue(ad.should_check_ytdlp_update(_C()))


if __name__ == "__main__":
    unittest.main()
