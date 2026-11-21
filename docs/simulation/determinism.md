# Determinism specification

Normative spec for the simulation engine (`@sovereign/simulation`). Anything an independent implementation must reproduce bit for bit is defined here. Rationale and alternatives are in [ADR 0003](../decisions/0003-determinism-policy.md).

**Guarantee.** For the same seed, the same world configuration and the same sequence of API calls, every engine (any JS runtime, any OS) produces identical simulation state, and therefore an identical state hash.

> **Status.** The primitives below (seed, streams, deterministic math, noise, hashing, lint bans) are implemented and tested, and terrain generation and nation spawning run on them: the engine has no third-party runtime dependencies and the lint bans cover all of `packages/simulation/src`. The simulation clock and golden _world_ state hashes arrive with the `World` API.

## 1. Numeric model

- All simulation numbers are IEEE-754 **binary64** (JS `number`). Tile layers are stored in typed arrays; a value is computed in binary64 and rounded once on store, which is deterministic.
- Only these operations may touch simulation state: `+ - * /`, `Math.sqrt` (correctly rounded by IEEE-754), comparisons, `Math.abs/floor/ceil/min/max/trunc/sign`, `Math.imul`, and bitwise operators on 32-bit integers. Transcendental functions come from `math/transcendental.ts`, which is built from those operations only. `Math.sin`, `Math.pow`, `**`, `Math.hypot` and friends are forbidden because their results are implementation-defined.
- **NaN and ±Infinity are invalid simulation values.** The hasher throws on them (fail loud, never hash garbage), and the math functions throw `RangeError` outside their domains instead of returning them. Nothing normalizes, clamps or repairs.
- **-0 is canonicalized to +0 before hashing** (`x === 0 ? 0 : x`), because the engine treats them as equal.

## 2. Seed

The engine's seed is an integer in `[0, 2^32 - 1]`. `normalizeSeed(input)` turns whatever a host has into one:

- a **number** must already be such an integer, otherwise `RangeError`;
- a **canonical digit string** (`"0"` or no leading zero) that fits in 32 bits is the number it spells, so typing `12345` and passing `12345` give the same world;
- **any other text** (including digit strings that do not fit, or with leading zeros such as `"007"`) is hashed with FNV-1a 32 over its UTF-8 bytes. The empty string hashes to the FNV offset basis; hosts that want a random world pick a random seed instead.

Choosing a random seed is the host's job (the one place `Math.random()` or the clock may be used); the engine only ever receives a seed.

## 3. Random streams

A single seed yields independent named streams. The names form a fixed, ordered constant (`STREAM_NAMES`):

```text
elevation, continent, ocean, temperature, humidity, biome, riverPrimary, riverSecondary, riverWarpX, riverWarpY, riverWidth, geology, spawn, names, colors, flags
```

Nothing iterates a stream registry by object key; code uses this array or a named stream. A stream's output depends only on the seed and its own name, so adding a draw in one stream, or adding a new stream, never changes another. Adding a name is still a deliberate act: edit the list, this document and `tests/stream-usage.test.ts`.

### 3.1 Deriving a stream's initial state

1. Build the input bytes: ASCII `"sovereign-rng-v1"`, `0x00`, the seed as 4 bytes **big-endian**, `0x00`, then the **UTF-8** bytes of the stream name.
2. `s` = **FNV-1a 32-bit** over the bytes (offset basis `0x811c9dc5`, prime `0x01000193`, multiply with `Math.imul`, result as uint32).
3. Expand with **splitmix32** starting from state `s`; take four outputs `w0..w3`:

   ```text
   state = (state + 0x9e3779b9) | 0
   z = state
   z = imul(z ^ (z >>> 16), 0x85ebca6b)
   z = imul(z ^ (z >>> 13), 0xc2b2ae35)
   out = (z ^ (z >>> 16)) >>> 0
   ```

4. The xoshiro128\*\* state is `[w0, w1, w2, w3]`. An all-zero state is invalid; if all four words are zero it becomes the fixed constant `[0x9e3779b9, 0x243f6a88, 0xb7e15162, 0x71374491]`.

