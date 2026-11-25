/**
 * Security tests for the publish path and the overlay's gitlink guard.
 *
 * These assert the DEFENCES, not the absence of an attack: the workflow text is
 * parsed and the publish script is executed against a throwaway directory, so a
 * regression that reintroduces a token leak fails here.
 *
 * The publish script builds its manifest from an allowlist instead of copying
 * the repository's, publishes with `--ignore-scripts` from a directory that
 * contains no repo config, and pins `--registry`. Each property is checked
 * separately because each closes a different hole.
 */
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { after, before, describe, it } from 'node:test'

import { linkDirectory } from './support/link.mjs'

const run = promisify(execFile)
const repo = join(dirname(fileURLToPath(import.meta.url)), '..')

/** The publish job's steps, parsed out of the workflow. */
async function publishSteps() {
  const { parse } = await import('yaml')
  const doc = parse(await readFile(join(repo, '.github/workflows/validate.yml'), 'utf8'))
  // The package root is assembled by the BUILD job; the publish job only
  // downloads the artifact. Both are needed to check the pipeline end to end.
  return [...doc.jobs.build.steps, ...doc.jobs.publish.steps]
}

/** A step by name, or a failure that names what is missing. */
function step(steps, name) {
  const found = steps.find((entry) => entry.name === name)
  assert.ok(found !== undefined, `no step named ${name}`)
  return found
}

