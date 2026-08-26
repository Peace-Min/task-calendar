@echo off
rem ===========================================================================
rem  org-ops.cmd - launcher for org-ops.ps1 (organisation change tool)
rem
rem  ASCII ONLY. Do not put Korean (or any non-ASCII) text in this file.
rem  cmd.exe resumes a batch file by BYTE offset after a child process exits.
rem  Under codepage 65001 that offset is miscomputed when the file contains
rem  multi-byte text, so cmd.exe re-executes fragments of comment lines as
rem  commands (measured on this PC with init-calendar.cmd: 6 bogus
rem  "not recognized" lines, and exit code 9009 when the block sat below the
rem  powershell call).
rem
rem  All Korean documentation lives where it is actually read:
rem    - org-ops.ps1 header  : why the tool exists, the five invariants, the
rem                            "must not get worse" commit rule, exit codes
rem    - db/deploy/README.md : credentials, recipes, what to do when it fails
rem
rem  Why this tool exists, in one line: the database enforces that a parent
rem  row exists, but nothing enforces that the organisation graph is a TREE,
rem  that names carry no invisible whitespace, or that a live unit never sits
rem  under a hidden one - so a single hand-written UPDATE can silently flip
rem  who is allowed to see whose schedule. Every change goes through here.
rem
rem  Exit codes (must match the ps1 header table):
rem    0 ok (committed, or -WhatIf passed and wrote nothing)
rem    1 failed - rolled back, database unchanged
rem    2 nothing was attempted - bad argument, missing credentials, a missing
rem      target org/person, a precondition (self-parent, descendant parent,
rem      hidden parent), or the user answered No at the confirmation prompt.
rem      Distinct from 1 because the human action differs: 1 means "it was
rem      sent and rolled back", 2 means "it was never sent".
rem    3 connection or privilege problem
rem    4 mysql.exe not found
rem    5 target schema is not the cut schema - org_id/parent_id missing, or a
rem      name-mirror column (org_unit.parent / app_user.org_unit) still there
rem    6 HARD invariants were already broken before the run (root count,
rem      unreachable orgs, name formatting, orphans) AND the command asked for
rem      cannot fix them. rename/add/assign stop here; show, move and repair
rem      always run, because they are the only way out - blocking them left
rem      the tool with no escape but hand SQL (measured 2026-08-24).
rem      The soft invariant ("live org under a hidden parent") never produces
rem      6: it only warns. Clear it with "move" (re-parent the child to a live
rem      parent) or "repair -DeactivateOrphanedChildren" (hide the subtree).
rem    9 ROLLBACK VERIFICATION FAILED - the run failed yet the data changed.
rem      Report this to a human immediately.
rem    7 and 8 are unused. Do not reuse a retired or reserved value for a new
rem    meaning - callers pinned to the old table would silently take the
rem    wrong branch (same rule as init-calendar.cmd).
rem
rem  Credentials come from the environment, never from the command line
rem  (Windows lets any process of the same user read another's command line):
rem    set TC_OPS_DB_ADMIN_PW=<db admin password>
rem    set TC_OPS_DB_ADMIN_USER=root        (optional, this is the default)
rem
rem  Usage:
rem    org-ops.cmd show
rem    org-ops.cmd rename -Id 2 -Name "SW Research Div" -WhatIf
rem    org-ops.cmd rename -Id 2 -Name "SW Research Div"
rem    org-ops.cmd add    -Name "SW Team 5" -ParentId 2 [-SortOrder 26]
rem    org-ops.cmd move   -Id 10 -ParentId 3
rem    org-ops.cmd assign -LoginId hjlee -OrgId 7
rem    org-ops.cmd repair -WhatIf
rem    org-ops.cmd repair -DeactivateOrphanedChildren -WhatIf
rem
rem  What "repair" does now that there is no name mirror to rebuild:
rem    - strips leading/trailing whitespace from organisation names. That
rem      violation is invisible on screen, so a human cannot fix it with
rem      "rename" - they cannot see what to type. TRIM is the only unambiguous
rem      automatic correction; full-width digits/letters and NBSP are reported
rem      but NOT auto-corrected, because changing them is a renaming decision.
rem    - with -DeactivateOrphanedChildren, hides every live org that sits under
rem      a hidden parent, together with everything below it. Explicit switch,
rem      never the default: moving those children to a live parent is often the
rem      better call.
rem
rem  -WhatIf shows what would change and writes nothing.
rem  -Force  skips the confirmation prompt (unattended runs).
rem
rem  Do NOT end an argument value with a backslash - powershell.exe reads \"
rem  as an escaped quote and swallows the following argument (the ps1 detects
rem  the common cases and refuses, but do not rely on that).
rem ===========================================================================
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0org-ops.ps1" %*
set "RC=%ERRORLEVEL%"
if not "%RC%"=="0" pause
exit /b %RC%
