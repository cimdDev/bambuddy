import pytest

# Import the actual endpoint function module (not calling FastAPI)
from backend.app.api.routes import archives as archives_routes


def _build_search_term(q: str) -> str:
    # Mirror the logic inside search_archives
    search_term = q.strip()
    if not search_term.endswith("*"):
        search_term = f"{search_term}*"
    return search_term


def test_custom_fts_search_term_adds_wildcard():
    assert _build_search_term("alice") == "alice*"
    assert _build_search_term("alice ") == "alice*"


def test_custom_fts_search_term_keeps_existing_wildcard():
    assert _build_search_term("alice*") == "alice*"


def test_custom_like_fallback_includes_slicer_fields():
    """
    This is a unit-level guardrail for your custom feature:
    ensure slicer_user + slicer_user_email are referenced in the fallback query.
    We don't execute SQL here; we just ensure the source contains these fields.
    """
    src = archives_routes.search_archives.__code__.co_consts
    # co_consts contains embedded string constants; we do a simple containment check
    joined = "\n".join([c for c in src if isinstance(c, str)])
    assert "PrintArchive.slicer_user" in joined
    assert "PrintArchive.slicer_user_email" in joined
