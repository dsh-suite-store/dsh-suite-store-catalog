/**
 * Overlay helper: copy ONLY regular submission YAML into the validation tree.
 *
 * Two attacks:
 *   - suites/.gitignore with `*.yml` made a plain `git add -A` commit only the
 *     .gitignore; the YAML stayed in the worktree, so the worktree check passed
 *     while the diff/owner/G3 gates saw nothing.
 *   - a symlink under suites/ pointing outside the workspace would be read by
 *     build.mjs's walk()/readFile().
 *
 * The helper is a bash script that CI runs on Ubuntu. These tests invoke it
 * through WSL on Windows (and bash directly on Linux), because a mocked copy
 * would not exercise `find -type l` / `grep -E` semantics the guard relies on.
 */
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { after, before, describe, it } from 'node:test'

const run = promisify(execFile)
const helperSource = join(dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'overlay-suites.sh')
const windows = process.platform === 'win32'

/** Translate a Windows path to the WSL path the bash script sees. */
function toBash(p) {
  return windows ? p.replace(/\\/gu, '/').replace(/^([A-Za-z]):/u, (_, d) => `/mnt/${d.toLowerCase()}`) : p
}

/**
 * A copy of the helper with LF endings, in a temp directory.
 *
 * Git for Windows rewrites `*.sh` to CRLF under `core.autocrlf=true`, and bash
 * then reads `set -euo pipefail` as `pipefail\r` and exits with "invalid option
 * name" — every test below failed from a clean Windows checkout for that
 * reason. `.gitattributes` (`*.sh text eol=lf`) fixes the checkout, and this
 * normalisation makes the test independent of how the file happens to be on
 * disk, so a contributor's stale checkout cannot fail the suite.
 *
 * @returns the path to the executable copy.
 */
async function lfHelper() {
  const text = await readFile(helperSource, 'utf8')
  const dir = await mkdtemp(join(tmpdir(), 'overlay-helper-'))
  const path = join(dir, 'overlay-suites.sh')
  await writeFile(path, text.replace(/\r\n/gu, '\n'), 'utf8')
  return path
}

/** Run the helper with stdout/stderr captured. */
function overlay(src, dst, helper) {
  const args = windows
    ? ['-d', 'Ubuntu-24.04', '--', 'bash', toBash(helper), toBash(src), toBash(dst)]
    : [helper, src, dst]
  return run(windows ? 'wsl' : 'bash', args).then(
    (result) => ({ ok: true, ...result }),
    (error) => ({ ok: false, text: `${error.stdout ?? ''}\n${error.stderr ?? ''}` }),
  )
}

/** Build a fake PR tree; `extra` runs in bash so symlinks are real POSIX ones. */
async function prTree(extraBash = '') {
  const dir = await mkdtemp(join(tmpdir(), 'overlay-'))
  await mkdir(join(dir, 'suites/probe/pkg'), { recursive: true })
  await writeFile(join(dir, 'suites/probe/pkg/1.0.0.yml'), `id: pkg
owner: probe
version: 1.0.0
title:
  en: P
summary:
  en: S
category:
  primary: productivity
members:
  - plugin: probe/alpha
  - plugin: probe/beta
`, 'utf8')
  if (extraBash !== '') {
    await run(windows ? 'wsl' : 'bash', windows
      ? ['-d', 'Ubuntu-24.04', '--', 'bash', '-c', `cd "${toBash(dir)}" && ${extraBash}`]
      : ['-c', `cd "${dir}" && ${extraBash}`])
  }
  return dir
}

describe('overlay-suites', () => {
  const made = []
  let helper
  before(async () => {
    helper = await lfHelper()
    made.push(dirname(helper))
  })
  after(async () => {
    for (const dir of made.splice(0)) await rm(dir, { recursive: true, force: true })
  })

  it('copies only the valid YAML and reports its count', async () => {
    const src = await prTree()
    made.push(src)
    const result = await overlay(src, join(src, 'out'), helper)
    assert.equal(result.ok, true, result.text)
    assert.equal(result.stdout.trim().split('\n').at(-1), '1')
    assert.match(await readFile(join(src, 'out/probe/pkg/1.0.0.yml'), 'utf8'), /^id: pkg/)
  })

  it('rejects a PR-supplied .gitignore instead of copying around it', async () => {
    const src = await prTree("printf '*.yml\\n' > suites/.gitignore")
    made.push(src)
    const result = await overlay(src, join(src, 'out'), helper)
    assert.equal(result.ok, false, result.text)
    assert.match(result.text, /unexpected file under suites/u)
  })

  it('rejects a symlink under suites/', async () => {
    const src = await prTree('ln -s /dev/zero suites/probe/pkg/9.9.9.yml')
    made.push(src)
    const result = await overlay(src, join(src, 'out'), helper)
    assert.equal(result.ok, false, result.text)
    assert.match(result.text, /symlink under suites/u)
  })

  it('rejects a path that is not <owner>/<id>/<semver>.yml', async () => {
    const src = await prTree('mkdir -p suites/probe/pkg/extra && echo hi > suites/probe/pkg/extra/notes.txt')
    made.push(src)
    const result = await overlay(src, join(src, 'out'), helper)
    assert.equal(result.ok, false, result.text)
    assert.match(result.text, /unexpected file under suites/u)
  })

  it('rejects a filename containing a newline', async () => {
    // `1.0.0.yml<LF>JUNK` satisfied the old line-oriented grep on its FIRST
    // line, so an arbitrary non-YAML path was copied into the protected tree
    // while the validator (which requires the path to END in .yml) ignored it.
    const src = await prTree(`printf 'x\\n' > "suites/probe/pkg/1.0.0.yml\nJUNK"`)
    made.push(src)
    const result = await overlay(src, join(src, 'out'), helper)
    assert.equal(result.ok, false, result.text)
    assert.match(result.text, /control character in a suites\/ path/u)
    // And nothing was copied before the refusal.
    assert.equal((await readdir(join(src, 'out')).catch(() => [])).length, 0)
  })
})
