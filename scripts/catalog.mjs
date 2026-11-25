#!/usr/bin/env node
/**
 * `check` and `build`, the two commands CI runs and a contributor can run.
 *
 * Both operate on the repository they are invoked in, so the same code path
 * serves the PR job, the release job and a local dry run.
 *
 * Usage:
 *   node scripts/catalog.mjs check           # validate every submission
 *   node scripts/catalog.mjs check <path>    # validate one (CI on a PR)
 *   node scripts/catalog.mjs check --base <ref>
 *                                            # ... and require every file this
 *                                            # change ADDS to advance (G3)
 *   node scripts/catalog.mjs build           # fetch the index, write dist/
 *   node scripts/catalog.mjs build --index <file>   # use a local index file
 */

import { execFileSync } from 'node:child_process'
import { readFile, readdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'

import { parse as parseYaml } from 'yaml'

import {
  INDEX_FILE,
  SUITES_DIR,
  buildCatalog,
  emptyDerived,
  readSubmissions,
  writeCatalog,
} from './build.mjs'
import { buildCatalogue, fetchEngines, fetchIndex, parsePluginRef } from './catalogue.mjs'
import { readCategories } from './categories.mjs'
import { GateError } from './validate.mjs'

const root = resolve(import.meta.dirname, '..')

/**
 * The catalogue, from a local file or the network.
 *
 * A local file exists for two reasons: CI can cache a 15 MB download between
 * jobs, and a contributor on a bad connection can point at a copy they already
 * have. Neither changes what is validated.
 */
async function loadCatalogue(indexPath) {
  if (indexPath === undefined) {
    const { source, catalogue } = await fetchIndex()
    console.log(`index: ${String(catalogue.count)} plugins from ${source}`)
    return catalogue
  }
  const text = await readFile(resolve(indexPath), 'utf8')
  const fromFile = buildCatalogue(JSON.parse(text))
  console.log(`index: ${String(fromFile.count)} plugins from ${indexPath}`)
  return fromFile
}

/**
 * The value of `--index`, or undefined when the flag is absent.
 *
 * `--index` with nothing (or another flag) after it used to become `undefined`
 * and silently fall through to a 15 MB network download, or resolve the next
 * flag as a file name.
 */
function indexArgument(rest) {
  const at = rest.indexOf('--index')
  if (at === -1) return undefined
  const value = rest[at + 1]
  if (value === undefined || value.startsWith('--')) {
    throw new Error('--index needs a file path after it (--index <plugins.json>)')
  }
  return value
}

/**
 * What this change does to `suites/`, as git reports it.
 *
 * `--diff-filter=A` alone answers "did this change add the file", which is what
 * G3 needs: a version file can be older than its bundle's newest and still be a
 * legitimate historical entry, so "is it older" cannot decide whether the gate
 * applies. "Did this change add it" can.
 *
 * But a diff is not only additions. Three ways around the gate were all live:
 *
 *   - RENAME `1.0.0.yml` to `0.9.0.yml`. Git reports one deletion and one
 *     addition; the new file exists in the worktree, so a check that only looks
 *     at the CURRENT tree sees nothing wrong and the downgrade passes.
 *   - DELETE `1.0.0.yml` and add `1.0.0.yaml`. The walk collects `.yml` only, so
 *     the owner's directory silently becomes empty and every gate passes.
 *   - DELETE everything. The build then publishes zero bundles and reports ok.
 *
 * Deletions are what all three have in common, so they are what this now
 * reports. `failClosed` is not an option here: a missing ref or a shallow clone
 * is not a submission fault, and turning it into a hard failure would break
 * every local run outside a full checkout. Silence is not an option either —
 * that is how the bypasses worked.
 *
 * @param base - the ref to diff against (e.g. `origin/main`).
 * @returns the added paths, the deleted paths, and whether git could answer.
 */
function changeAgainstBase(base) {
  try {
    const diff = (filter) => execFileSync(
      'git',
      ['diff', '--name-only', '--no-renames', ...(filter === undefined ? [] : [`--diff-filter=${filter}`]), `${base}...HEAD`, '--', `${SUITES_DIR}/`],
      { cwd: root, encoding: 'utf8' },
    ).split('\n').map((line) => line.trim()).filter((line) => line !== '')
    return { added: new Set(diff('A')), deleted: diff('D'), known: true }
  } catch (error) {
    // A missing ref or a checkout without git history is not a submission fault.
    // Say so loudly and keep checking: the version-advance gate then applies
    // only to the newest file, which is what a release build does anyway.
    console.warn(`check: could not diff against ${base} (${error.message.split('\n')[0]}); `
      + 'deleted files and newly added version files will not be checked')
    return { added: new Set(), deleted: [], known: false }
  }
}

function baseArgument(rest) {
  const at = rest.indexOf('--base')
  if (at === -1) return undefined
  const value = rest[at + 1]
  if (value === undefined || value.startsWith('--')) {
    throw new Error('--base needs a ref after it (--base origin/main)')
  }
  return value
}

async function main(argv) {
  const [command, ...rest] = argv
  // Engine probing is opt-in: it reads the registry once per distinct member,
  // which is worth it for a release and not for a PR check.
  const withEngines = rest.includes('--engines')
  const indexPath = indexArgument(rest)
  const indexAt = rest.indexOf('--index')
  const baseAt = rest.indexOf('--base')
  const only = rest.find((argument, at) => !argument.startsWith('--')
    && (indexAt === -1 || at !== indexAt + 1)
    && (baseAt === -1 || at !== baseAt + 1))

  if (command === 'check') {
    const catalogue = await loadCatalogue(indexPath)
    const categories = await readCategories()
    const base = baseArgument(rest)
    const change = base === undefined
      ? { added: new Set(), deleted: [], known: false }
      : changeAgainstBase(base)
    // When the caller EXPLICITLY named a base, an unreadable diff is a hard
    // error, not a reason to skip the version/deletion gates. CI passes
    // `--base`, so a typo in the ref, a shallow checkout or an oversized diff
    // used to fall back to "check the current tree only" and go green with no
    // deletion check. Local runs that never asked for a base keep the lenient
    // behaviour: a checkout without git history is not a submission fault.
    if (base !== undefined && !change.known) {
      throw new Error(`could not diff submissions against ${base}; refusing to check with the deletion and version gates disabled`)
    }
    // A deleted submission is a rewrite of the catalog's history, and it is how
    // three separate bypasses worked: rename-to-downgrade, delete-and-replace
    // with a non-.yml file, and delete-everything (which built an empty catalog
    // and reported ok). Refuse them as a class rather than naming each trick.
    if (change.deleted.length > 0) {
      throw new Error(
        `${String(change.deleted.length)} submission(s) deleted by this change — remove or edit a version file instead:\n`
        + change.deleted.map((path) => `  - ${path}`).join('\n'),
      )
    }
    const byBundle = await readSubmissions(root, catalogue, categories, {
      ...(only === undefined ? {} : { only }),
      ...(change.added.size === 0 ? {} : { added: change.added }),
    })
    const total = [...byBundle.values()].reduce((sum, versions) => sum + versions.length, 0)
    // A path that matched nothing is a typo, not an empty pass: CI passes the
    // changed file, and silently checking zero files would green a PR whose
    // submission never ran a gate.
    if (only !== undefined && total === 0) {
      throw new Error(`${only}: no such submission (is the path relative to the repo root?)`)
    }
    // An EMPTY catalog is not a valid catalog. `check` over a tree with no
    // submissions used to print "0 submission(s) … ok", which is the same
    // sentence a healthy run prints one number higher.
    if (total === 0) {
      throw new Error(`no submissions found under ${SUITES_DIR}/ — an empty catalog is not a valid release`)
    }
    console.log(`check: ${String(total)} submission(s) across ${String(byBundle.size)} bundle(s) — ok`)
    return
  }

  if (command === 'build') {
    const catalogue = await loadCatalogue(indexPath)
    const categories = await readCategories()
    if (withEngines) {
      // The probe has to finish before validation, because validation is what
      // copies the range onto each member. It also has to know WHICH packages
      // to ask about, which only the submissions say — so they are read once
      // cheaply (YAML only, no gates) to collect the names.
      const names = await memberNpmNames(root, catalogue)
      const started = Date.now()
      catalogue.engines = await fetchEngines(names, { concurrency: 1, timeoutMs: 8_000 })
      console.log(
        `engines: ${String(catalogue.engines.size)} of ${String(names.length)} member packages declare a dsh range ` +
        `(${String(Math.round((Date.now() - started) / 1000))}s)`,
      )
    }
    const byBundle = await readSubmissions(root, catalogue, categories)
    const derived = await withGitDates(emptyDerived(new Date().toISOString()), byBundle)
    const catalog = buildCatalog(byBundle, derived, categories)
    // An empty release is not a release. A tree whose submissions were all
    // deleted used to publish a catalog with zero bundles and print the same
    // shape of line a healthy build prints — so the publish job went green and
    // every user's store emptied.
    if (catalog.index.bundles.length === 0) {
      throw new Error(`no submissions found under ${SUITES_DIR}/ — refusing to write an empty catalog`)
    }
    const written = await writeCatalog(root, catalog)
    console.log(`build: ${String(written.cards)} bundle(s) -> ${INDEX_FILE}`)
    return
  }

  console.error('usage: catalog.mjs <check|build> [path] [--index <file>] [--engines]')
  process.exitCode = 2
}

/**
 * Every npm package the submissions name as a member.
 *
 * Deliberately unvalidated: this runs before the gates so the engine probe can
 * know its work, and a submission that fails a gate a moment later costs one
 * YAML parse, not a registry request. It must not BE the thing that reports a
 * broken submission either, so a file that does not parse is skipped and left
 * to the gate — the friendly bilingual message comes from there.
 */
async function memberNpmNames(root, catalogue) {
  const names = new Set()
  const walk = async (directory) => {
    let entries
    try {
      entries = await readdir(directory, { withFileTypes: true })
    } catch (error) {
      if (error?.code === 'ENOENT') return
      throw error
    }
    await Promise.all(entries.map(async (entry) => {
      // `join`, not string concatenation: the latter mixes separators on Windows.
      const path = join(directory, entry.name)
      if (entry.isDirectory()) return walk(path)
      if (!entry.name.endsWith('.yml')) return undefined
      let doc
      try {
        doc = parseYaml(await readFile(path, 'utf8'))
      } catch {
        return undefined
      }
      if (!Array.isArray(doc?.members)) return undefined
      for (const member of doc.members) {
        const ref = parsePluginRef(member?.plugin)
        const npm = ref === undefined ? undefined : catalogue.byRepo.get(ref.key)?.npm
        if (typeof npm === 'string' && npm !== '') names.add(npm)
      }
      return undefined
    }))
  }
  await walk(join(root, SUITES_DIR))
  return [...names]
}

/**
 * Stamp each submission with its git dates.
 *
 * Git is asked rather than stored: a date in the file would be one more field
 * a contributor can get wrong, and the commit already carries it. A build
 * outside a git checkout (a tarball, a CI shallow clone) simply falls back to
 * "now", which the card shows as "updated just now" — wrong but harmless,
 * and better than failing a build over metadata.
 *
 * `addedAt` records when the bundle FIRST appeared, so it is written only for
 * the oldest version: the loop runs oldest-first and every version has its own
 * "added" commit, which used to drift the date forward on each release.
 */
async function withGitDates(derived, byBundle) {
  const { execFile } = await import('node:child_process')
  const ask = (path, flags) => new Promise((settle) => {
    execFile('git', ['log', '-1', '--format=%aI', ...flags, '--', path], { cwd: root }, (error, stdout) => {
      // A spawn failure (`git` missing, EPERM) must degrade like a non-git
      // checkout, not abort the whole build over a metadata field.
      if (error !== null) return settle(undefined)
      const value = stdout.trim()
      settle(value === '' ? undefined : value)
    })
  })
  // Independent lookups: two `git log` spawns per version file, serialized,
  // dominated the build on a large catalogue.
  const lookups = []
  for (const versions of byBundle.values()) {
    for (const [at, entry] of versions.entries()) {
      lookups.push((async () => {
        const updated = await ask(entry.path, [])
        if (updated !== undefined) derived.updatedAt.set(entry.path, updated)
        if (at !== 0) return
        const added = await ask(entry.path, ['--diff-filter=A', '--follow'])
        const key = `${entry.owner}/${entry.id}`
        if (added !== undefined && !derived.addedAt.has(key)) derived.addedAt.set(key, added)
      })())
    }
  }
  await Promise.all(lookups)
  return derived
}

try {
  await main(process.argv.slice(2))
} catch (error) {
  if (error instanceof GateError) {
    // `message` is `${gate} ${path}: ${reason}`; strip that exact prefix
    // rather than a character count, which cut into the reason itself.
    const prefix = `${error.gate} ${error.path}: `
    const reason = error.message.startsWith(prefix) ? error.message.slice(prefix.length) : error.message
    console.error(`
${error.gate} failed at ${error.path}
  ${reason}
`)
  } else {
    console.error(`\n${error instanceof Error ? error.message : String(error)}\n`)
  }
  process.exitCode = 1
}
