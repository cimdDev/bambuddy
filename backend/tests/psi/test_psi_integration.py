"""PSI layer end to end: migrations, run hook, card data, edits, accounting."""

from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import select, text, update

from backend.app.custom.psi.tables import archives, library, queue, runs
from backend.app.models.archive import PrintArchive
from backend.app.models.library import LibraryFile
from backend.app.models.print_queue import PrintQueueItem
from backend.app.services.print_log import write_log_entry

pytestmark = pytest.mark.usefixtures("psi_schema")


async def _set(db, table, record_id, **values):
    await db.execute(update(table).where(table.c.id == record_id).values(**values))
    await db.commit()


async def _get(db, table, record_id):
    return (await db.execute(select(table).where(table.c.id == record_id))).one()


async def _queue_item(db, **kwargs) -> PrintQueueItem:
    item = PrintQueueItem(status=kwargs.pop("status", "pending"), position=0, **kwargs)
    db.add(item)
    await db.commit()
    await db.refresh(item)
    return item


async def _library_file(db, file_path="archive/library/files/a.3mf", **kwargs) -> LibraryFile:
    lib = LibraryFile(filename="a.3mf", file_path=file_path, file_type="3mf", file_size=10, **kwargs)
    db.add(lib)
    await db.commit()
    await db.refresh(lib)
    return lib


async def _run(db, archive_id, queue_item_id=None, *, grams=10.0, cost=1.0, seconds=3600, status="completed"):
    started = datetime(2026, 9, 1, 8, 0, tzinfo=timezone.utc)
    entry = await write_log_entry(
        db,
        status=status,
        archive_id=archive_id,
        queue_item_id=queue_item_id,
        started_at=started,
        completed_at=started + timedelta(seconds=seconds),
        filament_used_grams=grams,
        cost=cost,
        printer_id=None,
    )
    await db.commit()
    return entry


# ---------------------------------------------------------------- migrations


class TestLegacyCarryOver:
    async def test_earlier_builds_data_is_carried_over(self, db_session, test_engine, printer_factory, archive_factory):
        from backend.app.custom.migrations import run_custom_migrations

        async with test_engine.begin() as conn:
            for table_name in ("print_archives", "print_queue"):
                for col in ("private_job", "private_material", "private_material_partial"):
                    await conn.execute(text(f"ALTER TABLE {table_name} ADD COLUMN {col} BOOLEAN DEFAULT 0"))
            await conn.execute(text("ALTER TABLE print_queue ADD COLUMN comment TEXT"))
            await conn.execute(text("ALTER TABLE library_files ADD COLUMN private_job BOOLEAN DEFAULT 0"))

        printer = await printer_factory()
        own = await archive_factory(printer.id, with_run=False)
        partial = await archive_factory(printer.id, with_run=False)
        company = await archive_factory(printer.id, with_run=False)
        item = await _queue_item(db_session)
        lib = await _library_file(db_session, file_metadata={"slicer_user": " alice ", "print_name": "x"})
        await db_session.execute(
            text("UPDATE print_archives SET private_job=1, private_material=1, private_material_partial=1 WHERE id=:i"),
            {"i": own.id},
        )
        await db_session.execute(
            text("UPDATE print_archives SET private_job=1, private_material_partial=1 WHERE id=:i"), {"i": partial.id}
        )
        await db_session.execute(
            text("UPDATE print_queue SET private_job=1, comment='  bring it  ' WHERE id=:i"), {"i": item.id}
        )
        await db_session.execute(text("UPDATE library_files SET private_job=1 WHERE id=:i"), {"i": lib.id})
        await db_session.commit()

        assert await run_custom_migrations(engine=test_engine)
        assert await run_custom_migrations(engine=test_engine)  # idempotent

        assert (await _get(db_session, archives, own.id)).psi_class == "private_own"
        assert (await _get(db_session, archives, partial.id)).psi_class == "private_partial"
        assert (await _get(db_session, archives, company.id)).psi_class is None
        q = await _get(db_session, queue, item.id)
        assert (q.psi_class, q.psi_notes) == ("private", "bring it")
        lib_row = await _get(db_session, library, lib.id)
        assert (lib_row.psi_class, lib_row.slicer_user) == ("private", "alice")
        assert lib_row.psi_user_checked  # kept, not re-read over

    async def test_existing_runs_get_classified(self, db_session, test_engine, printer_factory, archive_factory):
        from backend.app.custom.migrations import run_custom_migrations

        printer = await printer_factory()
        archive = await archive_factory(printer.id)  # its run is written before the class is set
        await _set(db_session, archives, archive.id, psi_class="private")
        await db_session.execute(update(runs).values(psi_class=None))
        await db_session.commit()

        assert await run_custom_migrations(engine=test_engine)
        classes = (await db_session.execute(select(runs.c.psi_class).where(runs.c.archive_id == archive.id))).scalars()
        assert list(classes) == ["private"]


