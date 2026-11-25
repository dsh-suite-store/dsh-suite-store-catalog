#!/usr/bin/env node
/**
 * Replay the two pull-request gates locally, without GitHub.
 *
 * CI runs three things on a PR: the full validator over the whole tree, the
 * owner-match gate for fork PRs, and a result comment. The first two are pure
 * git + node, so this script runs them against the current worktree and prints
 * the exact messages CI would print — a contributor can iterate without a
 * fork, a PR, or github.com reachability. The comment step is platform chrome
 * and has no local equivalent.
 *
 * Usage (inside a clone of this repository):
 *
 *   node scripts/simulate-pr.mjs --actor <login> [--base main] \
 *        [--index <plugins.json>] [-- <extra catalog.mjs check args>]
 *
 * `--actor` stands in for `github.event.pull_request.user.login` and
 * `--fork-owner` for `github.event.pull_request.head.repo.owner.login`. On
 * GitHub the owner gate only runs for fork PRs; here every submission is
 * treated as a fork PR, which is the stricter case, so a green local run implies
 * a green check run. There is no shared-owner bypass: a bundle directory must
 * be owned by the PR's actor or fork owner. Bundles under the `dsh-suite-store`
 * organisation are therefore maintained by pushing a branch in this
 * repository (where the gate is skipped), not from a personal fork. The
 * comparison is case-sensitive, exactly like the shell test in the workflow —
 * a login differing only in case fails in both places alike.
 */
import { execFileSync, spawnSync } from 'node:child_process'
import { resolve } from 'node:path'

const argv = process.argv.slice(2)
// Split before parsing: `flag()` used to scan past `--`, so
// `-- --actor foo` consumed `foo` as this script's actor (and still forwarded it
// to catalog.mjs), and a forwarded `--index` was read a second time.
const split = argv.indexOf('--')
const ownArgv = split === -1 ? argv : argv.slice(0, split)
const flag = (name) => {
  const at = ownArgv.indexOf(name)
  return at === -1 ? undefined : ownArgv[at + 1]
}

const actor = flag('--actor')
if (actor === undefined || actor === '') {
  console.error('usage: simulate-pr.mjs --actor <login> [--fork-owner <login>] [--base main] [--index <file>] [-- <extra args>]')
  process.exit(2)
}
const forkOwner = flag('--fork-owner') ?? actor
const base = flag('--base') ?? 'main'
// `base` reaches `git fetch` and `git diff` as a bare argument, and git keeps
// parsing options after the remote name: a value starting with `-` would be read
// as a git option (`--upload-pack=<cmd>` runs a command).
if (!/^[\w.-]+(?:\/[\w.-]+)*$/u.test(base) || base.startsWith('-')) {
  console.error(`simulate-pr: invalid base ref: ${base}`)
  process.exit(2)
}
// `--index` is the simulator's own flag but belongs to `check`, so it is
// forwarded; a bare `--` still passes anything else through verbatim.
//
// `--base` is appended AFTER the base ref is resolved below: it is not optional
// for correctness. Without it `catalog.mjs check` cannot tell a version file
// this PR ADDS from one that was already there, so it accepted a newly added
// `0.9.0` beside an existing `1.0.0`.
const forwarded = split === -1 ? [] : argv.slice(split + 1)

const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim()

let changed
/**
 * The ref the owner gate and the validator both diff against.
 *
 * Hoisted out of the `try` below because the validator call needs it too:
 * declaring it inside would leave it out of scope there and throw a
 * ReferenceError at the one moment it matters.
 */
let baseRef
try {
  // A published clone has `origin`; a local-only repository (the usual state
  // before this repo goes to GitHub) does not, so fall back to the bare local
  // branch name. CI's `origin/${base}` and a bare `base` name the same commit
  // here, because the local branch IS the base.
  let hasOrigin = true
  try {
    execFileSync('git', ['remote', 'get-url', 'origin'], { stdio: 'ignore' })
  } catch {
    // No origin at all: the local branch is the authority.
    hasOrigin = false
  }
  if (hasOrigin) {
    try {
      // Quietly: stderr here is noise the contributor does not need.
      execFileSync('git', ['fetch', 'origin', base], { stdio: 'ignore' })
    } catch (error) {
      // Not the "no origin" case: `origin/<base>` may still exist as a stale
      // remote-tracking ref, and diffing against it hides commits that are
      // really in the base branch (so the owner gate could pass locally for
      // files CI would flag). Stop instead of guessing.
      throw new Error(`cannot fetch origin/${base} (${error.message.split('\n')[0]}); run \`git fetch origin ${base}\` and retry`)
    }
  }
  // CI diffs `-- 'suites/**'`; under git's default pathspec magic that is
  // the same set as the `suites/` prefix, which avoids glob differences
  // between git versions.
  const hasRef = (() => {
    try {
      execFileSync('git', ['rev-parse', '--verify', `${hasOrigin ? `origin/${base}` : base}`], { stdio: 'ignore' })
      return true
    } catch {
      return false
    }
  })()
  if (!hasRef) throw new Error(`base ref not found: ${hasOrigin ? `origin/${base}` : base}`)
  baseRef = hasOrigin ? `origin/${base}` : base
  changed = git('diff', '--name-only', `${baseRef}...HEAD`, '--', 'suites/').split('\n').filter(Boolean)
} catch (error) {
  console.error(`simulate-pr: could not diff against ${base}: ${error.message}`)
  process.exit(2)
}

if (changed.length === 0) {
  console.error(`simulate-pr: no bundle files changed relative to ${base} — nothing to review`)
  process.exit(1)
}

// Same extraction, same comparison, same message as the workflow's
// "Owner matches the directory" step, so what fails here is what would
// fail there. (A flatMap over the regex match array would flatten the
// capture group into bare strings and read their second characters as
// owners — 'u' and 'l' out of 'suites/...' — which is how this looked
// before it was caught.)
const owners = [
  ...new Set(
    changed
      .map((path) => path.match(/^suites\/([^/]+)\//)?.[1])
      .filter((owner) => owner !== undefined),
  ),
]
let foreign = false
for (const owner of owners) {
  if (owner !== actor && owner !== forkOwner) {
    foreign = true
    console.error(`::error file=suites/${owner}::suite directory is owned by ${owner}, but this PR is from ${actor}`)
  }
}
if (foreign) process.exit(1)

console.log(`simulate-pr: ${String(changed.length)} bundle file(s), owner(s): ${owners.join(', ')} — owner gate passed`)

// The validator is the same one CI runs over the whole tree: a PR that breaks
// a sibling submission fails here exactly as it would there.
//
// `--base` is what lets it tell an ADDED version file from a pre-existing one;
// `baseRef` above is the same ref the owner gate just diffed against.
const check = spawnSync(
  'node',
  [
    resolve(import.meta.dirname, 'catalog.mjs'),
    'check',
    ...(flag('--index') === undefined ? [] : ['--index', flag('--index')]),
    '--base',
    baseRef,
    ...forwarded,
  ],
  { stdio: 'inherit' },
)
if (check.error !== undefined) {
  // A spawn failure (`node` missing, E2BIG from long extra args) left
  // `check.status` null; the only message was "validation FAILED", which points
  // the contributor at the wrong thing entirely.
  console.error(`simulate-pr: could not run catalog.mjs: ${check.error.message}`)
  process.exit(2)
}
if (check.status !== 0) {
  console.error('simulate-pr: validation FAILED — fix the gates above and push again')
  process.exit(check.status ?? 1)
}
console.log('simulate-pr: PASS — this PR would be green on GitHub')
