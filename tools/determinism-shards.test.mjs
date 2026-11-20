import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { test } from 'node:test'

// The determinism job runs the suite in shards named by file in .github/workflows/quality.yml. A
// test file that no shard names would silently never run in CI, and one named twice would run
// twice, so the lists are held to the directory.
const workflow = readFileSync('.github/workflows/quality.yml', 'utf8')
const onDisk = readdirSync('packages/simulation/tests/determinism')
  .filter((name) => name.endsWith('.test.ts'))
  .map((name) => `tests/determinism/${name}`)
  .sort()
const named = [...workflow.matchAll(/tests\/determinism\/[\w.-]+\.test\.ts/g)]
  .map((match) => match[0])
  .sort()
// Each file appears once per operating system in the matrix, so the list is checked once.
const shardLines = [...workflow.matchAll(/^\s+files: (.+)$/gm)].map((match) => match[1].trim())

test('every determinism test file is in exactly one CI shard', () => {
  assert.deepEqual(named, onDisk)
})

test('the determinism job is sharded and has no empty shard', () => {
  assert.ok(shardLines.length >= 2, 'the determinism job should be sharded')
  for (const files of shardLines) assert.ok(files.split(/\s+/).every((f) => f.endsWith('.test.ts')))
})

test('the determinism job runs on Linux and Windows, and is not allowed to fail', () => {
  assert.match(workflow, /os: \[ubuntu-latest, windows-latest\]/)
  const job = workflow.slice(workflow.indexOf('  determinism:'), workflow.indexOf('  pages:'))
  assert.doesNotMatch(job, /continue-on-error/)
})
