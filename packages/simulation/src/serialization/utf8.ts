/**
 * UTF-8 encoding without `TextEncoder`, so the engine needs no DOM or Node types. A lone
 * surrogate is encoded as U+FFFD, matching `TextEncoder`.
 */
export function utf8Bytes(text: string): Uint8Array {
  const out: number[] = []
  for (let i = 0; i < text.length; i += 1) {
    let code = text.charCodeAt(i)
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = i + 1 < text.length ? text.charCodeAt(i + 1) : 0
      if (next >= 0xdc00 && next <= 0xdfff) {
        code = 0x10000 + ((code - 0xd800) << 10) + (next - 0xdc00)
        i += 1
      } else {
        code = 0xfffd
      }
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      code = 0xfffd
    }

    if (code < 0x80) {
      out.push(code)
    } else if (code < 0x800) {
      out.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f))
    } else if (code < 0x10000) {
      out.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f))
    } else {
      out.push(
        0xf0 | (code >> 18),
        0x80 | ((code >> 12) & 0x3f),
        0x80 | ((code >> 6) & 0x3f),
        0x80 | (code & 0x3f)
      )
    }
  }
  return Uint8Array.from(out)
}

/**
 * Strict UTF-8 decoding without `TextDecoder`. Malformed input (a stray continuation byte, a
 * truncated or overlong sequence, an encoded surrogate, a value above U+10FFFF) is a `RangeError`:
 * a save file is untrusted, and silently replacing bytes would hide corruption.
 */
export function utf8Decode(bytes: Uint8Array): string {
  const units: number[] = []
  let i = 0
  const fail = (at: number): never => {
    throw new RangeError(`invalid UTF-8 at byte ${at}`)
  }
  const continuation = (at: number): number => {
    const b = bytes[at]
    if (b === undefined || (b & 0xc0) !== 0x80) return fail(at)
    return b & 0x3f
  }
  while (i < bytes.length) {
    const b0 = bytes[i] as number
    let code: number
    if (b0 < 0x80) {
      code = b0
      i += 1
    } else if (b0 >= 0xc2 && b0 <= 0xdf) {
      code = ((b0 & 0x1f) << 6) | continuation(i + 1)
      i += 2
    } else if (b0 >= 0xe0 && b0 <= 0xef) {
      code = ((b0 & 0x0f) << 12) | (continuation(i + 1) << 6) | continuation(i + 2)
      if (code < 0x800 || (code >= 0xd800 && code <= 0xdfff)) return fail(i)
      i += 3
    } else if (b0 >= 0xf0 && b0 <= 0xf4) {
      code =
        ((b0 & 0x07) << 18) |
        (continuation(i + 1) << 12) |
        (continuation(i + 2) << 6) |
        continuation(i + 3)
      if (code < 0x10000 || code > 0x10ffff) return fail(i)
      i += 4
    } else {
      return fail(i)
    }
    if (code >= 0x10000) {
      const v = code - 0x10000
      units.push(0xd800 + (v >> 10), 0xdc00 + (v & 0x3ff))
    } else {
      units.push(code)
    }
  }
  // Build the string in chunks: String.fromCharCode(...) has an argument-count limit.
  let out = ''
  for (let k = 0; k < units.length; k += 8192) {
    out += String.fromCharCode(...units.slice(k, k + 8192))
  }
  return out
}
