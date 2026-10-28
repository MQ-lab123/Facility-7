# FACILITY-7 Release Candidate – Test Report

Date: 2026-10-28. Base: `FACILITY7_quests.html` (the only game file available). `FACILITY7_quests.html` was not modified.

## 1. Files

**Available:** `FACILITY7_quests.html` (1,448,756 bytes, 10,965 lines).

**NOT available (blocked):** the original/production game HTML, `tests/tests.js`, `tests/lib.js`, `tests/stub_three.js`, the earlier "63 tests" run, `server.js` / the Render multiplayer server, the live Netlify deployment.

Consequences:
- No original-vs-quests diff was possible. "No existing feature was removed" is **not verified**. The RC differs from the quests build only by the edits in §2.
- The previous 63 tests could not be rerun. The suite below is new (64 tests), written for this task, and its pass count is not comparable to the old number.
- Nothing was deployed.

## 2. Exact changes (RC vs. `FACILITY7_quests.html`, 23 diff lines)

| # | Change |
|---|---|
| 1 | New `<script id="f7-build-config">` before the main game script: `const F7_PUBLIC_BUILD=true;`, with documentation. One switch for public vs. dev. |
| 2 | `REDEEM={MINQ1054:{coins:30000,xp:4000}}` → `REDEEM={}`. The string `MINQ1054` no longer appears anywhere in the RC. The REDEEM CODE dialog still works and now answers INVALID CODE for every code. |
| 3 | `OWNER_GRANTS` (GHOST #1 free Pro + tier 50) is now `[]` unless `F7_PUBLIC_BUILD===false`. |

Files delivered in `release/`:
- `FACILITY7_release_candidate.html` – public RC (flag `true`).
- `FACILITY7_release_candidate_DEV.html` – identical except `F7_PUBLIC_BUILD=false` (GHOST grant active). **Do not hand out.**
- `tests/` – `tests.js`, `stub_three.js`, `README.md`, `results.json`, `run_rc.log`, `run_control.log`.

Quest counts, pools, rewards, reset logic, currency name (`REQUISITION ◈`, still provisional) and Pro price (1,500) were **left unchanged**. Currency name, symbol and price remain in one block: `CFG` in `<script id="f7-quests">`.

Kept: the existing Pro receipt, any ownership already saved, and the GHOST monthly/season logic (dev only). I found no other monthly-reward code in the file; this was a text search, not an exhaustive audit.

## 3. Test method and its limits

- Real game HTML in headless Chromium 131 (Playwright), using the game's own `#f7qa` test hooks. Each test uses a fresh browser context.
- **three.js is replaced by a no-render stub** (the sandbox has no network). Startup scripts execute, but this proves nothing about real 3D rendering or gameplay.
- Viewport tests are desktop-Chromium viewport emulation, **not** real phones.
- Game state (`state`, `P.alive`, `stats`, `inTraining`, `mp`) is set directly from the test; no real match was played.

## 4. Results

**RC build: 64 run, 64 passed, 0 failed** (`tests/run_rc.log`).

**Negative control:** the same suite pointed at the original quests build gave 60 passed and 4 failed, exactly the four build-hygiene tests (`MINQ1054` present, no flag, code redeems for +30,000 Gold / +4,000 XP, GHOST #1 gets Pro). This shows those tests can fail.

### Tested and passed
- **Build:** no `MINQ1054`; no duplicate element IDs; RC and DEV load with no page errors (stubbed THREE); redeem dialog gives nothing for `MINQ1054`; GHOST #1 gets no Pro in RC; GHOST #1 does get Pro in DEV; a non-owner name/ID gets nothing in DEV.
- **Structure/resets:** 10 daily, 50 weekly, 17 permanent active; unique and deterministic draws; new day re-draws dailies and keeps weekly + permanent progress; weekly reset clears weekly only and keeps permanent claims and life counters; clock set backwards does not re-roll.
- **Tracking:** kill, headshot, weapon-category counters; no double count per enemy; no progress in training, when dead, out of play state, or for remote co-op hits; boss/wave/wave_best; mission only on victory, once per run; PvP match and win counted once per match, only in PvP mode.
- **Claims:** incomplete rejected; claimed exactly once with an exact balance change; invalid id/category rejected; permanent challenge claimed once and persists after reload; daily progress persists after reload.
- **Currency:** separate from Gold; insufficient funds and invalid prices (0, negative, fractional, NaN, string, empty ref) rejected with no charge; spend-to-zero never goes negative; corrupted balances (NaN, negative, string, fractional, 1e15, Infinity, null) sanitised; balance persists across reload.
- **Pro Pass:** price 1500 from config; 1499 rejected without charge; 1500 charges exactly once and a second attempt returns "owned"; ownership and balance persist across reload without re-charge; UI flow charges once on 3 rapid confirm clicks; cancel changes nothing; an existing owner is not charged again; Gold cannot buy it; p-track claims are refused without Pro and work exactly once after purchase; f-track claims once.
- **Saves:** old save with no `qc`/`qs`; corrupted `qs` (string, array, wrong types, negative/huge numbers); negative, NaN-string, fractional and over-cap `qc`; broken profile JSON; export→import round trip of Gold, balance and quest state (via the real LOAD dialog).
- **Failed writes:** `localStorage.setItem` throwing during a Pro purchase leaves a consistent state (either fully bought or fully refunded); a failed save during a quest claim does not double or lose the reward in memory.
- **Layout (emulated viewports 1280×720, 800×500, 360×640, 640×300; English and Korean):** quest panel renders 10 / 50 / 17 cards, no horizontal overflow, no claim button outside the viewport width.

### Test-harness mistakes found and corrected during this session (not game bugs)
1. Remote-hit marker passed as the wrong argument.
2. Balance set without saving: the game deliberately adopts a lower stored balance (cross-tab spend protection).
3. **Battle Pass track ids are `'f'`/`'p'`, not `'free'`/`'pro'`.** My first "Pro-only rewards cannot be claimed" test passed vacuously because of this. It was rewritten to assert real state and a positive control (claimable after purchase).
4. UI purchase tests need the Battle Pass screen open.
5. Wrong selectors for the quest cards and the LOAD button.

### Tested and failed
None remaining in the final run. The earlier failures above were all test-side.

## 5. Not done / not tested

**Not implemented (requested in the original task, not done in this pass):**
- Shop integration improvements (currency display, per-item currency labels, purchase feedback, mobile shop layout). The shop code was not inspected beyond the Pro Pass purchase flow.
- Training-range improvements. Only the "training kills do not advance quests" rule was tested.
- Fixes for the tracking gaps. PvP **kill** attribution still has no QST hook (kills in PvP are never counted; asserted by a test). Co-op match completion still has no reliable event. The mission still has 3 waves. No new events were added.
- Cosmetics purchases (`CFG.cosmetics` still empty on purpose).

**Not tested:** real 3D rendering and gameplay; real loading-screen flow; solo/co-op/PvP matches; live multiplayer (no server); weapons, ammo, melee, switching; enemies, waves, bosses; shop purchases of weapons and Gold spending; Free/Pro reward contents beyond tier 1 and the Pro-gating check; weapon mastery; fullscreen behaviour; quest toasts overlapping HUD during gameplay; mobile controls and real devices; shop and Battle Pass layouts at small sizes; Gold-balance edits via save code; browsers other than Chromium; the Pro Pass price/name configurable in one place was checked by reading `CFG` values, not by changing them and re-testing.

## 6. Security limitations (unchanged architecture)

- Everything is client-side (localStorage + IndexedDB). **Nothing is cheat-proof.**
- **Confirmed by test:** a hand-made save code can set the REQUISITION balance to the 1,000,000,000 cap, which buys Pro. Gold via save code was not tested. Real protection needs a server that owns balances and quest state; none is available here and none was invented.
- Changing the device clock, editing storage, or editing the HTML (flipping `F7_PUBLIC_BUILD`) all bypass the safeguards. The flag is a build convention, not a security boundary.
- The `#f7qa` test hooks (`QST._t`, `BP._data`) are still in the RC; they are gated only by a URL hash. Consider stripping them for production.
- The REDEEM CODE dialog remains but has no codes; remove it if no public codes are planned.

## 7. Required server-side work
None was attempted. For authoritative currency: server-held balance, server-validated quest events (especially PvP kills and match completion), and server-side Pro entitlement.

## 8. Remaining known issues
- The previously reported tracking gaps above (PvP kills, co-op completion, 3-wave mission).
- No baseline comparison against the original game.
- Currency name `REQUISITION` is provisional.