# ------------------------------------------------------------------ run hook


class TestRunHook:
    async def test_a_queue_run_takes_the_items_class_and_hands_it_to_the_archive(
        self, db_session, printer_factory, archive_factory
    ):
        printer = await printer_factory()
        archive = await archive_factory(printer.id, with_run=False)
        item = await _queue_item(db_session, archive_id=archive.id, status="printing")
        await _set(db_session, queue, item.id, psi_class="private_partial", psi_notes="for my bike")

        entry = await _run(db_session, archive.id, item.id)

        assert (await _get(db_session, runs, entry.id)).psi_class == "private_partial"
        arc = await _get(db_session, archives, archive.id)
        assert (arc.psi_class, arc.notes) == ("private_partial", "for my bike")

    async def test_an_archives_own_note_is_never_overwritten(self, db_session, printer_factory, archive_factory):
        printer = await printer_factory()
        archive = await archive_factory(printer.id, with_run=False, notes="archive note")
        item = await _queue_item(db_session, archive_id=archive.id, status="printing")
        await _set(db_session, queue, item.id, psi_notes="queue note")

        await _run(db_session, archive.id, item.id)
        assert (await _get(db_session, archives, archive.id)).notes == "archive note"

    async def test_a_queue_item_inherits_from_its_library_file(self, db_session, printer_factory, archive_factory):
        printer = await printer_factory()
        lib = await _library_file(db_session)
        await _set(db_session, library, lib.id, psi_class="private_own")
        archive = await archive_factory(printer.id, with_run=False, library_file_id=lib.id)
        item = await _queue_item(db_session, archive_id=archive.id, library_file_id=lib.id, status="printing")

        entry = await _run(db_session, archive.id, item.id)
        assert (await _get(db_session, runs, entry.id)).psi_class == "private_own"

    async def test_a_reprint_on_other_terms_keeps_earlier_runs(
        self, db_session, async_client, printer_factory, archive_factory
    ):
        printer = await printer_factory()
        archive = await archive_factory(printer.id, with_run=False)
        first = await _run(db_session, archive.id)  # printer-initiated, unclassified → psi
        reprint = await _queue_item(db_session, archive_id=archive.id, status="printing")
        await _set(db_session, queue, reprint.id, psi_class="private")
        second = await _run(db_session, archive.id, reprint.id)

        assert (await _get(db_session, runs, first.id)).psi_class == "psi"
        assert (await _get(db_session, runs, second.id)).psi_class == "private"
        meta = (await async_client.get(f"/api/v1/psi/meta?archive={archive.id}")).json()["archive"][str(archive.id)]
        assert meta["psi_class"] == "private"  # the archive shows its latest run
        assert meta["runs_mixed"] is True

    async def test_the_hook_is_off_until_the_schema_is_ready(self, db_session, printer_factory, archive_factory):
        from backend.app.custom.psi import runs as runs_module

        printer = await printer_factory()
        archive = await archive_factory(printer.id, with_run=False)
        runs_module.mark_schema_ready(False)
        try:
            entry = await _run(db_session, archive.id)
        finally:
            runs_module.mark_schema_ready(True)
        assert (await _get(db_session, runs, entry.id)).psi_class is None


