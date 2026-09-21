"""The ``User=`` convention, read from stored files.

A lossy human input channel: the box also holds real printer notes, people
forget it, and profiles get shared. These pin down the messy cases.
"""

import json
import zipfile

import pytest

from backend.app.custom.psi import printer_notes as pn


class TestConvention:
    def test_reads_both_lines(self):
        assert pn.parse_printer_notes("User=alice\nalice@example.com") == ("alice", "alice@example.com")

    def test_name_only(self):
        assert pn.parse_printer_notes("User=alice") == ("alice", None)

    def test_bare_address_only(self):
        assert pn.parse_printer_notes("bob@example.com") == (None, "bob@example.com")

    def test_key_is_case_insensitive(self):
        assert pn.parse_printer_notes("user=carol") == ("carol", None)

    def test_name_may_contain_spaces(self):
        assert pn.parse_printer_notes("User=Ana Lee") == ("Ana Lee", None)

    def test_ignores_unrelated_notes(self):
        notes = "nozzle worn, replace before long prints\nUser=alice\ncheck belt tension"
        assert pn.parse_printer_notes(notes) == ("alice", None)

    def test_an_address_inside_a_sentence_is_not_an_address(self):
        assert pn.parse_printer_notes("mail me at a@b.com") == (None, None)

    def test_empty_value_is_not_a_name(self):
        assert pn.parse_printer_notes("User=") == (None, None)
        assert pn.parse_printer_notes("User=   ") == (None, None)

    def test_last_match_wins(self):
        assert pn.parse_printer_notes("User=old\nUser=new") == ("new", None)

    def test_windows_line_endings(self):
        assert pn.parse_printer_notes("User=alice\r\nalice@example.com\r\n") == ("alice", "alice@example.com")


class TestTypedInput:
    def test_an_address_goes_to_email_and_clears_the_name(self):
        assert pn.split_user_input("  bob@example.com ") == (None, "bob@example.com")

    def test_anything_else_is_a_name_and_clears_the_address(self):
        assert pn.split_user_input(" Ana Lee ") == ("Ana Lee", None)

    def test_empty_is_rejected(self):
        with pytest.raises(ValueError):
            pn.split_user_input("   ")


class TestReadingFiles:
    def _3mf(self, tmp_path, data, name="job.3mf"):
        path = tmp_path / name
        with zipfile.ZipFile(path, "w") as zf:
            zf.writestr("Metadata/project_settings.config", json.dumps(data))
        return path

    def test_project_settings(self, tmp_path):
        path = self._3mf(tmp_path, {"printer_notes": "User=alice\nalice@example.com"})
        assert pn.read_user(path) == ("alice", "alice@example.com")

    def test_notes_stored_as_a_list(self, tmp_path):
        path = self._3mf(tmp_path, {"printer_notes": ["User=alice", "alice@example.com"]})
        assert pn.read_user(path) == ("alice", "alice@example.com")

    @pytest.mark.parametrize("data", [{}, {"printer_notes": ""}, {"printer_notes": None}, {"printer_notes": 42}, []])
    def test_absent_is_absent(self, tmp_path, data):
        assert pn.read_user(self._3mf(tmp_path, data)) == (None, None)

    def test_gcode_inside_a_3mf(self, tmp_path):
        path = tmp_path / "plate.gcode.3mf"
        with zipfile.ZipFile(path, "w") as zf:
            zf.writestr("Metadata/plate_1.gcode", "G28\n; printer_notes = User=dora\\ndora@example.com\nG1 X0\n")
        assert pn.read_user(path) == ("dora", "dora@example.com")

    def test_plain_gcode(self, tmp_path):
        path = tmp_path / "part.gcode"
        path.write_bytes(b"G28\n" + b"G1 X1\n" * 100000 + b"; printer_notes = User=emil\n")
        assert pn.read_user(path) == ("emil", None)

    def test_missing_or_broken_files_read_as_nothing(self, tmp_path):
        assert pn.read_user(tmp_path / "missing.3mf") == (None, None)
        broken = tmp_path / "broken.3mf"
        broken.write_bytes(b"PK\x03\x04 not really a zip")
        assert pn.read_user(broken) == (None, None)


class TestFingerprint:
    def test_changes_with_path_or_size(self):
        assert pn.fingerprint("a.3mf", 1) != pn.fingerprint("a.3mf", 2)
        assert pn.fingerprint("a.3mf", 1) != pn.fingerprint("b.3mf", 1)

    def test_no_file_has_its_own_marker(self):
        # Not MANUAL: a file that arrives later must still be read.
        assert pn.fingerprint(None, None) == pn.NO_FILE != pn.MANUAL
