import pytest


@pytest.mark.asyncio
@pytest.mark.integration
async def test_archives_search_finds_by_slicer_user(async_client, printer_factory, archive_factory):
    """
    Custom feature integration test:
    Ensure /archives/search can find an archive by slicer_user text.
    """
    printer = await printer_factory()

    # Control data: one should match, one should not
    await archive_factory(
        printer.id,
        print_name="Non matching",
        slicer_user="bob",
        slicer_user_email="bob@example.com",
        notes="nothing here",
    )
    await archive_factory(
        printer.id,
        print_name="Matching",
        slicer_user="alice",
        slicer_user_email="alice@example.com",
        notes="custom slicer metadata",
    )

    resp = await async_client.get("/api/v1/archives/search", params={"q": "alice"})
    assert resp.status_code == 200
    data = resp.json()
    assert isinstance(data, list)

    # Must return at least one result where slicer_user matches
    assert any(item.get("slicer_user") == "alice" for item in data)


@pytest.mark.asyncio
@pytest.mark.integration
async def test_archives_search_finds_by_slicer_user_email(async_client, printer_factory, archive_factory):
    """
    Custom feature integration test:
    Ensure /archives/search can find an archive by slicer_user_email text.
    """
    printer = await printer_factory()

    await archive_factory(
        printer.id,
        print_name="Email Match",
        slicer_user="someone",
        slicer_user_email="special.user@company.tld",
    )

    resp = await async_client.get("/api/v1/archives/search", params={"q": "special.user@company.tld"})
    assert resp.status_code == 200
    data = resp.json()
    assert any(item.get("slicer_user_email") == "special.user@company.tld" for item in data)