# ----------------------------------------------------------------- card data


class TestCardData:
    async def test_user_is_read_lazily_from_the_file(
        self, db_session, async_client, psi_files, printer_factory, archive_factory
    ):
        path = psi_files("archive/1/job.3mf", "User=alice\nalice@example.com")
        printer = await printer_factory()
        archive = await archive_factory(printer.id, file_path=path, file_size=1)

        body = (await async_client.get(f"/api/v1/psi/meta?archive={archive.id}")).json()
        user = body["archive"][str(archive.id)]["user"]
        assert (user["name"], user["email"], user["source"]) == ("alice", "alice@example.com", "file")
        assert (await _get(db_session, archives, archive.id)).slicer_user == "alice"

    async def test_missing_user_is_missing_not_empty(self, async_client, psi_files, printer_factory, archive_factory):
        path = psi_files("archive/1/anon.3mf", "just printer notes")
        printer = await printer_factory()
        archive = await archive_factory(printer.id, file_path=path, file_size=1)
        user = (await async_client.get(f"/api/v1/psi/meta?archive={archive.id}")).json()["archive"][str(archive.id)][
            "user"
        ]
        assert (user["name"], user["email"], user["source"]) == (None, None, None)
        assert user["record"] == {"entity": "archive", "id": archive.id}

    async def test_a_file_replaced_later_is_read_again(
        self, db_session, async_client, psi_files, printer_factory, archive_factory
    ):
        printer = await printer_factory()
        archive = await archive_factory(printer.id, file_path="archive/1/missing.3mf", file_size=1)
        await async_client.get(f"/api/v1/psi/meta?archive={archive.id}")  # nothing to read yet
        path = psi_files("archive/1/arrived.3mf", "User=late")
        await _set(db_session, archives, archive.id, file_path=path, file_size=2)
        meta = (await async_client.get(f"/api/v1/psi/meta?archive={archive.id}")).json()["archive"][str(archive.id)]
        assert meta["user"]["name"] == "late"

    async def test_queue_item_shows_its_sources_user_and_class(
        self, db_session, async_client, psi_files, printer_factory
    ):
        path = psi_files("archive/library/files/f.3mf", "User=bob")
        lib = await _library_file(db_session, file_path=path)
        await _set(db_session, library, lib.id, psi_class="private")
        item = await _queue_item(db_session, library_file_id=lib.id)

        meta = (await async_client.get(f"/api/v1/psi/meta?queue={item.id}")).json()["queue"][str(item.id)]
        assert meta["user"]["name"] == "bob"
        assert meta["user"]["record"] == {"entity": "library", "id": lib.id}
        assert (meta["psi_class"], meta["psi_class_own"], meta["psi_class_source"]) == ("private", None, "library")

    async def test_archive_shows_the_printing_items_class_and_note(
        self, db_session, async_client, printer_factory, archive_factory
    ):
        printer = await printer_factory()
        archive = await archive_factory(printer.id, with_run=False, status="printing")
        item = await _queue_item(db_session, archive_id=archive.id, status="printing")
        await _set(db_session, queue, item.id, psi_class="private_own", psi_notes="mine")

        meta = (await async_client.get(f"/api/v1/psi/meta?archive={archive.id}")).json()["archive"][str(archive.id)]
        assert (meta["psi_class"], meta["psi_class_source"]) == ("private_own", "queue")
        assert (meta["note"], meta["note_source"]) == ("mine", "queue")

    async def test_unknown_and_deleted_records_are_absent(
        self, db_session, async_client, printer_factory, archive_factory
    ):
        printer = await printer_factory()
        archive = await archive_factory(printer.id, deleted_at=datetime.now(timezone.utc))
        body = (await async_client.get(f"/api/v1/psi/meta?archive={archive.id},99999&queue=99999")).json()
        assert body == {"archive": {}, "queue": {}, "library": {}}


# --------------------------------------------------------------------- edits


