"""The PSI permission, registered into upstream's permission registry.

``psi_accounting:read`` gates the per-person accounting (who printed what
privately and owes what): the ``/psi`` page, its run list and CSV export, and
the per-user rows of ``/psi/accounting``. The stats page's PSI widgets stay on
upstream's ``stats:read``; they show totals, not people.

Upstream's ``Permission`` enum cannot be extended, so the permission is a plain
string added to the lists upstream builds its group editor and admin sync from:

* ``ALL_PERMISSIONS``: accepted by group create/update, and synced into the
  Administrators group at startup (upstream's own backfill), so admins hold it;
* ``PERMISSION_CATEGORIES``: its own "PSI" card in the group editor.

API keys never get it: upstream maps no key scope to an unknown permission, so
a key is denied (fail closed), as for upstream's admin-only permissions.
"""

import logging

logger = logging.getLogger(__name__)

ACCOUNTING_READ = "psi_accounting:read"
CATEGORY = "PSI"
LABEL = "View PSI accounting per person (private prints, amounts owed)"


class _RegistryPermission(str):
    """A permission string shaped like upstream's enum members (``.value``)."""

    @property
    def value(self) -> str:
        return str(self)


def register() -> None:
    """Add the PSI permission to upstream's registry. Idempotent; must run before ``init_db``."""
    from backend.app.core import permissions as registry

    if ACCOUNTING_READ not in registry.ALL_PERMISSIONS:
        # In place: groups.py, database.py and DEFAULT_GROUPS hold this same list.
        registry.ALL_PERMISSIONS.append(ACCOUNTING_READ)
    perm = _RegistryPermission(ACCOUNTING_READ)
    registry.PERMISSION_CATEGORIES[CATEGORY] = [perm]

    try:
        from backend.app.api.routes import groups

        groups._PERMISSION_LABEL_OVERRIDES[perm] = LABEL  # noqa: SLF001 — label only; the derived one is fine too
    except (ImportError, AttributeError, TypeError):
        logger.info("PSI: group editor shows the derived label for %s", ACCOUNTING_READ)
