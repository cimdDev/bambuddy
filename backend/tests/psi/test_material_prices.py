"""Material prices: written onto spools, followed by filled-in prices only."""

import pytest
from sqlalchemy import select

from backend.app.custom.psi import material_prices, runs
from backend.app.custom.psi.tables import spools
from backend.app.models.spool import Spool

pytestmark = pytest.mark.usefixtures("psi_schema")


async def _prices(db, **prices):
    await material_prices.save_prices(db, prices)
    await db.commit()


async def _spool(db, material="PLA", **kwargs) -> Spool:
    spool = Spool(material=material, **kwargs)
    db.add(spool)
    await db.commit()
    await db.refresh(spool)
    return spool


async def _row(db, spool_id):
    return (await db.execute(select(spools.c.cost_per_kg, spools.c.psi_cost_auto).where(spools.c.id == spool_id))).one()


class TestSpoolHook:
    async def test_a_new_spool_without_price_gets_its_materials(self, db_session):
        await _prices(db_session, PLA=20, PETG=24)
        spool = await _spool(db_session, material="pla ")
        assert spool.cost_per_kg == 20
        assert tuple(await _row(db_session, spool.id)) == (20, True)

    async def test_a_typed_price_is_kept(self, db_session):
        await _prices(db_session, PLA=20)
        spool = await _spool(db_session, cost_per_kg=31.5)
        assert tuple(await _row(db_session, spool.id)) == (31.5, None)

    async def test_an_unpriced_material_stays_empty(self, db_session):
        await _prices(db_session, PLA=20)
        spool = await _spool(db_session, material="PA-CF")
        assert tuple(await _row(db_session, spool.id)) == (None, None)

    async def test_typing_a_price_makes_it_the_spools_own(self, db_session):
        await _prices(db_session, PLA=20)
        spool = await _spool(db_session)
        spool.cost_per_kg = 26
        await db_session.commit()
        assert tuple(await _row(db_session, spool.id)) == (26, None)

    async def test_resending_the_same_price_keeps_it_filled_in(self, db_session):
        await _prices(db_session, PLA=20)
        spool = await _spool(db_session)
        spool.cost_per_kg = 20.0  # upstream's form sends every field on save
        spool.note = "edited"
        await db_session.commit()
        assert tuple(await _row(db_session, spool.id)) == (20, True)

    async def test_clearing_a_price_hands_the_spool_back_to_its_material(self, db_session):
        await _prices(db_session, PLA=20)
        spool = await _spool(db_session, cost_per_kg=30)
        spool.cost_per_kg = None
        await db_session.commit()
        assert tuple(await _row(db_session, spool.id)) == (20, True)

    async def test_a_new_material_reprices_a_filled_in_spool_only(self, db_session):
        await _prices(db_session, PLA=20, PETG=24)
        filled = await _spool(db_session)
        typed = await _spool(db_session, cost_per_kg=30)
        filled.material = typed.material = "PETG"
        await db_session.commit()
        assert tuple(await _row(db_session, filled.id)) == (24, True)
        assert tuple(await _row(db_session, typed.id)) == (30, None)

    async def test_a_material_without_price_clears_a_filled_in_price(self, db_session):
        await _prices(db_session, PLA=20)
        spool = await _spool(db_session)
        spool.material = "ASA"
        await db_session.commit()
        assert tuple(await _row(db_session, spool.id)) == (None, None)

    async def test_the_hook_is_off_until_the_schema_is_ready(self, db_session):
        await _prices(db_session, PLA=20)
        runs.mark_schema_ready(False)
        try:
            spool = await _spool(db_session)
        finally:
            runs.mark_schema_ready(True)
        assert tuple(await _row(db_session, spool.id)) == (None, None)


class TestPriceList:
    async def test_saving_prices_follows_filled_in_and_empty_spools(self, db_session):
        runs.mark_schema_ready(False)  # spools from before the price list existed
        try:
            empty = await _spool(db_session)
            typed = await _spool(db_session, cost_per_kg=30)
        finally:
            runs.mark_schema_ready(True)
        await _prices(db_session, PLA=20)
        assert tuple(await _row(db_session, empty.id)) == (20, True)

        repriced = await material_prices.save_prices(db_session, {"PLA": 22})
        await db_session.commit()
        assert repriced == 1
        assert tuple(await _row(db_session, empty.id)) == (22, True)
        assert tuple(await _row(db_session, typed.id)) == (30, None)

        await _prices(db_session)  # PLA removed
        assert tuple(await _row(db_session, empty.id)) == (None, None)
        assert tuple(await _row(db_session, typed.id)) == (30, None)

    async def test_list_counts_spools_per_material(self, db_session):
        await _prices(db_session, pla=20, TPU=35)
        await _spool(db_session)
        await _spool(db_session, cost_per_kg=30)
        await _spool(db_session, material="PETG")
        rows = {row["material"]: row for row in await material_prices.load_prices(db_session)}
        assert rows["PLA"] == {"material": "PLA", "cost_per_kg": 20, "spools": 2, "auto": 1, "own": 1, "unpriced": 0}
        assert rows["PETG"]["cost_per_kg"] is None and rows["PETG"]["unpriced"] == 1
        assert rows["TPU"]["spools"] == 0

    async def test_negative_and_empty_are_rejected(self, db_session):
        with pytest.raises(ValueError):
            await material_prices.save_prices(db_session, {"PLA": -1})
        with pytest.raises(ValueError):
            await material_prices.save_prices(db_session, {" ": 20})


class TestRoutes:
    async def test_get_and_put(self, async_client, db_session):
        spool = await _spool(db_session, material="ABS")
        response = await async_client.put("/api/v1/psi/material-prices", json={"prices": {"abs": 25, "PLA": 19.99}})
        assert response.status_code == 200, response.text
        body = response.json()
        assert body["repriced"] == 1
        assert {r["material"]: r["cost_per_kg"] for r in body["materials"]} == {"ABS": 25, "PLA": 19.99}
        assert tuple(await _row(db_session, spool.id)) == (25, True)

        listed = await async_client.get("/api/v1/psi/material-prices")
        assert listed.status_code == 200
        assert [r["material"] for r in listed.json()] == ["ABS", "PLA"]

    async def test_invalid_price_is_422(self, async_client):
        response = await async_client.put("/api/v1/psi/material-prices", json={"prices": {"PLA": -5}})
        assert response.status_code == 422

    async def test_upstreams_spool_route_fills_the_price(self, async_client, db_session):
        await _prices(db_session, PETG=24)
        response = await async_client.post("/api/v1/inventory/spools", json={"material": "PETG", "label_weight": 1000})
        assert response.status_code == 200, response.text
        assert response.json()["cost_per_kg"] == 24
