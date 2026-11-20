/**
 * The executable entry point: wires the CLI to the real process and filesystem.
 * Run with `pnpm --filter @sovereign/simulator-cli start -- --seed 1 --ticks 100`.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { run } from './cli'

process.exitCode = run(process.argv.slice(2), {
  out: (text) => process.stdout.write(text),
  err: (text) => process.stderr.write(text),
  readFile: (path) => new Uint8Array(readFileSync(path)),
  writeFile: (path, bytes) => writeFileSync(path, bytes)
})
