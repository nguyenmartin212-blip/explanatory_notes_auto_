"""Pure-logic tests for Chapter 05 (run with: python -m unittest)."""

import base64
import unittest

from pydantic import ValidationError

from app.schemas.content import DEFAULT_RADIUS_METERS, PoiCreate, PoiUpdate
from app.services.localization_fallback import (
    compute_content_hash,
    fallback_chain,
    has_valid_audio,
    narration_text,
    resolve_content,
)
from app.services.poi_sync import decode_cursor, encode_cursor, etag_matches, make_etag
from app.utils.geo import haversine_m


class HaversineTests(unittest.TestCase):
    def test_zero_distance(self):
        self.assertEqual(haversine_m(21.0, 105.8, 21.0, 105.8), 0.0)

    def test_hanoi_to_ho_chi_minh_city(self):
        d = haversine_m(21.0353, 105.8402, 10.7721, 106.6983)
        self.assertTrue(1_100_000 < d < 1_200_000, d)

    def test_one_degree_of_latitude(self):
        self.assertAlmostEqual(haversine_m(0, 0, 1, 0), 111_195, delta=300)


def loc(name="N", description="D", **extra):
    base = {"name": name, "description": description}
    base.update(extra)
    return base


class FallbackTests(unittest.TestCase):
    def test_chain_order(self):
        self.assertEqual(fallback_chain("zh"), ["zh", "en", "vi"])
        self.assertEqual(fallback_chain("en"), ["en", "vi"])
        self.assertEqual(fallback_chain("vi"), ["vi", "en"])
        self.assertEqual(fallback_chain(None), ["en", "vi"])

    def test_requested_language_wins(self):
        r = resolve_content({"zh": loc("中"), "en": loc("EN"), "vi": loc("VI")}, "zh")
        self.assertEqual((r["language_served"], r["name"], r["fallback"]), ("zh", "中", False))

    def test_falls_back_to_english_then_vietnamese(self):
        r = resolve_content({"en": loc("EN"), "vi": loc("VI")}, "ko")
        self.assertEqual((r["language_served"], r["fallback"]), ("en", True))
        r = resolve_content({"vi": loc("VI")}, "ko")
        self.assertEqual(r["language_served"], "vi")

    def test_unusable_localization_is_skipped(self):
        # English has a name but no description -> not usable -> Vietnamese
        r = resolve_content({"en": loc("EN", ""), "vi": loc("VI")}, "zh")
        self.assertEqual(r["language_served"], "vi")
        self.assertIsNone(resolve_content({"en": loc("EN", "")}, "zh"))
        self.assertIsNone(resolve_content({}, "en"))

    def test_narration_text_prefers_tts_script(self):
        self.assertEqual(narration_text({"tts_script": " script ", "description": "d"}), "script")
        self.assertEqual(narration_text({"tts_script": "  ", "description": " d "}), "d")
        self.assertEqual(narration_text({}), "")

    def test_audio_is_valid_only_for_current_text(self):
        h = compute_content_hash("en", "text")
        ok = {"audio_status": "ready", "audio_url": "u", "audio_hash": h, "content_hash": h}
        self.assertTrue(has_valid_audio(ok))
        self.assertFalse(has_valid_audio({**ok, "content_hash": "other"}))
        self.assertFalse(has_valid_audio({**ok, "audio_status": "pending"}))
        self.assertFalse(has_valid_audio({**ok, "audio_url": None}))
        self.assertNotEqual(compute_content_hash("en", "x"), compute_content_hash("vi", "x"))

    def test_public_audio_url_hidden_when_stale(self):
        h = compute_content_hash("en", "t")
        stale = loc("EN", audio_status="ready", audio_url="u", audio_hash="old", content_hash=h)
        self.assertIsNone(resolve_content({"en": stale}, "en")["audio_url"])


class SyncHelperTests(unittest.TestCase):
    def test_cursor_round_trip(self):
        for version in (0, 1, 12345):
            self.assertEqual(decode_cursor(encode_cursor(version)), version)

    def test_invalid_cursors(self):
        bad_json = base64.urlsafe_b64encode(b'{"c":1,"v":-3}').decode()
        wrong_format = base64.urlsafe_b64encode(b'{"c":9,"v":3}').decode()
        for token in (None, "", "abc", "!!!", bad_json, wrong_format):
            self.assertIsNone(decode_cursor(token), token)

    def test_etag_matching(self):
        etag = make_etag(7, "vi")
        self.assertEqual(etag, 'W/"7-vi"')
        self.assertTrue(etag_matches('W/"7-vi"', etag))
        self.assertTrue(etag_matches('"7-vi"', etag))
        self.assertTrue(etag_matches('"1-vi", W/"7-vi"', etag))
        self.assertTrue(etag_matches("*", etag))
        self.assertFalse(etag_matches('W/"6-vi"', etag))
        self.assertFalse(etag_matches('W/"7-en"', etag))
        self.assertFalse(etag_matches(None, etag))
        self.assertEqual(make_etag(0, None), 'W/"0-all"')


class SchemaTests(unittest.TestCase):
    def test_default_radius_matches_fe(self):
        # FE: DEFAULT_GEOFENCE_RADIUS_METERS (src/constants/app.ts)
        self.assertEqual(DEFAULT_RADIUS_METERS, 80)
        self.assertEqual(PoiCreate(latitude=21.0, longitude=105.8).radius_meters, 80)

    def test_rejects_bad_input(self):
        with self.assertRaises(ValidationError):
            PoiCreate(latitude=91, longitude=0)
        with self.assertRaises(ValidationError):
            PoiCreate(latitude=0, longitude=0, poi_id="Bad Id")
        with self.assertRaises(ValidationError):
            PoiCreate(latitude=0, longitude=0, localizations={"fr": {"name": "x"}})
        with self.assertRaises(ValidationError):
            PoiCreate(latitude=0, longitude=0, localizations={"en": {"name": ""}})

    def test_update_only_tracks_sent_fields(self):
        u = PoiUpdate(radius_meters=50)
        self.assertEqual(u.model_fields_set, {"radius_meters"})
        self.assertIsNone(u.latitude)


if __name__ == "__main__":
    unittest.main()
