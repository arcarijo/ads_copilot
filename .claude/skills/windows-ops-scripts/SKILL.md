---
name: windows-ops-scripts
description: Use when writing one-off manual ops scripts (.bat/.ps1) for this project on Windows/Git Bash, pulling Vercel env vars, or handling git operations that need a force-push or PR close/reopen. Prevents repeat friction from a prior session — silent script failures, "[SENSITIVE]" env values mistaken for real ones, and blocked destructive git actions.
---

# Windows Ops Scripts & Destructive Git Handoffs

Lessons from a real session where these exact issues cost multiple round trips.

## Writing .bat scripts for manual DB/admin tasks

- Always end with `pause` (even after a failure branch) — Explorer double-click closes the window instantly on completion, and a silent success/failure looks identical to a crash.
- Echo the working directory (`%cd%` after `cd /d "%~dp0"`) and an `[OK]`/`[FAIL]` line per precondition check. Don't let the script go silent between steps — if it hangs or exits early, the echoed trail is the only diagnostic the user has.
- Print the real exit code of the underlying command (e.g. `%ERRORLEVEL%` from `prisma db push`), not just a generic "done."
- In Git Bash, invoke these with `cmd //c script.bat` (double slash) or `./script.bat` — a bare `.\script.bat` is PowerShell syntax and will not run as expected from Git Bash.

## Vercel Sensitive env vars

- Any var flagged **Sensitive** in the Vercel dashboard will *always* come back as the literal string `"[SENSITIVE]"` from `vercel env pull`, no matter how many times it's re-pulled — this is intended write-only behavior, not a bug or permissions gap.
- Don't waste time debugging "why is this URL wrong" for a var like `DATABASE_URL` — check the Sensitive flag first.
- Scripts/workflows that need the real value must read it from a separate, manually-populated, gitignored file (e.g. `.env.production.secrets`) that `vercel env pull` never touches — not from `.env.*.local`.
- See memory `vercel_sensitive_env_pull` and `deployment_pipeline` for the session-mode-pooler (`:5432`, not `:6543`) detail that goes with this.

## Destructive git actions (force-push, PR close/reopen)

- Force-push and branch-history-rewriting actions are blocked by design in auto mode even after prior approval in the same session — approval doesn't carry over, expect to hand these to the user each time they're needed.
- If a branch is force-pushed while its PR is open, GitHub can refuse to let that PR be reopened later if it gets closed in the meantime ("this pull request was closed and you can't reopen it because the head branch was force-pushed"). If you hit this, don't fight it — recreate a fresh PR from the current branch state and link back to the old PR number in the description for context.
- When handing a destructive command to the user instead of running it yourself, give them the exact command to paste, not a description of what to do.
