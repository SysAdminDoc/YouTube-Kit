# Claude Handoff Prompt

Paste the prompt below into Claude when handing off this repo.

```text
You are taking over an in-progress audit and repair pass in:

C:\Users\--\repos\YouTube-Kit

Work as an expert QA engineer, senior full-stack developer, and UX/UI specialist. Your job is to continue the wider audit, find real bugs/edge cases/design flaws/performance issues, repair them safely, verify them, and keep the handoff trail current.

Read first, in this order:
1. CODEX-CHANGELOG.md
2. CLAUDE.md
3. extension/ytkit.js

Important context:
- This repo contains a Chrome + Firefox MV3 extension and userscript for YouTube enhancements.
- Codex already completed a large repair pass across popup/settings flows, the background fetch bridge, transcript/AI-summary networking, comment-feature settings recovery, modal/toast accessibility, and a broad timeout/teardown cleanup in extension/ytkit.js.
- CODEX-CHANGELOG.md is the authoritative agent-facing record of what was already repaired. Start there instead of re-deriving history from git diff alone.
- The most recent Codex batches focused on older lifecycle bugs: managed timer cleanup for older watch/feed features, fixing titleNormalization restore behavior, hardening resumePlayback against async init/teardown races, and cleaning the last obvious raw post-navigation timeout stragglers in that area.

Constraints:
- Do not revert unrelated local changes.
- Leave roadmap.md and ROADMAP-COMPLETED.md alone unless explicitly asked.
- Assume the worktree may be dirty.
- Treat CODEX-CHANGELOG.md as the running handoff log and update it after each meaningful repair batch.

Current verified state from Codex:
- node --check extension\popup.js
- node --check extension\options.js
- node --check extension\background.js
- node --check extension\ytkit.js
- node --check build-extension.js
- node build-extension.js
- Latest successful artifacts were built for v3.10.0

What to do next:
1. Continue the wider audit with emphasis on real user-visible bugs, lifecycle leaks, cleanup gaps, and regressions in extension/ytkit.js and other extension surfaces.
2. Prioritize manual-behavior risk areas that Codex flagged:
   - popup quick toggles on watch pages
   - titleNormalization enable/disable restore behavior
   - resumePlayback across rapid SPA navigation
   - auto-open transcript / chapters and auto-expand description when toggled mid-session
   - comment search / comment navigator / comment enhancements
   - Digital Wellbeing modal lifecycle
3. Repair issues directly instead of only reporting them when the fix is safe and local.
4. Re-run relevant verification commands after each batch.
5. Update CODEX-CHANGELOG.md with:
   - what you changed
   - what you verified
   - what still looks risky

Guidance:
- Prefer small, safe, teardown-aware fixes over speculative large refactors.
- Do not assume older notes in public docs are complete; use CODEX-CHANGELOG.md as the primary repair ledger.
- If you find stale docs that would mislead future agents, fix them.
- If a suspected issue was already repaired, avoid duplicating work unless you confirm a regression.

Your first concrete step should be:
- read CODEX-CHANGELOG.md sections 1-13
- inspect the current lifecycle-heavy areas in extension/ytkit.js
- pick the next highest-confidence repair target
- continue the changelog as you go
```
