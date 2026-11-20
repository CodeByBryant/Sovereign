# 0004: Give terrain fields their distribution by rank

Status: **Accepted** (approved by the project owner)

## Problem

A probe over 10 full-size worlds found that only 22 of the 26 biomes ever generated. `glacier`, `alpine`, `highland` and `mountain` never appeared (so no mountain ranges, almost no stone, no gold, no mountain passes), and `desert`, `rainforest`, `wetland` and `mangrove` were under 0.01% of tiles. The original app had the same limits, so this predates the restructure.

Cause: every terrain field is a normalised fractal noise sum, which clusters in a narrow bell around 0.5, while the biome table assumes a broad 0 to 1 spread. Elevation (also raised to the 1.4 power) peaked at 0.37 to 0.59 against thresholds of 0.74, 0.78 and 0.85; temperature almost never reached the 0.7 "tropical" threshold; humidity clustered near 0.6. The default sea level (0.37) left 0 to 3.5% land, and a "rescue" lowered it on nine of ten seeds, so the amount of land varied from seed to seed (25.2 to 25.6% on nine, 42.6% on the tenth). Tuning noise parameters cannot fix that reliably across seeds. `glacier` was also dead code: every tile high enough had already been classed highland, alpine or mountain.

## Decision

Reshape each field's **distribution** directly, by rank, with a designed profile; then fit the biome table to agreed target shares.

- `remapByProfile` (`math/quantile.ts`, specified in determinism.md section 6.2) ranks every tile and gives it the profile's value for that rank. It is monotone, so coastlines, ridges and latitude bands stay where the noise put them; only the values move. It is deterministic by construction (an integer histogram and `+ - * /`).
- **Elevation** has an absolute profile (`elevation.profile`) that pins the ocean to exactly what it was (19% deep ocean, water 74.5% of tiles at sea level 0.37, shore 3%, land 25.5%, now on **every** seed) and places 14% of land at highland or above (7.5% above alpine, 4% mountain). The power curve is gone; the land-ratio rescue stays for custom configs.
- **Temperature and humidity** are ranked over land only (`temperature.profile`, `humidity.profile`). The generators no longer clamp, because a clamp makes masses of identical tiles that no ranking can separate. The rivers' humidity boost is applied after the humidity reshaping, in the units it was written for.
- The classifier's temperature x humidity decision tree became data (`biomes.bands`), and `glacier` is the polar table's top row. The old tree is kept in the tests as an oracle that the table reproduces it everywhere except that one change.
- The profile knots and every humidity threshold were **fitted** to a design table of target shares (Earth-like mix, moderate mountains) by `tests/probe/fit-climate.probe.ts`, sampling worlds and solving for the cut points. The result is checked on seeds the fit never saw.

Other things the retune had to repair or re-tune, measured against a recorded baseline: rivers (thresholds x0.72 to stay at about 7.4% of land), mountain passes (the detector's two constants became `strategic.mountainPassRise` and `mountainPassMinRatio`; it found none before), and the resource and strategic layers, which follow from the biomes.

## Alternatives considered

- **Tune the noise parameters and thresholds only.** Rejected: the narrow distribution is a property of fractal sums, so coverage would stay seed-dependent and could never be guaranteed.
- **Min/max or mean/standard-deviation stretching.** Rejected: sensitive to outliers and it keeps the bell shape, so the tails (mountains, deserts) stay rare.
- **Let the land amount vary per seed.** Offered; the owner chose the same amount for every seed.
- **Keep the rescue as the mechanism.** Rejected: it only lowers the sea; it cannot create highlands.

## Consequences

- **Every existing world changes** (pre-1.0, no users to protect). The determinism goldens were regenerated in their own commit. `HASH_SCHEMA_VERSION` is unchanged (the hash layout did not change); `SAVE_FORMAT_VERSION` is 2 because the saved config gained the profiles and the climate table, and the web app's IndexedDB drops older saves.
- Every seed now has the same land amount and the same elevation histogram. Continents still differ in shape and layout, but not in how much land there is.
- The world is more mountainous and its resources follow: stone 13.6% of land (was 0.1%), iron 2.7% (0.009%), gold 0.055% (none), and about 48 mountain passes per world.
- Targets are a design intent fitted by iteration, not exact: 20 of 23 climate biomes land within +/-30% of target and the rest (polar desert, glacier, mangrove) within 0.5x to 2x, on 10 unseen seeds at 2000 x 2000. The rare polar and wet biomes depend on small, seed-specific regions.
- Creation time is unchanged (about 5.8 s per 2000 x 2000 world).

## Guards

`tests/determinism/biome-coverage.test.ts` (three 1000 x 1000 worlds, in CI on Linux and Windows) fails if a biome disappears, the ocean moves or a biome leaves a wide band around its target; the config's own tests pin the profiles. `pnpm probe -- tests/probe/biome-coverage.probe.ts` is the full 10-world measurement, and `tests/probe/fit-climate.probe.ts` refits the table after any change to the generators.
