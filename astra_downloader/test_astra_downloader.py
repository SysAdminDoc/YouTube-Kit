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


if __name__ == "__main__":
    unittest.main()
