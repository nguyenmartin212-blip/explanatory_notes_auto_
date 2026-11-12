from types import SimpleNamespace

from app.services.localization_service import pick_content

POI = SimpleNamespace(id=1, name_vi="Hội An", description_vi="Phố cổ Hội An rất đẹp.")


def loc(code, audio="ready"):
    return SimpleNamespace(
        lang_code=code, name=f"name-{code}", description=f"desc-{code}",
        audio_url=f"/static/audio/{code}.mp3", audio_status=audio,
    )


def test_exact_language():
    res = pick_content(POI, {(1, "ja"): loc("ja")}, "ja")
    assert res["lang"] == "ja" and res["is_fallback"] is False


def test_fallback_to_english():
    res = pick_content(POI, {(1, "en"): loc("en")}, "ko")
    assert res["lang"] == "en" and res["is_fallback"] is True


def test_fallback_to_vietnamese_original():
    res = pick_content(POI, {}, "ko")
    assert res["lang"] == "vi" and res["is_fallback"] is True
    assert res["name"] == "Hội An" and res["audio_url"] is None


def test_audio_hidden_until_ready():
    res = pick_content(POI, {(1, "en"): loc("en", audio="processing")}, "en")
    assert res["description"] == "desc-en" and res["audio_url"] is None
