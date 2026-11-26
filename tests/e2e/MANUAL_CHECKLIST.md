# Manual checklist (needs a real browser) — run after `npm run dev`

Automated counterpart: `tests/regression/end_to_end_consistency.test.mjs` (one edit, every reader). Keep the browser console open: no red errors at any step.

1. **Unit on a base**: Units lab -> new unit on each base (human_base_1, human_base_2, a mirukenkay/katiler/almasir base) -> change its skin -> save.
   It must look identical in the Units lab, the Studio, and in a new match (recruit/spawn it) without reloading the page.
2. **Building skin**: Studio -> Buildings -> apply a skin -> Buildings lab shows it; set it back to default in the lab -> Studio shows default.
3. **Hero**: Hall of Heroes -> edit a hero (name, look) -> Studio/Units lab/game show the same hero.
4. **Rebase + clip**: switch an existing unit's base in the Studio; edit an animation clip -> Units lab, Hall of Heroes and the game show both.
5. **Rejected save**: break a reference on purpose (e.g. import a JSON whose unit points at a base that does not exist) -> a clear red message, nothing changes.
6. **Running match**: start a match, open `__dataRegistry` in the console and change a unit stat (or a lab) -> the running match does not change, the toast says "apply from the next match"; start a new match -> new value.
7. **Reload**: reload the page -> the edits are still there. `window.__klDiag()` shows `persist.ok: true`.
8. **Load time**: open each lab once and note the time (target: lab < 500 ms, lobby < 800 ms on your machine).
