"""The four-state class and the rules that read backwards."""

import pytest

from backend.app.custom.psi import classification as c


class TestLegacyFlags:
    @pytest.mark.parametrize(
        ("flags", "expected"),
        [
            ((False, False, False), None),
            ((False, True, False), None),  # material flag on a company job: meaningless, dropped
            ((False, False, True), None),
            ((True, False, False), c.PRIVATE),
            ((True, False, True), c.PRIVATE_PARTIAL),
            ((True, True, False), c.PRIVATE_OWN),
            ((True, True, True), c.PRIVATE_OWN),  # fully private wins, as the old normaliser ruled
            ((1, 0, 0), c.PRIVATE),
            (("1", "0", "1"), c.PRIVATE_PARTIAL),
            ((None, None, None), None),
        ],
    )
    def test_maps_every_combination(self, flags, expected):
        assert c.from_legacy_flags(*flags) == expected


class TestBuckets:
    def test_private_on_psi_material_is_psi_spend(self):
        # The rule that is easy to get backwards: this *is* company spend.
        assert c.material_owner(c.PRIVATE) == "psi"
        assert c.job_type(c.PRIVATE) == "private"

    def test_own_material_is_not_psi_spend(self):
        assert c.material_owner(c.PRIVATE_OWN) == "own"

    def test_partial_is_its_own_bucket(self):
        assert c.material_owner(c.PRIVATE_PARTIAL) == "partial"
        assert c.job_type(c.PRIVATE_PARTIAL) == "private"

    def test_unset_counts_as_psi(self):
        assert c.effective(None) == c.PSI
        assert c.job_type(None) == "psi"
        assert c.material_owner(None) == "psi"


class TestResolve:
    def test_first_set_value_wins_and_names_its_source(self):
        assert c.resolve(("own", None), ("library", c.PRIVATE), ("archive", c.PRIVATE_OWN)) == (c.PRIVATE, "library")

    def test_default_when_nothing_is_set(self):
        assert c.resolve(("own", None), ("library", None)) == (c.PSI, None)

    def test_an_explicit_psi_stops_inheritance(self):
        assert c.resolve(("own", c.PSI), ("library", c.PRIVATE)) == (c.PSI, "own")

    def test_garbage_is_not_a_value(self):
        assert c.resolve(("own", "company"), ("library", c.PRIVATE)) == (c.PRIVATE, "library")


class TestValidate:
    def test_accepts_the_four_and_null(self):
        for value in (*c.CLASSES, None):
            assert c.validate(value) == value

    def test_rejects_anything_else(self):
        with pytest.raises(ValueError):
            c.validate("company")
