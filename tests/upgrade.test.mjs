/**
 * An integration test for the one thing a contributor actually does twice: bump a
 * version.
 *
 * `scripts.test.mjs` covers the pieces — `parseSubmissionPath`,
 * `assertVersionAdvances` — but nothing exercised the seam between them. The
 * cost of that gap is concrete: nobody had ever run "add 1.0.1.yml next to
 * 1.0.0.yml and build", so both the multi-version layout and the "which version
 * gets published" question were unverified.
 *
 * A real `check`/`build` subprocess is used rather than importing the functions,
 * because the rule under test spans three modules (`validate` sees one file,
 * `build` sees the directory, `catalog` decides what to print). A unit test on
 * any one of them would pass while the pipeline disagreed.
 *
 * The plugin index is a tiny local file passed with `--index`: the real one is a
 * 15 MB download, and a test that needs the network is a test that fails for the
 * wrong reason.
 */

import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { after, before, describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

import { linkDirectory } from './support/link.mjs'

const run = promisify(execFile)
const repo = join(dirname(fileURLToPath(import.meta.url)), '..')

/** A submission naming members the local index will hold. */
const MEMBERS = ['probe/alpha', 'probe/beta', 'probe/gamma', 'probe/delta']

/**
 * One version's document.
 *
 * The member set varies per version on purpose: G13 rejects two versions of a
 * bundle that curate exactly the same members, so a version bump has to change
 * something. G4 also requires at least two members, so the smallest set here is
 * two. Writing the same set into every file made every multi-version test fail
 * on G13 rather than on the rule under test — which is how this was found.
 *
 * @param version - the MAJOR.MINOR.PATCH to stamp.
 * @param extra - extra members beyond the minimum, 0 to 2.
 * @returns the YAML document.
 */
function submission(version, extra = 0) {
  // G4: MIN_MEMBERS is 2, so the base set is 2 and `extra` adds up to 2 more
  // (well under MAX_MEMBERS = 10).
  const members = MEMBERS.slice(0, 2 + extra)
  return `id: pkg
owner: 'probe'
version: ${version}
title:
  zh: '探针'
  en: 'Probe'
summary:
  zh: '集成测试用'
  en: 'For the integration test'
category:
  primary: productivity
members:
${members.map((ref) => `  - plugin: '${ref}'`).join('\n')}
`
}
let sandbox
let indexPath

/** Run a script inside the sandbox, returning stdout or throwing with both. */
async function sandboxRun(script, args, cwd = sandbox) {
  try {
    const { stdout } = await run('node', [join(sandbox, 'scripts', script), ...args], {
      cwd,
      timeout: 60_000,
    })
    return { ok: true, stdout }
  } catch (error) {
    return {
      ok: false,
      text: `${error.stdout ?? ''}\n${error.stderr ?? ''}`.trim(),
    }
  }
}

/**
 * Write one version of the probe submission.
 *
 * `extra` varies the member set, so two versions of the same bundle are not
 * rejected by G13 for being identical. It is derived from the version string so
 * callers cannot forget: more version segments means more members.
 *
 * @param version - the MAJOR.MINOR.PATCH to write.
 */
async function writeVersion(version) {
  const directory = join(sandbox, 'suites/probe/pkg')
  await mkdir(directory, { recursive: true })
  // 0.9.0 → 0 extra, 1.0.0 → 0 extra, 1.0.1 → 1 extra: distinct per version.
  const extra = version === '1.0.1' ? 1 : version === '0.9.0' ? 2 : 0
  await writeFile(join(directory, `${version}.yml`), submission(version, extra), 'utf8')
}

before(async () => {
  sandbox = await mkdtemp(join(tmpdir(), 'catalog-upgrade-'))
  // The sandbox must be a real repository root, or every relative path inside
  // the scripts resolves somewhere else.
  await cp(join(repo, 'scripts'), join(sandbox, 'scripts'), { recursive: true })
  await cp(join(repo, 'schema'), join(sandbox, 'schema'), { recursive: true })
  await cp(join(repo, 'package.json'), join(sandbox, 'package.json'))

  // `node_modules` is linked rather than copied: pnpm's tree is symlinks that a
  // Windows copy refuses to follow, and copying it on Linux would be slow. The
  // helper uses a junction on Windows and `fs.symlink` elsewhere — the hardcoded
  // `cmd` that used to be here is why this suite could never pass on ubuntu-latest.
  await linkDirectory(join(sandbox, 'node_modules'), join(repo, 'node_modules'))

  indexPath = join(sandbox, 'index.json')
  await writeFile(indexPath, JSON.stringify({
    plugins: MEMBERS.map((ref) => ({
      owner: ref.split('/')[0],
      name: ref.split('/')[1],
      description: 'probe member',
      stars: 10,
      default_branch: 'main',
      pushed_at: '2026-01-01T00:00:00Z',
      created_at: '2025-01-01T00:00:00Z',
      topics: [],
      capabilities: [],
    })),
  }), 'utf8')
})

after(async () => {
  await rm(sandbox, { recursive: true, force: true })
})

describe('a version bump, end to end', () => {
  it('publishes the highest version, not the newest file on disk', async () => {
    await rm(join(sandbox, 'suites'), { recursive: true, force: true })
    await writeVersion('1.0.0')
    await writeVersion('1.0.1')

    const checked = await sandboxRun('catalog.mjs', ['check', '--index', indexPath])
    assert.equal(checked.ok, true, checked.text)

    const built = await sandboxRun('catalog.mjs', ['build', '--index', indexPath])
    assert.equal(built.ok, true, built.text)

    const index = JSON.parse(await readFile(join(sandbox, 'dist/index.json'), 'utf8'))
    assert.equal(index.bundles.length, 1)
    // The published version is the HIGHEST, not whichever file was read last.
    assert.equal(index.bundles[0].version, '1.0.1')
    // ONE artifact: the catalog is a single JSON document, so there is no
    // `detail` pointer and no per-bundle file to read.
    assert.equal(index.bundles[0].detail, undefined)
    assert.equal(existsSync(join(sandbox, 'dist/suites')), false)
  })

  it('carries the material that used to live in a detail document', async () => {
    // `readme` and `capabilities` were the only fields a detail document had
    // that its card did not. They now ride on the card, so the sheet reads the
    // same object the grid does.
    await rm(join(sandbox, 'suites'), { recursive: true, force: true })
    await writeVersion('1.0.0')

    const built = await sandboxRun('catalog.mjs', ['build', '--index', indexPath])
    assert.equal(built.ok, true, built.text)

    const card = JSON.parse(await readFile(join(sandbox, 'dist/index.json'), 'utf8')).bundles[0]
    // `readme` falls back to the summary when no `description` is given.
    assert.equal(card.readme.en, card.summary.en)
    assert.equal(card.readme.zh, card.summary.zh)
    // `capabilities` names the members behind each tag; the summary only lists
    // the tags. The fixture's two members both declare none, so the array is
    // present and empty rather than missing.
    assert.ok(Array.isArray(card.capabilities))
  })

  it('publishes the icon on the card', async () => {
    await rm(join(sandbox, 'suites'), { recursive: true, force: true })
    await writeVersion('1.0.0')
    const iconPath = join(sandbox, 'suites/probe/pkg/1.0.0.yml')
    const withIcon = (await readFile(iconPath, 'utf8'))
      .replace(/^owner: .*/m, "owner: 'someone'")
      .replace(/^id: .*/m, 'id: pkg')
    // Owner changed, so the directory has to match it (G1).
    await rm(join(sandbox, 'suites/probe'), { recursive: true, force: true })
    const dir = join(sandbox, 'suites/someone/pkg')
    await mkdir(dir, { recursive: true })
    await writeFile(
      join(dir, '1.0.0.yml'),
      `${withIcon.trimEnd()}\nicon: https://raw.githubusercontent.com/someone/repo/main/icon-180.png\n`,
      'utf8',
    )

    const built = await sandboxRun('catalog.mjs', ['build', '--index', indexPath])
    assert.equal(built.ok, true, built.text)

    const card = JSON.parse(await readFile(join(sandbox, 'dist/index.json'), 'utf8')).bundles[0]
    assert.equal(card.icon, 'https://raw.githubusercontent.com/someone/repo/main/icon-180.png')
  })

  it('falls back to the author avatar when no icon is submitted', async () => {
    // The rule a contributor relies on: leave the field out and the card still
    // has an image.
    await rm(join(sandbox, 'suites'), { recursive: true, force: true })
    const dir = join(sandbox, 'suites/someone/pkg')
    await mkdir(dir, { recursive: true })
    await writeFile(
      join(dir, '1.0.0.yml'),
      submission('1.0.0')
        .replace(/^owner: .*/m, "owner: 'someone'")
        .trimEnd() + '\n',
      'utf8',
    )

    const built = await sandboxRun('catalog.mjs', ['build', '--index', indexPath])
    assert.equal(built.ok, true, built.text)

    const index = JSON.parse(await readFile(join(sandbox, 'dist/index.json'), 'utf8'))
    assert.equal(index.bundles[0].icon, 'https://github.com/someone.png?size=180')
  })

  it('gives the first-party owner no avatar, so the client draws its default', async () => {
    // `dsh-suite-store` is the store itself. Pointing at that account's avatar
    // would show whatever it happens to have rather than the store's own mark.
    await rm(join(sandbox, 'suites'), { recursive: true, force: true })
    const dir = join(sandbox, 'suites/dsh-suite-store/pkg')
    await mkdir(dir, { recursive: true })
    await writeFile(
      join(dir, '1.0.0.yml'),
      submission('1.0.0')
        .replace(/^owner: .*/m, "owner: 'dsh-suite-store'")
        .trimEnd() + '\n',
      'utf8',
    )

    const built = await sandboxRun('catalog.mjs', ['build', '--index', indexPath])
    assert.equal(built.ok, true, built.text)

    const index = JSON.parse(await readFile(join(sandbox, 'dist/index.json'), 'utf8'))
    assert.equal(index.bundles[0].icon, null)
  })

  it('accepts an older version alongside newer ones for the whole repository', async () => {
    // A submitted old version IS the bundle's history, not a new release. G3
    // only requires the NEWEST to advance, so a whole-repository check passes.
    await rm(join(sandbox, 'suites'), { recursive: true, force: true })
    await writeVersion('1.0.0')
    await writeVersion('1.0.1')

    const checked = await sandboxRun('catalog.mjs', ['check', '--index', indexPath])
    assert.equal(checked.ok, true, checked.text)
    assert.match(checked.stdout, /2 submission\(s\)/u)
  })

  it('rejects an older version submitted on its own (the PR case)', async () => {
    // This is the shape CI uses on a PR: the changed file, checked alone. Here
    // the file is the thing being published, so it must advance.
    await rm(join(sandbox, 'suites'), { recursive: true, force: true })
    await writeVersion('1.0.0')
    await writeVersion('1.0.1')

    const checked = await sandboxRun('catalog.mjs', [
      'check', '--index', indexPath, 'suites/probe/pkg/0.9.0.yml',
    ])
    // The file does not exist yet, so that is a "no such submission" error; the
    // real assertion is on an existing-but-older file below.
    assert.equal(checked.ok, false)

    await writeVersion('0.9.0')
    const older = await sandboxRun('catalog.mjs', [
      'check', '--index', indexPath, 'suites/probe/pkg/0.9.0.yml',
    ])
    assert.equal(older.ok, false)
    assert.match(older.text, /G3/u)
    assert.match(older.text, /must be greater than the existing 1\.0\.1/u)
  })

  it('accepts the newest version when checked on its own', async () => {
    await rm(join(sandbox, 'suites'), { recursive: true, force: true })
    await writeVersion('1.0.0')
    await writeVersion('1.0.1')

    const checked = await sandboxRun('catalog.mjs', [
      'check', '--index', indexPath, 'suites/probe/pkg/1.0.1.yml',
    ])
    assert.equal(checked.ok, true, checked.text)
  })

  it('rejects re-submitting a version that already exists', async () => {
    await rm(join(sandbox, 'suites'), { recursive: true, force: true })
    await writeVersion('1.0.0')
    // A second file cannot share the version, but the *document* can disagree
    // with its file name, which is the mistake this catches.
    const directory = join(sandbox, 'suites/probe/pkg')
    await writeFile(
      join(directory, '1.0.1.yml'),
      submission('1.0.0', 1).replace(/^version: .*/m, 'version: 1.0.0'),
      'utf8',
    )
    const checked = await sandboxRun('catalog.mjs', [
      'check', '--index', indexPath, 'suites/probe/pkg/1.0.1.yml',
    ])
    assert.equal(checked.ok, false)
    assert.match(checked.text, /G1/u)
    assert.match(checked.text, /must equal the file name/u)
  })

  it('rejects a malformed version in the file name before anything else', async () => {
    await rm(join(sandbox, 'suites'), { recursive: true, force: true })
    const directory = join(sandbox, 'suites/probe/pkg')
    await mkdir(directory, { recursive: true })

    for (const file of ['1.0.yml', 'v1.0.0.yml', '01.0.0.yml', '1.0.0.0.yml', '1.0.0-beta.yml']) {
      await writeFile(join(directory, file), submission('1.0.0'), 'utf8')
      const checked = await sandboxRun('catalog.mjs', [
        'check', '--index', indexPath, `suites/probe/pkg/${file}`,
      ])
      assert.equal(checked.ok, false, `${file} should be rejected`)
      // The message names the version shape, not a downstream symptom: a
      // contributor has to be able to fix it from the error alone.
      assert.match(checked.text, /major>\.<minor>\.<patch>/u, `${file}: ${checked.text}`)
      await rm(join(directory, file), { force: true })
    }
  })
})