class TestEdits:
    @pytest.mark.parametrize("status", ["pending", "printing", "completed", "failed", "skipped", "cancelled"])
    async def test_queue_class_and_note_work_at_every_status(self, db_session, async_client, status):
        item = await _queue_item(db_session, status=status)
        r = await async_client.patch(f"/api/v1/psi/queue/{item.id}", json={"psi_class": "private", "note": "  hi  "})
        assert r.status_code == 200, r.text
        assert (r.json()["psi_class"], r.json()["note"]) == ("private", "hi")

    async def test_whitespace_clears_a_note_to_null(self, db_session, async_client, printer_factory, archive_factory):
        printer = await printer_factory()
        archive = await archive_factory(printer.id, notes="old")
        lib = await _library_file(db_session, notes="old")
        item = await _queue_item(db_session)
        for path, table, record_id, column in (
            (f"/api/v1/psi/archives/{archive.id}", archives, archive.id, "notes"),
            (f"/api/v1/psi/library/{lib.id}", library, lib.id, "notes"),
            (f"/api/v1/psi/queue/{item.id}", queue, item.id, "psi_notes"),
        ):
            assert (await async_client.patch(path, json={"note": "   "})).status_code == 200
            assert getattr(await _get(db_session, table, record_id), column) is None

    async def test_upstreams_queue_guard_is_untouched(self, db_session, async_client):
        # PSI edits go through their own route precisely so this stays as is.
        item = await _queue_item(db_session, status="completed")
        r = await async_client.patch(f"/api/v1/queue/{item.id}", json={"manual_start": True})
        assert r.status_code == 400

    async def test_an_archive_edit_classifies_the_whole_job(
        self, db_session, async_client, printer_factory, archive_factory
    ):
        printer = await printer_factory()
        archive = await archive_factory(printer.id)
        done = await _queue_item(db_session, archive_id=archive.id, status="completed")
        future = await _queue_item(db_session, archive_id=archive.id, status="pending")

        r = await async_client.patch(f"/api/v1/psi/archives/{archive.id}", json={"psi_class": "private"})
        assert r.status_code == 200
        assert set(
            (await db_session.execute(select(runs.c.psi_class).where(runs.c.archive_id == archive.id))).scalars()
        ) == {"private"}
        assert (await _get(db_session, queue, done.id)).psi_class == "private"
        assert (await _get(db_session, queue, future.id)).psi_class is None  # a future reprint decides for itself

    async def test_a_history_edit_fixes_its_run_and_the_archive(
        self, db_session, async_client, printer_factory, archive_factory
    ):
        printer = await printer_factory()
        archive = await archive_factory(printer.id, with_run=False)
        item = await _queue_item(db_session, archive_id=archive.id, status="printing")
        entry = await _run(db_session, archive.id, item.id)
        await _set(db_session, queue, item.id, status="completed")

        r = await async_client.patch(f"/api/v1/psi/queue/{item.id}", json={"psi_class": "private_own"})
        assert r.status_code == 200
        assert (await _get(db_session, runs, entry.id)).psi_class == "private_own"
        assert (await _get(db_session, archives, archive.id)).psi_class == "private_own"

    async def test_a_library_edit_changes_only_the_file(
        self, db_session, async_client, printer_factory, archive_factory
    ):
        printer = await printer_factory()
        lib = await _library_file(db_session)
        archive = await archive_factory(printer.id, library_file_id=lib.id)
        await _set(db_session, runs, (await db_session.execute(select(runs.c.id))).scalar(), psi_class="psi")

        assert (
            await async_client.patch(f"/api/v1/psi/library/{lib.id}", json={"psi_class": "private"})
        ).status_code == 200
        assert (
            await db_session.execute(select(runs.c.psi_class).where(runs.c.archive_id == archive.id))
        ).scalar() == "psi"

    async def test_invalid_class_is_rejected(self, db_session, async_client):
        item = await _queue_item(db_session)
        assert (
            await async_client.patch(f"/api/v1/psi/queue/{item.id}", json={"psi_class": "company"})
        ).status_code == 422

    async def test_user_repair_routes_email_and_name(self, db_session, async_client, printer_factory, archive_factory):
        printer = await printer_factory()
        archive = await archive_factory(printer.id)
        r = await async_client.put(f"/api/v1/psi/archives/{archive.id}/user", json={"value": " carol@example.com "})
        assert r.status_code == 200
        assert (r.json()["user"]["name"], r.json()["user"]["email"], r.json()["user"]["source"]) == (
            None,
            "carol@example.com",
            "manual",
        )
        r = await async_client.put(f"/api/v1/psi/archives/{archive.id}/user", json={"value": "Carol"})
        assert (r.json()["user"]["name"], r.json()["user"]["email"]) == ("Carol", None)

    async def test_a_repair_survives_a_reread(
        self, db_session, async_client, psi_files, printer_factory, archive_factory
    ):
        path = psi_files("archive/1/x.3mf", "User=wrong")
        printer = await printer_factory()
        archive = await archive_factory(printer.id, file_path=path, file_size=1)
        await async_client.put(f"/api/v1/psi/archives/{archive.id}/user", json={"value": "right"})
        await _set(db_session, archives, archive.id, file_size=2)  # file changed
        meta = (await async_client.get(f"/api/v1/psi/meta?archive={archive.id}")).json()["archive"][str(archive.id)]
        assert meta["user"]["name"] == "right"


