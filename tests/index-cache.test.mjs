import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, it } from 'node:test'

import { parse } from 'yaml'

const repo = join(dirname(fileURLToPath(import.meta.url)), '..')

async function validateSteps() {
  const doc = parse(await readFile(join(repo, '.github/workflows/validate.yml'), 'utf8'))
  return doc.jobs.validate.steps
}

function stepOf(steps, name) {
  const found = steps.find((entry) => entry.name === name)
  assert.ok(found !== undefined, `no step named ${name}`)
  return found
}

describe('plugin index cache freshness', () => {
  it('uses a UTC 30-minute cache window', async () => {
    const stamp = stepOf(await validateSteps(), 'Stamp the index cache window')
    assert.match(stamp.run, /date -u \+%s/u)
    assert.match(stamp.run, /\/ 1800/u)
  })

  it('fetches whenever the 30-minute cache key is not an exact hit', async () => {
    const steps = await validateSteps()
    const cache = stepOf(steps, 'Cache the plugin index')
    const fetch = stepOf(steps, 'Fetch the plugin index')

    assert.equal(cache.id, 'plugin-index-cache')
    assert.equal(cache.with.key, 'plugin-index-${{ steps.stamp.outputs.window }}')
    assert.equal(cache.with['restore-keys'], undefined)
    assert.equal(fetch.if, "steps.plugin-index-cache.outputs.cache-hit != 'true'")
  })
})