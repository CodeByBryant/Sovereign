# Save format

A save is the exact state of a `World` as bytes. The engine produces and reads it (`encodeWorld` / `decodeWorld` in `packages/simulation/src/serialization/save.ts`); where the bytes are kept (IndexedDB, a file) is the host's business. A save is **untrusted input**: every way a file can be wrong is a `SaveFormatError` with a message that says what, and the decoder never builds a half-valid world.

This is separate from the state **hash** ([determinism.md](determinism.md), section 7): a hash is a fingerprint, a save is the data. Decoding a save and hashing the result gives the hash of the world that was saved, on any engine.

## Layout (version 1)

```text
bytes 0..3    magic "SOVW" (0x53 0x4f 0x56 0x57)
bytes 4..7    format version, uint32 big-endian (1)
bytes 8..11   header length N, uint32 big-endian
bytes 12..    header: N bytes of UTF-8 JSON
then          nine tile layers, each width * height long, in this order:
                elevation, temperature, humidity          float32, little-endian
                biome ids, river mask, river width,
                resource type, resource density,
                ownership                                  one byte each
```

The header is a JSON object with `seed` (the normalized uint32), `tick`, `width`, `height`, `seaLevel` (the effective one), `config` (the full resolved world config), `strategicPoints` (`x`, `y`, `type`, `value`) and `nations` (every field of a nation, with its `provinces` as a list of tile indices in claim order). There is no layer length table: the layers' sizes follow from the config, and the file must be exactly the right size.

Encoding is deterministic: the same world always encodes to the same bytes, and `encode(decode(bytes))` equals `bytes`. Float layers are copied as raw little-endian bytes, so saving and loading are refused on a big-endian host rather than writing a file other machines would misread.

## What the decoder rejects

Each of these is a `SaveFormatError`:

- a file shorter than the 12-byte preamble, a wrong magic (each of the four bytes is checked), or a format version it does not know;
- a header length that runs past the end of the file, a header that is not valid UTF-8 or not JSON, or one that is missing a field;
- a malformed seed (not a uint32) or tick (not a non-negative safe integer), a header `width`/`height` that disagrees with the config, an invalid config (checked **before** any array is sized, so a hostile file cannot ask for gigabytes);
- tile layers that are not exactly the expected number of bytes (too short or too long);
- a nation or strategic point with a malformed field;
- layer data that decodes to a world that fails `World.validate()`: a non-finite value, a biome id that does not exist, an ownership byte that names no nation, a nation tile that disagrees with the ownership layer, a capital that is not one of the nation's tiles, a tile outside the map.

`encodeWorld` in turn refuses to save a world that does not pass `validate()`, because JSON would turn a NaN into `null` and silently corrupt the file.

## Changing the format

Any change to the layout bumps `SAVE_FORMAT_VERSION`. Older versions are not migrated yet (pre-1.0); the web app drops saves of an older format when it upgrades its IndexedDB schema.
