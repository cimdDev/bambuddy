# 🛠️ Custom Clean Patch Stack Workflow Guide

This document serves as the canonical runbook and quick reference guide for managing changes within the maintained custom patch stack.

**Before starting any work, always consult the detailed workflows:**
*   [Upstream Patch Stack Workflow](docs/upstream-patch-stack-workflow.md)
*   [Custom Clean Bugfix Workflow](docs/custom-clean-bugfix-workflow.md)

**Key Concepts & Procedures:**
This workflow governs the following critical development practices:

*   **Branching & Ownership:** Defines branch roles and establishes canonical feature ownership.
*   **Conflict Resolution:** Details the process for conflict prechecks (e.g., dry-run rebase).
*   **Replay Flow:** Outlines the mandatory sequence for code integration:
    `upstream-track` $\rightarrow$ `dev` $\rightarrow$ `custom-clean/*` $\rightarrow$ `custom/clean-patch-stack`
*   **Safe Pushing:** Specifies the required safe push behavior for rebased branches (`--force-with-lease`).
*   **Bugfix Handling:** Provides guidelines for handling branch-first bugfixes and their subsequent replay onto the clean stack.