describe('publish hardening', () => {
  let steps

  before(async () => {
    steps = await publishSteps()
  })

  it('runs npm publish with --ignore-scripts and an explicit registry', async () => {
    const publish = step(steps, 'Publish')
    assert.match(publish.run, /--ignore-scripts/u, 'lifecycle scripts must not run at publish time')
    assert.match(publish.run, /--registry https:\/\/registry\.npmjs\.org\//u,
      'the registry must be pinned so a repo .npmrc cannot redirect it')
  })

  it('publishes from a directory outside the checkout', async () => {
    const publish = step(steps, 'Publish')
    assert.match(publish.run, /mktemp -d/u, 'a temp dir keeps the repo .npmrc out of npm config lookup')
    assert.match(publish.run, /cd "\$publish_dir"/u, 'the publish must run inside that dir')
    // And it must not publish the in-repo path.
    assert.doesNotMatch(publish.run, /npm publish\s+\.\/pkgroot/u,
      'publishing ./pkgroot re-reads the repository config')
  })

  it('builds the published manifest from an allowlist, not from package.json', async () => {
    const assemble = step(steps, 'Assemble the package root')
    // The old shape: read the repo manifest, mutate it.
    assert.doesNotMatch(assemble.run, /JSON\.parse\(fs\.readFileSync\('package\.json'/u,
      'copying the repository manifest carries scripts/publishConfig/dependencies into the published package')
    // The new shape: a literal object, plus a runtime assertion on the keys.
    assert.match(assemble.run, /const pkg = \{/u)
    assert.match(assemble.run, /allowed = \[/u, 'a key allowlist must be asserted at build time')
  })

  it('references the publish token only in the isolated Publish step', async () => {
    // The token may only appear in the publish step, which runs no repository
    // code. Naming it `NPM_TOKEN` (not `NODE_AUTH_TOKEN`) is deliberate: the
    // value is written into a private .npmrc, so it never has to be visible to
    // npm as an environment credential a stray config could pick up.
    const withToken = steps.filter((entry) => JSON.stringify(entry.env ?? {}).includes('secrets.NPM_TOKEN'))
    assert.equal(withToken.length, 1, `secrets.NPM_TOKEN is referenced by ${String(withToken.length)} steps`)
    assert.equal(withToken[0].name, 'Publish')
  })

  it('publishes with OIDC when no token is configured', async () => {
    // The package is brand new, so the first publish needs a Granular Access
    // Token (npm cannot register a trusted publisher for a package that does
    // not exist yet). Every publish after that should run tokenless, which is
    // what `id-token: write` plus the token-optional branch provides.
    const { parse } = await import('yaml')
    const doc = parse(await readFile(join(repo, '.github/workflows/validate.yml'), 'utf8'))
    assert.equal(doc.jobs.publish.permissions['id-token'], 'write',
      'npm trusted publishing needs an OIDC token from the runner')
    const publish = doc.jobs.publish.steps.find((entry) => entry.name === 'Publish')
    assert.ok(publish !== undefined, 'no Publish step')
    // The auth line is written only when a token exists...
    assert.match(publish.run, /if \[ -n "\$\{NPM_TOKEN:-\}" \]/u,
      'the step must branch on whether a token is configured')
    // ...and the OIDC path must not be blocked by a stale token requirement.
    assert.match(publish.run, /using OIDC trusted publishing/u)
  })
})

describe('workflow permissions', () => {
  it('does not grant pull-requests:write to publish or toolchain', async () => {
    const { parse } = await import('yaml')
    const doc = parse(await readFile(join(repo, '.github/workflows/validate.yml'), 'utf8'))
    assert.deepEqual(doc.permissions, { contents: 'read' }, 'the workflow default must be read-only')
    // Only the validate job needs to comment.
    assert.equal(doc.jobs.validate.permissions['pull-requests'], 'write')
    for (const name of ['publish', 'toolchain']) {
      const perms = doc.jobs[name].permissions ?? {}
      assert.notEqual(perms['pull-requests'], 'write', `${name} must not have PR write access`)
    }
  })

  it('disables credential persistence in every checkout', async () => {
    const { parse } = await import('yaml')
    const doc = parse(await readFile(join(repo, '.github/workflows/validate.yml'), 'utf8'))
    for (const [name, job] of Object.entries(doc.jobs)) {
      for (const entry of job.steps ?? []) {
        if (entry.uses?.startsWith('actions/checkout') !== true) continue
        assert.equal(entry.with?.['persist-credentials'], false,
          `${name}: a checkout without persist-credentials:false leaves a token in .git/config`)
      }
    }
  })

  it('the toolchain job references no secrets', async () => {
    const doc = await (await import('yaml')).parse(await readFile(join(repo, '.github/workflows/validate.yml'), 'utf8'))
    const serialized = JSON.stringify(doc.jobs.toolchain)
    assert.doesNotMatch(serialized, /secrets\./u,
      'the job that runs PR code must not have any secret in scope')
  })
})

describe('overlay gitlink guard', () => {
  let sandbox

  before(async () => {
    sandbox = await mkdtemp(join(tmpdir(), 'gitlink-'))
    await cp(join(repo, 'scripts'), join(sandbox, 'scripts'), { recursive: true })
    await linkDirectory(join(sandbox, 'node_modules'), join(repo, 'node_modules'))
  })

  after(async () => {
    await rm(sandbox, { recursive: true, force: true })
  })

  it('rejects an empty directory under suites/ (a gitlink after tar export)', async () => {
    await rm(join(sandbox, 'tree'), { recursive: true, force: true })
    await mkdir(join(sandbox, 'tree/suites/probe/pkg/evil'), { recursive: true })
    await writeFile(join(sandbox, 'tree/suites/probe/pkg/1.0.0.yml'), 'id: p\n', 'utf8')

    const windows = process.platform === 'win32'
    const toBash = (p) => windows ? p.replace(/\\/gu, '/').replace(/^([A-Za-z]):/u, (_, d) => `/mnt/${d.toLowerCase()}`) : p
    const args = windows
      ? ['-d', 'Ubuntu-24.04', '--', 'bash', toBash(join(sandbox, 'scripts/overlay-suites.sh')), toBash(join(sandbox, 'tree')), toBash(join(sandbox, 'tree/out'))]
      : [join(sandbox, 'scripts/overlay-suites.sh'), join(sandbox, 'tree'), join(sandbox, 'tree/out')]
    const result = await run(windows ? 'wsl' : 'bash', args).then(
      (out) => ({ ok: true, ...out }),
      (error) => ({ ok: false, text: `${error.stdout ?? ''}\n${error.stderr ?? ''}` }),
    )
    assert.equal(result.ok, false, result.text)
    assert.match(result.text, /empty directory under suites/u)
  })
})
