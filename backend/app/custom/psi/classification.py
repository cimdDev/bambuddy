"""The PSI job classification: four legal states, one column.

Every print is either company work or private work, and a private print is
paid for with company filament, partly own filament, or entirely own filament:

=====================  ==========  =============  =================================
``psi_class``          Job         Material       Accounting meaning
=====================  ==========  =============  =================================
``psi``                PSI         PSI            Company work, company spend.
``private``            private     PSI            Company spend the employee owes.
``private_partial``    private     partly own     Own bucket; the app never splits it.
``private_own``        private     own            Not company spend at all.
=====================  ==========  =============  =================================

``NULL`` means "not set": the record inherits (a queue item from its library
file or archive, an archive from its library file) and finally falls back to
``psi``. PSI material is the default, so nobody has to classify company work.

This replaces the old three-boolean encoding (``private_job``,
``private_material``, ``private_material_partial``). Three booleans can express
eight combinations of which four are nonsense and needed normalising on every
write path; one column with four values cannot hold an illegal state at all.
:func:`from_legacy_flags` maps the old encoding once, during migration.

Two rules that read backwards and are pinned by tests:

* A private job on PSI material **is** company spend. That is exactly the
  number the reimbursement conversation needs. Only ``private_own`` is excluded
  from PSI spend.
* ``private_partial`` is its own bucket. It records that filament was partly
  private, not in what proportion, so it is never folded into either side.
"""

from typing import Literal

PSI = "psi"
PRIVATE = "private"
PRIVATE_PARTIAL = "private_partial"
PRIVATE_OWN = "private_own"

#: The four legal values, in the order the UI offers them.
CLASSES: tuple[str, ...] = (PSI, PRIVATE, PRIVATE_PARTIAL, PRIVATE_OWN)
DEFAULT = PSI

JobType = Literal["psi", "private"]
MaterialOwner = Literal["psi", "partial", "own"]


def validate(value: str | None) -> str | None:
    """Return ``value`` if it is a legal class or ``None``; raise otherwise."""
    if value is None or value in CLASSES:
        return value
    raise ValueError(f"psi_class must be one of {', '.join(CLASSES)} or null, not {value!r}")


def effective(value: str | None) -> str:
    """The class a record counts as: its own value, or the default."""
    return value if value in CLASSES else DEFAULT


def job_type(value: str | None) -> JobType:
    return "psi" if effective(value) == PSI else "private"


def material_owner(value: str | None) -> MaterialOwner:
    """Who paid for the filament. PSI jobs and private jobs on PSI material alike: PSI."""
    cls = effective(value)
    if cls == PRIVATE_OWN:
        return "own"
    if cls == PRIVATE_PARTIAL:
        return "partial"
    return "psi"


def from_legacy_flags(
    private_job: object,
    private_material: object,
    private_material_partial: object,
) -> str | None:
    """Map the retired three-boolean encoding onto one class.

    A non-private row maps to ``None`` (not set) rather than ``psi``: before this
    column existed, "not private" was also what an untouched row looked like, so
    it carries no explicit decision worth preserving. When both material flags
    are set, fully private wins, as it did in the old normaliser: it is the more
    specific claim, and the alternative would silently turn an employee's own
    filament into company spend.
    """
    if not _truthy(private_job):
        return None
    if _truthy(private_material):
        return PRIVATE_OWN
    if _truthy(private_material_partial):
        return PRIVATE_PARTIAL
    return PRIVATE


def resolve(*candidates: tuple[str, str | None]) -> tuple[str, str | None]:
    """Pick the first set value from ``(source, value)`` pairs.

    Returns ``(class, source)``, where ``source`` names the candidate the value
    came from, or ``None`` when nothing was set and the default applies. The
    first candidate is conventionally ``("own", record.psi_class)``.
    """
    for source, value in candidates:
        if value in CLASSES:
            return value, source
    return DEFAULT, None


def _truthy(value: object) -> bool:
    if isinstance(value, str):
        return value.strip().lower() in {"1", "true", "t", "yes"}
    return bool(value)
