# Roadmap

**Where Sovereign is going:** a highly defined geopolitical simulation, with the readable, watchable feel of Ages of Conflict and the depth of a Paradox grand-strategy game: individual notables (rulers, generals, governors) and populations (culture, religion, class) living on a world whose history is fully reproducible from a seed.

## Decisions that shape every phase

| Topic          | Decision                                                                                                                                                           |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Player role    | **Observer and god tools first.** Playing a nation comes later, through the same logged, deterministic command channel the god tools use.                          |
| Depth          | Individual **notables** plus **pops**.                                                                                                                             |
| Substrate      | A 2000 x 2000 tile grid for terrain and rendering; the simulation runs on a **province graph** derived from it.                                                    |
| Determinism    | Strict, with own math, own PRNG, banned APIs, golden state hashes and Linux + Windows CI ([ADR 0003](decisions/0003-determinism-policy.md)).                       |
| Targets        | Web (GitHub Pages), desktop (Electron) and a headless simulator CLI.                                                                                               |
| Native compute | **Deferred indefinitely.** Revisited only if a probe shows a measured bottleneck TypeScript cannot fix ([ADR 0001](decisions/0001-separate-simulation-engine.md)). |

## Done: the restructure (R)

A pnpm workspace with enforced package boundaries; a deterministic engine (own PRNG and noise, own `ln`/`exp`/`pow`, versioned state hash, save format, lint bans, goldens identical on Node, Chromium and QuickJS); a PixiJS renderer; the browser app with the engine in a worker; a real Electron shell; the simulator CLI; and CI with determinism on Linux and Windows. What exists is terrain, rivers, biomes, resources, a route network with the strategic points along it, and nations whose starting territory, stats, government and personality follow from their land.

## Done: the world ticks (phase 3, core)

The land is cut into about 2,100 provinces by travel cost, so borders are pulled toward rivers and steep ground; nations own provinces and grow into the free ones beside them, the best value for the price first, with no chance in it; a nation's profile and stats are re-derived as it grows and as stocks change; the app has play / pause, four speeds and a date, and the political view draws the province lines inside each nation ([decision 0007](decisions/0007-provinces-and-expansion.md)). One seed grows borders that settle (after about 57 years on a full-size world) and replaying it gives the same hash. **Still empty:** the economy (pops, production, trade, taxes), war, diplomacy and AI; nations only claim free land, and nothing crosses water.

## Phases

Each phase ships with an ADR, new goldens and its exit criterion. Every new system adds its own random stream to the fixed list, a golden, and goes in behind the dependency and lint rules.

| Phase | Theme                                 | Contents                                                                                                                                                                         | Exit criterion                                                  |
| ----- | ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| 3     | **Provinces and borders** (core done) | A province graph built from the tiles (terrain cost pulls borders toward barriers); province ownership; expansion; border rendering; time controls (one tick is one in-game day) | One seed grows stable borders; replaying it gives the same hash |
| 4     | **People and economy**                | Pops (culture, religion, class); resource-based production and trade; taxes; technology; **notables** with traits, lineage and succession                                        | The economy balances over 200 simulated years across 20 seeds   |
| 5     | **AI and diplomacy**                  | A utility / top-K decision framework driven by nation personality; relations, alliances, treaties, claims                                                                        | Blocs and rivalries form without scripting                      |
| 6     | **Warfare**                           | Armies and supply; war goals and war score; sieges and occupation; peace deals; revolts; puppets                                                                                 | Wars start, end and redraw borders plausibly                    |
| 7     | **Culture, ideology, events**         | Spread of culture and religion; ideologies; crises and disasters; a historical event system                                                                                      | Cultures migrate and fracture empires                           |
| 8     | **God mode and observability**        | A command log (every intervention is a deterministic input); replays; a chronicle and timeline; stats graphs; CSV export; balance probes                                         | Any run is reproducible from seed + command log                 |
| 9     | **Scale, polish, 1.0**                | LOD limits for notables and pops; a long-run performance budget; data-driven rules and mods; a save-compatibility policy; installers                                             | A 1000-year run inside the performance budget                   |
| Later | **Player nation**                     | Play one nation through the same command channel as the god tools                                                                                                                | Playable without engine changes                                 |

## Habits that cost nothing and keep options open

- Hot loops use typed arrays in a struct-of-arrays layout, with no per-tick allocation.
- Heavy work is a pure function over buffers, called only from `World`.
- Golden hashes define "correct output", so any future rewrite (of a system, or of the whole engine in another language) has a referee.
- Performance budgets are set per phase from a probe (`pnpm probe`, see [development.md](development.md#performance)), not guessed.

## Known gaps

- Firefox and Safari are not tested; Chromium and Electron are.
- Windows and macOS installers and `release.yml` have not been run.
- Sass prints deprecation warnings for `lighten()`/`darken()` in the UI styles.
- No GPU in CI: frame rates measured there are not comparable to real hardware.
