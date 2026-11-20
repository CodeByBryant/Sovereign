# 0003: Determinism policy for the simulation engine

Status: **Accepted**

## Problem

Sovereign's value depends on a world being reproducible from a seed and shareable across machines: seeds you can send a friend, replays, balance tuning, and later multiplayer-style command logs. The original app derived noise from `alea` streams (good) but also used `Math.pow` (implementation-defined), took its default seed from the wall clock, mixed rendering into world generation, and had no tests. A geopolitical simulation compounds tiny differences over thousands of ticks, so a one-bit drift between browsers becomes a different history.

## Decision

The normative specification is [docs/simulation/determinism.md](../simulation/determinism.md). In summary:

- **Numeric model**: IEEE-754 binary64; only exact operations touch state; NaN/Infinity are invalid and rejected, never repaired.
- **Own transcendentals**: `ln`, `exp`, `pow` implemented with `+ - * /` and bit moves only (`math/transcendental.ts`); `sin`, `cos`, `atan2` added the same way when first needed. Platform equivalents are banned in `packages/simulation/src` by ESLint.
- **Randomness**: xoshiro128\*\* seeded per named stream through FNV-1a (over a fully specified byte encoding) and splitmix32; a fixed stream list; seeds are normalized to a uint32 (text is hashed).
- **Iteration**: never depends on object enumeration order; `for...in`, `Object.keys/values/entries` and comparator-less `sort` are banned in the engine.
- **Hashing**: float64 as big-endian IEEE-754 bits, a cyrb128-style 128-bit hash, a versioned canonical layout (`HASH_SCHEMA_VERSION`).
- **Seeds are inputs**: the host chooses a seed (including a random one); the engine never reads a clock or `Math.random`.

The primitives were built test-first against vectors produced by an independent reference implementation, and the tests were mutation-checked (each deliberate break of an algorithm constant, byte order, boundary or lint ban fails a test).

## Alternatives considered

- **Use platform `Math.*` and rely on V8.** Simpler, but Firefox and Safari can differ in the last bits, breaking shared seeds. Rejected.
- **Keep `alea` and `simplex-noise`.** They work, but determinism would depend on two third-party libraries whose internals we do not control or version. Replaced by owned code (done when the generator is ported).
- **A different PRNG (mulberry32, sfc32, PCG).** xoshiro128\*\* has a larger state, good statistical quality, uses only 32-bit integer operations, and has a published reference vector.
- **Hash `JSON.stringify` of the state.** Rejected: decimal formatting, key order and -0 handling are all fragile.
- **A single shared random stream.** Rejected: adding one draw anywhere would change every later result.
- **Native/WASM compute for speed.** Deferred indefinitely: it is only worth revisiting if a perf probe shows a real bottleneck, and golden hashes would serve as its correctness referee.

## Consequences

- Extra implementation work up front, and a small performance cost versus native `Math.*`.
- Changing the stream derivation, the hash layout or any RNG byte is a breaking, versioned change: bump the relevant version, regenerate goldens, explain in the PR.
- The engine cannot use convenient built-ins (`Math.hypot`, `**`, object iteration); ESLint explains the alternative.
- Tests, tools and apps outside `packages/simulation/src` are exempt from the bans (the host picks seeds; tests use platform math as an oracle).
- Until the generator is ported, `terrain/`, `nations/` and `world/` are explicitly exempt, so the guarantee does not yet cover world generation.

## Rollback plan

Revert the ESLint bans and replace `transcendental.ts` calls with `Math.*`; determinism then holds only within a single engine, and goldens would need per-engine baselines.
