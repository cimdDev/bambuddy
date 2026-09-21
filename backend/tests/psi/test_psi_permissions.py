"""``psi_accounting:read``: who may see the per-person accounting."""

import secrets

import pytest

from backend.app.core.permissions import ALL_PERMISSIONS, DEFAULT_GROUPS, PERMISSION_CATEGORIES
from backend.app.custom.psi.permissions import ACCOUNTING_READ, CATEGORY

pytestmark = pytest.mark.usefixtures("psi_schema")

_PW = "Aa1!" + secrets.token_urlsafe(12)  # pragma: allowlist secret


async def _admin_token(client) -> str:
    await client.post(
        "/api/v1/auth/setup", json={"auth_enabled": True, "admin_username": "psiadmin", "admin_password": _PW}
    )
    login = await client.post("/api/v1/auth/login", json={"username": "psiadmin", "password": _PW})
    return login.json()["access_token"]


async def _user_token(client, admin: str, username: str, permissions: list[str]) -> str:
    headers = {"Authorization": f"Bearer {admin}"}
    group = await client.post("/api/v1/groups/", headers=headers, json={"name": username, "permissions": permissions})
    assert group.status_code == 201, group.text
    user = await client.post(
        "/api/v1/users/",
        headers=headers,
        json={"username": username, "password": _PW, "role": "user", "group_ids": [group.json()["id"]]},
    )
    assert user.status_code == 201, user.text
    login = await client.post("/api/v1/auth/login", json={"username": username, "password": _PW})
    return login.json()["access_token"]


async def test_registered_in_upstreams_registry(async_client):  # noqa: ARG001 — the app registers it
    assert ACCOUNTING_READ in ALL_PERMISSIONS
    assert ALL_PERMISSIONS.count(ACCOUNTING_READ) == 1
    assert [p.value for p in PERMISSION_CATEGORIES[CATEGORY]] == [ACCOUNTING_READ]
    # Administrators get it from upstream's own ALL_PERMISSIONS seeding and sync.
    assert ACCOUNTING_READ in DEFAULT_GROUPS["Administrators"]["permissions"]
    assert ACCOUNTING_READ not in DEFAULT_GROUPS["Operators"]["permissions"]


async def test_group_editor_shows_the_psi_card(async_client):
    body = (await async_client.get("/api/v1/groups/permissions")).json()
    card = next(c for c in body["categories"] if c["name"] == CATEGORY)
    assert [p["value"] for p in card["permissions"]] == [ACCOUNTING_READ]
    assert "PSI accounting" in card["permissions"][0]["label"]


async def test_stats_readers_see_totals_but_no_people(async_client):
    admin = await _admin_token(async_client)
    token = await _user_token(async_client, admin, "statsonly", ["stats:read"])
    headers = {"Authorization": f"Bearer {token}"}

    summary = await async_client.get("/api/v1/psi/accounting", headers=headers)
    assert summary.status_code == 200
    assert summary.json()["users"] == []
    assert "totals" in summary.json()
    assert (await async_client.get("/api/v1/psi/accounting/runs", headers=headers)).status_code == 403
    assert (await async_client.get("/api/v1/psi/accounting/export", headers=headers)).status_code == 403


async def test_the_psi_permission_opens_the_personal_accounting(async_client, printer_factory, archive_factory):
    admin = await _admin_token(async_client)
    printer = await printer_factory()
    await archive_factory(printer.id)
    token = await _user_token(async_client, admin, "accountant", ["stats:read", ACCOUNTING_READ])

    for who in (token, admin):
        headers = {"Authorization": f"Bearer {who}"}
        summary = (await async_client.get("/api/v1/psi/accounting", headers=headers)).json()
        assert [u["key"] for u in summary["users"]] == ["__none__"]
        assert (await async_client.get("/api/v1/psi/accounting/runs", headers=headers)).status_code == 200
        assert (await async_client.get("/api/v1/psi/accounting/export", headers=headers)).status_code == 200