# ---------------------------------------------------------------- accounting


class TestAccounting:
    async def _mixed_period(self, db_session, psi_files, printer_factory, archive_factory):
        printer = await printer_factory()
        made = {}
        for cls, user, grams, cost in (
            ("psi", "alice", 100.0, 10.0),
            ("private", "alice", 20.0, 2.0),
            ("private_partial", "bob", 30.0, 3.0),
            ("private_own", "bob", 40.0, 4.0),
        ):
            path = psi_files(f"archive/1/{cls}.3mf", f"User={user}")
            archive = await archive_factory(
                printer.id,
                file_path=path,
                file_size=1,
                filament_used_grams=grams,
                cost=cost,
                started_at=datetime(2026, 9, 1, 8, 0),
                completed_at=datetime(2026, 9, 1, 9, 0),
            )
            await async_patch(db_session, archive.id, cls)
            made[cls] = archive
        # A run without a cost counts as zero, as upstream counts it.
        await archive_factory(printer.id, filament_used_grams=5.0, cost=None)
        return made

    async def test_reconciles_with_upstream_stats(
        self, db_session, async_client, psi_files, printer_factory, archive_factory
    ):
        await self._mixed_period(db_session, psi_files, printer_factory, archive_factory)
        upstream = (await async_client.get("/api/v1/archives/stats")).json()
        psi = (await async_client.get("/api/v1/psi/accounting")).json()

        assert psi["totals"]["prints"] == upstream["total_prints"]
        assert psi["totals"]["grams"] == pytest.approx(upstream["total_filament_grams"], abs=0.1)
        assert psi["totals"]["cost"] == pytest.approx(upstream["total_cost"], abs=0.01)
        assert psi["totals"]["hours"] == pytest.approx(upstream["total_print_time_hours"], abs=0.1)
        assert sum(b["prints"] for b in psi["by_class"].values()) == upstream["total_prints"]
        assert sum(b["cost"] for b in psi["material"].values()) == pytest.approx(upstream["total_cost"], abs=0.01)

    async def test_buckets_follow_the_cost_rules(
        self, db_session, async_client, psi_files, printer_factory, archive_factory
    ):
        await self._mixed_period(db_session, psi_files, printer_factory, archive_factory)
        psi = (await async_client.get("/api/v1/psi/accounting")).json()

        # Private on PSI material is PSI spend; own material is not; partial stands alone.
        assert psi["material"]["psi"] == {"grams": 125.0, "cost": 12.0}
        assert psi["material"]["partial"] == {"grams": 30.0, "cost": 3.0}
        assert psi["material"]["own"] == {"grams": 40.0, "cost": 4.0}
        assert psi["job"]["psi"]["prints"] == 2 and psi["job"]["private"]["prints"] == 3
        assert psi["runs_without_cost"] == 1

        users = {u["key"]: u for u in psi["users"]}
        assert users["alice"]["to_reimburse"] == 2.0
        assert users["bob"]["to_reimburse"] == 0.0
        assert users["bob"]["partial_cost"] == 3.0
        assert psi["users"][-1]["key"] == "__none__"  # unknown user sorts last

    async def test_run_list_and_export(self, db_session, async_client, psi_files, printer_factory, archive_factory):
        await self._mixed_period(db_session, psi_files, printer_factory, archive_factory)
        rows = (await async_client.get("/api/v1/psi/accounting/runs?user_key=alice&classes=private")).json()
        assert [(r["user"], r["psi_class"], r["cost"]) for r in rows] == [("alice", "private", 2.0)]

        export = await async_client.get("/api/v1/psi/accounting/export?classes=private,private_partial")
        assert export.status_code == 200
        lines = export.text.lstrip("﻿").strip().splitlines()
        assert lines[0].startswith("date;user;psi_class")
        assert len(lines) == 3

    async def test_chart_runs_mirror_upstreams_slim_listing(
        self, db_session, async_client, psi_files, printer_factory, archive_factory
    ):
        await self._mixed_period(db_session, psi_files, printer_factory, archive_factory)
        upstream = (await async_client.get("/api/v1/archives/slim")).json()
        psi = (await async_client.get("/api/v1/psi/stats/runs")).json()

        shared = ("printer_id", "print_time_seconds", "actual_time_seconds", "filament_used_grams", "status")
        assert [{k: r[k] for k in shared} for r in psi] == [{k: r[k] for k in shared} for r in upstream]
        # Material does not matter for the charts: every private class is "private".
        assert sorted(r["job"] for r in psi) == ["private", "private", "private", "psi", "psi"]

    async def test_date_filter_matches_upstream(
        self, db_session, async_client, psi_files, printer_factory, archive_factory
    ):
        await self._mixed_period(db_session, psi_files, printer_factory, archive_factory)
        query = "date_from=2000-01-01&date_to=2000-01-31"
        upstream = (await async_client.get(f"/api/v1/archives/stats?{query}")).json()
        psi = (await async_client.get(f"/api/v1/psi/accounting?{query}")).json()
        assert psi["totals"]["prints"] == upstream["total_prints"] == 0


