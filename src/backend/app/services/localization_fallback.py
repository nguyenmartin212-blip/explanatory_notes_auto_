"""Localization rules: fallback order, narration text and audio validity.

Fallback order (Chapter 05): requested language -> English -> Vietnamese.
A whole localization is picked (never mixed field by field) so the text and
the audio the client plays are always in the same language.
"""

from __future__ import annotations

import hashlib

FALLBACK_TAIL = ("en", "vi")


def fallback_chain(requested: str | None) -> list[str]:
    chain: list[str] = []
    for language in (requested, *FALLBACK_TAIL):
        if language and language not in chain:
            chain.append(language)
    return chain


def narration_text(loc: dict) -> str:
    """Text the audio is generated from: tts_script, else the description."""
    return ((loc.get("tts_script") or "").strip() or (loc.get("description") or "").strip())


def compute_content_hash(language: str, text: str) -> str:
    return hashlib.sha256(f"{language}\n{text}".encode("utf-8")).hexdigest()


def is_usable(loc: dict | None) -> bool:
    """A localization can be shown to users only with a name and a description."""
    return bool(loc and (loc.get("name") or "").strip() and (loc.get("description") or "").strip())


def has_valid_audio(loc: dict | None) -> bool:
    """Audio is valid only if it is ready and was generated from the current text."""
    return bool(
        loc
        and loc.get("audio_status") == "ready"
        and loc.get("audio_url")
        and loc.get("audio_hash")
        and loc.get("audio_hash") == loc.get("content_hash")
    )


def public_localization(loc: dict) -> dict:
    return {
        "name": loc.get("name", ""),
        "description": loc.get("description", ""),
        "tts_script": loc.get("tts_script"),
        "audio_url": loc.get("audio_url") if has_valid_audio(loc) else None,
    }


def resolve_content(localizations: dict[str, dict], requested: str | None) -> dict | None:
    """Pick the localization to serve: requested -> en -> vi. None if none is usable."""
    for language in fallback_chain(requested):
        loc = localizations.get(language)
        if is_usable(loc):
            return {
                "language_requested": requested,
                "language_served": language,
                "fallback": bool(requested) and language != requested,
                **public_localization(loc),
            }
    return None