Changing any byte of this derivation (including the `sovereign-rng-v1` prefix) changes every world: it is a breaking, versioned change.

### 3.2 Generator and derived draws

**xoshiro128\*\*** (uint32 arithmetic):

```text
result = imul(rotl(imul(s1, 5), 7), 9) >>> 0
t = s1 << 9
s2 ^= s0; s3 ^= s1; s1 ^= s2; s0 ^= s3; s2 ^= t; s3 = rotl(s3, 11)
```

- `nextUint32()` returns `result`.
- `float()` in `[0, 1)`: `hi = nextUint32() >>> 5`, then `lo = nextUint32() >>> 6` (in that order); result `(hi * 67108864 + lo) / 9007199254740992`.
- `integer(min, max)` inclusive, both safe integers, `range = max - min + 1 <= 2^32`. `limit = floor(2^32 / range) * range`. Draw `u = nextUint32()` until `u < limit`; result `min + (u % range)` (rejection sampling, no modulo bias).
- `boolean(p = 0.5)`: `float() < p` (strictly less, so `p = 0` is never true).
- `choose(items)`: `items[integer(0, items.length - 1)]`; throws on an empty list.
- `getState()` / `setState()` expose the four words for saves.

A Gaussian draw is not provided yet; it will be added (Marsaglia polar, using the engine's `ln`) with its vectors when first needed.

## 4. Time

`SimulationClock` holds a fixed `deltaTime` (the config `timestep`, in-game days per tick; 1 by default) and a `tick`. `tick` increases by exactly 1 per `World.step()`; `time = tick * deltaTime` is computed by **multiplication, never accumulated** (adding 0.1 ten times gives `0.9999999999999999`, while `10 * 0.1` is exactly `1`). A tick is a non-negative safe integer; advancing past `Number.MAX_SAFE_INTEGER` is an error. No wall-clock source is read anywhere in the engine (enforced by lint).

`World.step()` is a flat list of system calls, and only `World` orders them; a system mutates only what it owns. The list is empty today: the clock is the only thing a step changes.

## 5. Iteration order

- No system, hash, snapshot or event may depend on JS object or property enumeration order.
- Entity stores iterate in a defined order (ascending id, or ascending tile index for tile layers). `Map`/`Set` are allowed only where their iteration order is the insertion order the code controls and never feeds into results unsorted.
- ESLint bans `for...in`, `Object.keys/values/entries`, and `Array.prototype.sort` without a comparator (the default sort is lexicographic, not numeric).
- A sort with a comparator relies on the **stable sort guaranteed by ES2019** (equal elements keep their order). The nation spawner depends on this: it shuffles candidates and then stable-sorts by score, so ties stay randomly ordered.
- A `Set` iterates in insertion order, which is deterministic when the insertion loop is (nation provinces are inserted by a fixed nested loop), and is otherwise only used for membership tests.

## 6. Deterministic math

`math/transcendental.ts` provides `ln`, `exp` and `pow` built only from exact operations (fdlibm-style kernels: range reduction plus a minimax polynomial), accurate to about one unit in the last place. Domains; anything else throws `RangeError`:

| Function   | Domain                         | Notes                                                                |
| ---------- | ------------------------------ | -------------------------------------------------------------------- |
| `ln(x)`    | positive normal numbers        | subnormals, 0, negatives, NaN, Infinity throw                        |
| `exp(x)`   | finite `x <= 709.782712893384` | results below the smallest normal (`x < -708.3964185322641`) are `0` |
| `pow(x,y)` | finite `x >= 0`, finite `y`    | `pow(0,0)=1`; `pow(0,y<0)` and overflow throw; underflow is `0`      |

`pow` is `exp(y * ln x)`: accurate to about `1e-14` relative while `|y * ln x| <= 30`, and **not exact for integer powers**.

**Why own math.** Over 400,000 inputs, the platform `Math.pow(x, 1.4)` gives three different results (bit for bit) on Node 22 (V8 12.4), Chromium 157 (V8 14) and QuickJS, so even two V8 versions disagree. The engine's own `pow` gives the identical result on all three. (World hashes at small sizes would not show this, because elevation is stored as float32, which rounds away last-bit differences in almost every value; at 2000x2000 tiles a few values per world are expected to flip.)

### 6.1 Simplex noise

`noise/simplex.ts` provides `createSimplexNoise2D(random)`, a standard 2D simplex noise whose only inputs are a `RandomSource` and `(x, y)`; it uses `+ - * /`, `Math.sqrt` and `Math.floor` only.

- **Permutation**: `perm[0..255] = 0..255`, then for `i` from 0 to 254: `r = i + integer(0, 255 - i)`, swap `perm[i]` and `perm[r]`; `perm[256..511]` repeats `perm[0..255]`.
- **Gradients** (index `perm[..] % 12`): `(1,1) (-1,1) (1,-1) (-1,-1) (1,0) (-1,0) (1,0) (-1,0) (0,1) (0,-1) (0,1) (0,-1)`.
- **Constants**: `F2 = 0.5 * (sqrt(3) - 1)`, `G2 = (3 - sqrt(3)) / 6`, output scale `70.14805770653952` (range about `[-1, 1]`).
- Each noise layer takes its own named stream (section 3), so layers are independent. `sin`, `cos` and `atan2` are not provided yet; they will be implemented in the same file, with accuracy tests, when first needed. ESLint bans the platform equivalents in `packages/simulation/src`: `Math.sin/cos/tan/asin/acos/atan/atan2/log/log2/log10/log1p/exp/expm1/pow/hypot/cbrt/sinh/cosh/tanh/asinh/acosh/atanh`, `Math.random`, `Date.now`, `performance.now`, `new Date()` and the `**` operator.

### 6.2 Rank remap

`math/quantile.ts` gives a field the distribution a **profile** describes while keeping where everything is: each tile is ranked among the others and receives the profile's value for its rank, so the map is monotone (a higher tile never ends lower) and coastlines, ridges and latitude bands do not move. The terrain pipeline uses it for elevation, temperature and humidity (`docs/terrain.md`).

- **Profile**: knots `[quantile, value]`; the first at quantile 0, the last at quantile 1, quantiles strictly increasing, values never decreasing (a flat stretch is allowed). Anything else is a `RangeError`.
- **Histogram**: `HISTOGRAM_BINS = 65536` equal bins over [0, 1]; a value `v` falls in bin `b = floor(v * 65536)`, clamped to `0..65535`. Only tiles where the optional mask is non-zero are counted; every tile is remapped. Non-finite values are a `RangeError`.
- **Rank**: `below[b]` is the number of counted tiles in bins before `b`; for a tile with value `v` in bin `b`, `fraction = v * 65536 - b` and `q = (below[b] + fraction * count[b]) / total` (`0` if nothing was counted). Equal values therefore share the rank of the first of them.
- **Value**: the profile is evaluated at `q` by linear interpolation between its two surrounding knots (`v0 + (q - q0) / (q1 - q0) * (v1 - v0)`); `q` below 0 or above 1 gives the end values. The result is rounded to float32.
- **`scaleToUnit`**: `(v - min) / (max - min)` (a constant field becomes all zeros), used first because the generators leave their fields unclamped (clamping would create masses of identical tiles that no ranking can separate). Monotone, so ranks and ties are unchanged.

Only `+ - * /` and `Math.floor` are used: no sort, no transcendental function, nothing that depends on iteration order. **Reference vectors**, from an independent implementation written from this section in Python: on the 200 000-value LCG input described in `tests/quantile.test.ts`, the FNV-1a 32 of the float32 output bytes is `0x1728a133` for the ocean profile with no mask and `0x124bd9f9` for the temperature profile with every third tile masked out; small vectors are in the test file.

## 7. State hash

A state hash is a 32-character lowercase hex string (128 bits).

### 7.1 Byte encoding

| Writer              | Bytes                                                                                                                                                 |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `writeUint8`        | 1 byte                                                                                                                                                |
| `writeUint32`       | 4 bytes, big-endian                                                                                                                                   |
| `writeFloat64`      | 8 bytes: exact IEEE-754 bits, **big-endian** (`DataView.setFloat64(o, x, false)`), -0 canonicalized to +0, throws if non-finite                       |
| `writeString`       | `writeUint32(byteLength)` then the UTF-8 bytes                                                                                                        |
| `writeUint8Array`   | `writeUint32(length)` then the bytes                                                                                                                  |
| `writeFloat32Array` | `writeUint32(length)` then each value as 4 bytes of exact IEEE-754 float32 bits, **big-endian**; -0 is written as +0; throws if a value is non-finite |

Never decimal strings, `JSON.stringify` or `toFixed`.

### 7.2 Hash function

**cyrb128-style**, 4 x 32-bit lanes, fed one byte `k` at a time:

```text
init: h1 = 1779033703, h2 = 3144134277, h3 = 1013904242, h4 = 2773480762
per byte k:
  h1 = h2 ^ imul(h1 ^ k, 597399067)
  h2 = h3 ^ imul(h2 ^ k, 2869860233)
  h3 = h4 ^ imul(h3 ^ k, 951274213)
  h4 = h1 ^ imul(h4 ^ k, 2716044179)
finish:
  h1 = imul(h3 ^ (h1 >>> 18), 597399067)
  h2 = imul(h4 ^ (h2 >>> 22), 2869860233)
  h3 = imul(h1 ^ (h3 >>> 17), 951274213)
  h4 = imul(h2 ^ (h4 >>> 19), 2716044179)
  h1 ^= (h2 ^ h3 ^ h4); h2 ^= h1; h3 ^= h1; h4 ^= h1
output: hex(h1) hex(h2) hex(h3) hex(h4), each as 8 lowercase hex digits (uint32)
```

`digest()` does not consume state: more bytes may be written afterwards.

### 7.3 Canonical stream, schema versions

A state hash begins with the four ASCII bytes `SOVH`, then `writeUint32(HASH_SCHEMA_VERSION)`. Any change to the field list, order or encoding of what is hashed requires bumping `HASH_SCHEMA_VERSION` and regenerating the golden hashes with a rationale in the PR. Old versions stay documented here rather than being edited in place, so a reader can tell what an older golden entry actually hashed.

#### Version 3 (current)

The canonical layout of a world, written in this order (`World.stateHash()`), after the `SOVH` header and version:

1. `writeUint32(seed)` (the normalized engine seed), `writeFloat64(tick)`, `writeFloat64(timestep)`, `writeUint32(width)`, `writeUint32(height)`, `writeFloat64(seaLevel)` (the effective sea level after the land-ratio rescue).
2. The tile layers, each as one array writer (so each carries its length): `elevation`, `temperature`, `humidity` as `writeFloat32Array`; `biomeIds`, `riverMask`, `riverWidth`, then the six resource arrays (`surface.type`, `surface.richness`, `surface.stock`, `ground.type`, `ground.richness`, `ground.stock`, in that order), then `ownership`, all as `writeUint8Array`. A resource's stock is state (it changes by extraction and regrowth), so it is hashed along with the static type and richness.
3. Strategic points: `writeUint32(count)`, then for each `x` (uint32), `y` (uint32), `type` (string), `value` (float64). Then the route hubs: `writeUint32(count)`, then for each `x` (uint32), `y` (uint32), `weight` (float64). Then the routes: `writeUint32(count)`, then for each `from` (uint32), `to` (uint32), `cost` (float64), `traffic` (float64), `writeUint32(path length)` and each path value as uint32.
4. Nations: `writeUint32(count)`, then for each: `id` (string), `name` (string), the colour as three `writeUint8`, the flag `type` (string), `background` and `accent` (three float64 each), a `writeUint8` of 0 or 1 for whether there is a `detail` colour (and, if 1, its three float64), `government` (string), the personality (`aggression`, `expansionism`, `diplomacy`, `mercantilism`, `militarism`, float64 each, in that order), `capital` (uint32), `founded` (float64), the stats (`population`, `military`, `economy`, `diplomacy`, float64 each, in that order), the profile of its land (`area`, `food`, `timber`, `stone`, `horses`, `metals`, `luxuries`, `diversity`, `coast`, `river`, `highGround`, `defence`, `traffic`, `contacts`, float64 each, in that order), then `writeUint32(tile count)` and each owned tile index as uint32 **in the order the tiles were claimed**.

#### Version 2 (superseded by version 3)

The layout with two resource slots per tile and no route network and no nation profile (it differed from version 3 in steps 3 and 4 only). Written in this order (`World.stateHash()`), after the `SOVH` header and version:

1. `writeUint32(seed)` (the normalized engine seed), `writeFloat64(tick)`, `writeFloat64(timestep)`, `writeUint32(width)`, `writeUint32(height)`, `writeFloat64(seaLevel)` (the effective sea level after the land-ratio rescue).
2. The tile layers, each as one array writer (so each carries its length): `elevation`, `temperature`, `humidity` as `writeFloat32Array`; `biomeIds`, `riverMask`, `riverWidth`, then the six resource arrays (`surface.type`, `surface.richness`, `surface.stock`, `ground.type`, `ground.richness`, `ground.stock`, in that order), then `ownership`, all as `writeUint8Array`. A resource's stock is state (it changes by extraction and regrowth), so it is hashed along with the static type and richness.
3. Strategic points: `writeUint32(count)`, then for each `x` (uint32), `y` (uint32), `type` (string), `value` (float64).
4. Nations: `writeUint32(count)`, then for each: `id` (string), `name` (string), the colour as three `writeUint8`, the flag `type` (string), `background` and `accent` (three float64 each), a `writeUint8` of 0 or 1 for whether there is a `detail` colour (and, if 1, its three float64), `government` (string), the personality (`aggression`, `expansionism`, `diplomacy`, `mercantilism`, `militarism`, float64 each, in that order), `capital` (uint32), `founded` (float64), the stats (`population`, `military`, `economy`, `diplomacy`, float64 each, in that order), then `writeUint32(tile count)` and each owned tile index as uint32 **in the order the tiles were claimed**.

#### Version 1 (superseded by version 2)

The first canonical layout, with one resource per tile; it differed from version 2 only in step 2 (the layers were `biomeIds`, `riverMask`, `riverWidth`, `resourceType`, `resourceDensity`, `ownership`). Written in this order (`World.stateHash()`), after the `SOVH` header and version:

1. `writeUint32(seed)` (the normalized engine seed), `writeFloat64(tick)`, `writeFloat64(timestep)`, `writeUint32(width)`, `writeUint32(height)`, `writeFloat64(seaLevel)` (the effective sea level after the land-ratio rescue).
2. The tile layers, each as one array writer (so each carries its length): `elevation`, `temperature`, `humidity` as `writeFloat32Array`; `biomeIds`, `riverMask`, `riverWidth`, `resourceType`, `resourceDensity` and `ownership` as `writeUint8Array`.
3. Strategic points: `writeUint32(count)`, then for each `x` (uint32), `y` (uint32), `type` (string), `value` (float64).
4. Nations: `writeUint32(count)`, then for each: `id` (string), `name` (string), the colour as three `writeUint8`, the flag `type` (string), `background` and `accent` (three float64 each), a `writeUint8` of 0 or 1 for whether there is a `detail` colour (and, if 1, its three float64), `government` (string), the personality (`aggression`, `expansionism`, `diplomacy`, `mercantilism`, `militarism`, float64 each, in that order), `capital` (uint32), `founded` (float64), the stats (`population`, `military`, `economy`, `diplomacy`, float64 each, in that order), then `writeUint32(tile count)` and each owned tile index as uint32 **in the order the tiles were claimed**.

Fields are always written by name in this fixed order, never by enumerating an object. The configuration is not hashed on its own: what it produced is, and the timestep is.

## 8. Golden hashes

Golden files live in `packages/simulation/tests/determinism/golden/` and record `{ hashSchemaVersion, entries }`, where each entry pins a seed, a config (as overrides), a tick count and the expected `stateHash()`. `tests/determinism/golden.test.ts` first compares the golden's `hashSchemaVersion` with `HASH_SCHEMA_VERSION`, so a layout change yields an explicit "bump the version and regenerate" message instead of an opaque mismatch, and each entry also has to pass `world.validate()`. Regenerating goldens is a deliberate act, in its own commit, with the reason in the PR.

They are regression pins: the correctness of what is under them (RNG, noise, math, hashing) is established by the independent-reference tests. They were also verified to be identical, directly and after a save then load, on three engines: Node 22 (V8 12.4), Chromium 157 (V8 14) and QuickJS (WASM, not V8).

## 9. Test vectors

Produced by an independent reference implementation written from this document alone (Python integers and masks), and reproduced by the engine's tests. Hex values are lowercase. "Header" is `SOVH` and `writeUint32(3)` (schema version 3); the reference also reproduces the version 1 and 2 values (it takes the version as a parameter).

**xoshiro128\*\* reference** (state `[1, 2, 3, 4]`, decimal): `11520, 0, 5927040, 70819200, 2031721883`.

**splitmix32** from state `0`: `92ca2f0e, 3cd6e3f3, 1b147dcc, 4c081dbf`.

**FNV-1a 32**: empty input `811c9dc5`; `"a"` `e40c292c`; `"foobar"` `bf9cf968`.

**Stream derivation** (the words are the splitmix32 outputs; then the first five `nextUint32()` values):

| seed       | stream       | state words                           | first five outputs                             |
| ---------- | ------------ | ------------------------------------- | ---------------------------------------------- |
| 0          | `elevation`  | `d7117f9b 523f7bff ed700d00 ba2b3334` | `9465ec35 43d34a24 94346339 ac916aeb acb5aba7` |
| 12345      | `elevation`  | `cba02774 fb23c1a8 8c5232ad b1b025b4` | `a485480b 712bf198 72c5e0e1 00a8c92a 571d3632` |
| 12345      | `names`      | `dab067d8 2f43aa12 632c8641 d85fd031` | `72729926 a023bbc1 fc7ffd3e 92c7e46a aa0873a8` |
| 4294967295 | `spawn`      | `41d56cd8 56bedb81 3573cf20 9e377b4a` | `c64ad998 2696a57d 7a6555bd f977a8fb 3f481221` |
| 305419896  | `names`      | `d3f7002d 50479d51 2fb26b38 0084542d` | `4b53a108 42a4fb9e 801f0396 f9e669e5 e7141911` |
| 3735928559 | `elevation`  | `c44a5996 67216423 fad07633 a8145af7` | `6f4d1389 f6234a60 35190a94 b509b022 f59b0c3e` |
| 16711936   | `spawn`      | `bfc5cce7 6d0a67b5 a870f99c 9b605bb9` | `6a1d6910 d0c71cc2 6744c741 91ff3c09 3339f064` |
| 0          | `riverWarpX` | `fc34eb54 7493dfbc eefa770f 9ab03e43` | `ff2a073b 3277d1f7 beb686bb 7ec2aba3 935d3898` |

The seeds `305419896` (`0x12345678`), `3735928559` (`0xdeadbeef`) and `16711936` (`0x00ff0100`) have distinct bytes, so an error in the byte order of the seed encoding cannot go unnoticed.

**`float()`**, from the state words of seed `12345`, stream `elevation`, first three: `0.642658713773465, 0.448331885058995, 0.34028948229342704`.

**All-zero fallback**: with the fallback constant as state, the first three outputs are `92dcf72a, 00544cb2, 3c7807cc`.

**Seed normalization**: `"sovereign"` is `a3579d13`; `"héllo ✓"` is `b4ab03a7`; `"4294967296"` is `a5d2f78f`; `"99999999999"` is `f695eb82`; `"007"` is `e2cb360e`.

**Simplex noise** (stream `elevation`, seed `12345`; produced by an independent reference and reproduced exactly):

| `(x, y)`                 | value                                                        |
| ------------------------ | ------------------------------------------------------------ |
| `(0.5, 0.5)`             | `-0.3078061834694493`                                        |
| `(1.3, -2.7)`            | `0.4213085827898947`                                         |
| `(-10.25, 33.125)`       | `0.6233383467908111`                                         |
| `(123.456, 789.012)`     | `-0.18378226453632554`                                       |
| `(3, 7.928203230275509)` | `0.24150037923003204` (one ulp below a skewed-cell boundary) |
| `(3, 7.92820323027551)`  | `0.2415003792300292` (exactly on it, so the next cell)       |

**Math goldens** (FNV-1a 32 over the exact IEEE-754 bytes of every result; identical on Node 22, Chromium 157 and QuickJS): `ln` over 461,208 points from `1e-300` to `1e300` (`x *= 1.003`) `d390efa5`; `exp` over `i * 0.003` for `i` in `-233333..233333` `793b0ab8`; `pow((i + 0.5) / 400000, 1.4)` `5f886638`; `pow((i + 0.5) / 400000 * 50, 0.5)` `78829315`.

**Hash** (bytes exactly as written by the writers in 7.1; the header is `"SOVH"` then `writeUint32(1)`):

| Input                                                                                                              | Output                             |
| ------------------------------------------------------------------------------------------------------------------ | ---------------------------------- |
| no bytes                                                                                                           | `027ae52ecfc796215593990d4b41437c` |
| header only                                                                                                        | `59304f23a6ec6a13837e6f4f00cf30dc` |
| header, `writeUint32(7)`, `writeFloat64(-0)`, `writeFloat64(0.5)`, `writeUint8(1)`                                 | `d680575fa78efdb13e30d5dd8bf08ed8` |
| same with `writeFloat64(+0)` instead of `-0` (proves canonicalization)                                             | `d680575fa78efdb13e30d5dd8bf08ed8` |
| header, `writeString("héllo ✓ 🌍")`                                                                                | `5e9bf25b8111630e9950a5e12e44c2e0` |
| header, `writeUint8Array([0, 1, 2, 255, 128])`                                                                     | `1a2fab9a33c38d3817d36845b694499b` |
| header, `writeUint8Array([])`                                                                                      | `eabec1ed9acf947c25584f8646894d0c` |
| header, `writeFloat32Array([0.5, -0, 1/3, 3.4028234663852886e38, 1.401298464324817e-45, -2.5])` (1/3 as a float32) | `264ca0b4aae35d3172e6f88d1e34f33c` |
| header, `writeUint8Array([0, 1, 2, 255, 128])`, `writeFloat32Array([1.5, -0.25])`                                  | `979d8b3c3cf573387273459ceaa8836a` |

**Deterministic math accuracy.** `ln`, `exp` and `pow` are tested against the platform functions: within `2.3e-16` relative (about one ulp) for `ln` over `1e-300..1e300` and for `exp` over `-700..700`, and within `1e-14` relative for `pow` where `|y * ln x| <= 30`. The platform functions are only an oracle in tests, which are exempt from the lint bans.

## 10. Enforcement summary

| Rule                                                                | Enforced by                                                                                  |
| ------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| No platform transcendentals, `Math.random`, wall clock, `**`        | ESLint, `packages/simulation/src` (tested in `tests/lint-rules.test.ts`)                     |
| No `for...in`, `Object.keys/values/entries`, comparator-less `sort` | ESLint, `packages/simulation/src`                                                            |
| No browser, React, Pixi or Electron in the engine                   | ESLint (`no-restricted-globals`, `no-restricted-imports`)                                    |
| No `alea` / `simplex-noise` in the engine; every stream is used     | `tests/no-legacy-rng.test.ts`, `tests/stream-usage.test.ts`                                  |
| Noise, RNG and math match independent references, bit for bit       | `tests/simplex.test.ts`, `tests/streams.test.ts`, `tests/transcendental*.test.ts`            |
| The rank remap matches an independent reference, bit for bit        | `tests/quantile.test.ts`                                                                     |
| All 26 biomes generate, the ocean is pinned, shares stay in band    | `tests/determinism/biome-coverage.test.ts`; the full measurement is `pnpm probe`             |
| Stream list, hash version and this document stay in sync            | `tests/stream-usage.test.ts`                                                                 |
| Bit-exact reproducibility of whole worlds, and saves round-tripping | Golden hashes (`tests/determinism/golden.test.ts`), `tests/save.test.ts`, `World.validate()` |