async def async_patch(db_session, archive_id: int, cls: str) -> None:
    """Classify an archive and its runs the way an archive-card edit does."""
    from backend.app.custom.psi import service

    await service.update_record(db_session, "archive", archive_id, psi_class=cls)
    await db_session.commit()


# --------------------------------------------------------------- permissions


class _User:
    def __init__(self, uid, perms, admin=False):
        self.id, self._perms, self.is_admin = uid, set(perms), admin

    def has_permission(self, perm):
        return self.is_admin or perm in self._perms


class TestCaller:
    def test_no_user_means_auth_disabled_and_full_access(self):
        from backend.app.custom.psi.service import Caller

        assert Caller(None).can_modify("archive", None)

    def test_own_permission_covers_own_records_only(self):
        from backend.app.custom.psi.service import Caller

        caller = Caller(_User(7, {"queue:update_own"}))
        assert caller.can_modify("queue", 7)
        assert not caller.can_modify("queue", 8)
        assert not caller.can_modify("queue", None)  # ownerless needs *_all
        assert not caller.can_modify("archive", 7)

    def test_all_permission_and_admin(self):
        from backend.app.custom.psi.service import Caller

        assert Caller(_User(7, {"archives:update_all"})).can_modify("archive", 8)
        assert Caller(_User(7, set(), admin=True)).can_modify("library", None)

    def test_read_follows_the_same_split(self):
        from backend.app.custom.psi.service import Caller

        caller = Caller(_User(7, {"archives:read_own"}))
        assert caller.can_read("archive", 7) and not caller.can_read("archive", 8)
        assert not caller.can_read("queue", 7)


def test_archive_model_is_untouched_by_psi():
    # The PSI layer must never add attributes to upstream's models.
    assert not hasattr(PrintArchive, "psi_class")
    assert not hasattr(PrintArchive, "slicer_user")
