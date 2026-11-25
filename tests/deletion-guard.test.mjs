/**
 * A change may not delete a submission.
 *
 * Three admission bypasses shared one trick — removing the file the gates were
 * going to look at:
 *
 *   1. RENAME `1.0.0.yml` to `0.9.0.yml`. Git reports R100, the new file exists
 *      in the worktree, and a check that only looks at the current tree sees
 *      nothing wrong; the version history was rewritten and the downgrade
 *      passed.
 *   2. DELETE `1.0.0.yml` and add `1.0.0.yaml`. The walk collects `.yml` only,
 *      so the owner's directory silently becomes empty and every gate passes.
 *   3. DELETE everything. The build published zero bundles and printed the same
 *      line a healthy build prints.
 *
 * A real git repository is used: the rule is about what `git diff` reports, and
 * `--no-renames` in particular only shows its value against a real rename.
 */
import assert from 'node:assert/strict'
import { execFile, execFileSync } from 'node:child_process'
import { cp, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { after, before, describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'

import { linkDirectory } from './support/link.mjs'

const repo = join(dirname(fileURLToPath(import.meta.url)), '..')

const MEMBERS = ['probe/alpha', 'probe/beta', 'probe/gamma']

/** One submission document. */
function submission(version, members = MEMBERS) {
  return `id: pkg
owner: 'probe'
version: ${version}
title:
  en: 'Probe'
summary:
  en: 'For the deletion-guard tests'
category:
  primary: productivity
members:
${members.map((ref) => `  - plugin: '${ref}'`).join('\n')}
`
}

let sandbox

function run(script, args) {
  return new Promise((resolve) => {
    execFile(
      'node',
      [join(sandbox, 'scripts', script), ...args],
      { cwd: sandbox, timeout: 90_000 },
      (error, stdout, stderr) => resolve({ ok: error === null, text: `${stdout}\n${stderr}` }),
    )
  })
}

const git = (...args) => execFileSync('git', args, { cwd: sandbox, encoding: 'utf8' })

function commit(message) {
  git('add', '-A')
  execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-m', message], { cwd: sandbox })
}

/** Start a branch from `main` with the working tree at the base state. */
function branch(name) {
  git('checkout', '-q', 'main')
  git('reset', '-q', '--hard', 'main')
  git('clean', '-qfd', 'suites')
  git('checkout', '-q', '-b', name)
}

before(async () => {
  sandbox = await mkdtemp(join(tmpdir(), 'catalog-delete-'))
  await cp(join(repo, 'scripts'), join(sandbox, 'scripts'), { recursive: true })
  await cp(join(repo, 'schema'), join(sandbox, 'schema'), { recursive: true })
  await cp(join(repo, 'package.json'), join(sandbox, 'package.json'))
  await linkDirectory(join(sandbox, 'node_modules'), join(repo, 'node_modules'))
  await writeFile(join(sandbox, '.gitignore'), 'node_modules/\n', 'utf8')
  await writeFile(join(sandbox, 'index.json'), JSON.stringify({
    plugins: MEMBERS.map((ref) => ({
      owner: 'probe', name: ref.split('/')[1], description: 'probe', stars: 5,
      default_branch: 'main', pushed_at: '2026-01-01T00:00:00Z',
      created_at: '2025-01-01T00:00:00Z', topics: [], capabilities: [],
    })),
  }), 'utf8')

  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: sandbox })
  execFileSync('git', ['config', 'user.email', 't@t'], { cwd: sandbox })
  execFileSync('git', ['config', 'user.name', 't'], { cwd: sandbox })
  await mkdir(join(sandbox, 'suites/probe/pkg'), { recursive: true })
  await writeFile(join(sandbox, 'suites/probe/pkg/1.0.0.yml'), submission('1.0.0'), 'utf8')
  commit('base: 1.0.0')
})

after(async () => {
  await rm(sandbox, { recursive: true, force: true })
})

describe('a change may not delete a submission', () => {
  it('accepts the untouched baseline', async () => {
    // Without this the three rejections below prove nothing: they could all be
    // failing for an unrelated reason.
    branch('baseline')
    const result = await run('catalog.mjs', ['check', '--base', 'main', '--index', 'index.json'])
    assert.equal(result.ok, true, result.text)
  })

  it('rejects a rename that downgrades the version', async () => {
    // `--diff-filter=D` alone sees nothing here: git reports R100, and the new
    // filename is present in the worktree. Only `--no-renames` exposes the
    // delete underneath.
    branch('rename')
    git('mv', 'suites/probe/pkg/1.0.0.yml', 'suites/probe/pkg/0.9.0.yml')
    await writeFile(join(sandbox, 'suites/probe/pkg/0.9.0.yml'), submission('0.9.0'), 'utf8')
    commit('rename 1.0.0 -> 0.9.0')

    const result = await run('catalog.mjs', ['check', '--base', 'main', '--index', 'index.json'])
    assert.equal(result.ok, false, `expected a rejection, got:\n${result.text}`)
    assert.match(result.text, /deleted by this change/u, result.text)
  })

  it('rejects deleting the .yml and adding a .yaml instead', async () => {
    branch('yaml')
    git('rm', '-q', 'suites/probe/pkg/1.0.0.yml')
    await mkdir(join(sandbox, 'suites/probe/pkg'), { recursive: true })
    await writeFile(join(sandbox, 'suites/probe/pkg/1.0.0.yaml'), 'this: [is not valid\n', 'utf8')
    commit('replace with .yaml')

    const result = await run('catalog.mjs', ['check', '--base', 'main', '--index', 'index.json'])
    assert.equal(result.ok, false, `expected a rejection, got:\n${result.text}`)
    assert.match(result.text, /deleted by this change/u, result.text)
  })

  it('refuses to build an empty catalog', async () => {
    // The publish job runs `build`, not `check`, so the guard has to exist on
    // both paths: otherwise deleting every submission published a valid-looking
    // document with zero bundles.
    branch('empty')
    git('rm', '-q', 'suites/probe/pkg/1.0.0.yml')
    commit('delete everything')

    const result = await run('catalog.mjs', ['build', '--index', 'index.json'])
    assert.equal(result.ok, false, `expected a refusal, got:\n${result.text}`)
    assert.match(result.text, /empty catalog/u, result.text)
  })
})
