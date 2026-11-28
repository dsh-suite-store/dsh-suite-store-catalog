/**
 * Regression net for the parsing, ordering and gate logic.
 *
 * Nothing here touches the network or the repository's own submissions: these
 * are the pure functions the CI gates are built from, so a fix cannot silently
 * regress. `node --test tests/` runs this file.
 */

import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'

import { buildCatalogue, installSpecOf, lookupPlugin, parsePluginRef } from '../scripts/catalogue.mjs'
import { categoryLabels, readCategories } from '../scripts/categories.mjs'
import { syncSchema } from '../scripts/sync-schema.mjs'
import {
  assertVersionAdvances,
  compareOrder,
  parseSubmissionPath,
  validateSubmission,
} from '../scripts/validate.mjs'
import { LOCALIZED_TEXT_MAX } from '../scripts/limits.mjs'
import { explainYamlError } from '../scripts/yaml-error.mjs'

const root = path.resolve(import.meta.dirname, '..')
const categories = await readCategories()

/** The smallest valid submission, for the gate tests. */
function submission(overrides = {}) {
  return {
    id: 'my-suite',
    owner: 'octocat',
    version: '1.0.0',
    title: { zh: '标题', en: 'Title' },
    summary: { zh: '一句话', en: 'One sentence' },
    category: { primary: 'productivity' },
    members: [{ plugin: 'acme/one' }, { plugin: 'acme/two' }],
    ...overrides,
  }
}

const INDEX = {
  plugins: [
    { owner: 'acme', name: 'one', npm: 'dsh-one', version: '1.2.3', url: 'https://github.com/acme/one' },
    { owner: 'acme', name: 'two', npm: '', url: 'https://github.com/acme/two' },
    // Casing is the same repository to GitHub; the index keeps its own spelling.
    { owner: 'acme', name: 'Three', npm: 'dsh-three', version: '0.1.0' },
    { owner: 'acme', name: 'zero', npm: null, version: null },
  ],
}
const catalogue = buildCatalogue(INDEX)
const expected = { owner: 'octocat', id: 'my-suite', version: '1.0.0' }

test('parsePluginRef normalizes every form a contributor pastes', () => {
  const cases = [
    ['acme/one', 'acme/one'],
    ['https://github.com/acme/one', 'acme/one'],
    ['http://github.com/acme/one/', 'acme/one'],
    ['www.github.com/acme/one', 'acme/one'],
    ['git@github.com:acme/one.git', 'acme/one'],
    // Trailing slash stripped before `.git`, or the key keeps the suffix.
    ['https://github.com/acme/one.git/', 'acme/one'],
    // `/tree/<branch>` with no subpath still names the repository.
    ['https://github.com/acme/one/tree/main', 'acme/one'],
    ['https://github.com/acme/one/tree/main/packages/x', 'acme/one'],
    // The monorepo subpath is part of the index key and must survive.
    ['acme/one#packages/x', 'acme/one#packages/x'],
  ]
  for (const [input, key] of cases) assert.equal(parsePluginRef(input)?.key, key, input)
  assert.equal(parsePluginRef('not a ref'), undefined)
  assert.equal(parsePluginRef(undefined), undefined)
})

test('parsePluginRef round-trips every indexed key shape', () => {
  for (const key of ['acme/one', 'tt-a1i/archify#integrations/deepseek-harness', 'a/B_c.d']) {
    assert.equal(parsePluginRef(key)?.key, key)
  }
})

test('buildCatalogue keeps a non-array payload out of a for…of crash', () => {
  assert.equal(buildCatalogue({ plugins: {} }).count, 0)
  assert.equal(buildCatalogue({ plugins: 'nope' }).count, 0)
  assert.equal(buildCatalogue(null).count, 0)
  assert.equal(buildCatalogue([null, 3, 'x']).count, 0)
})

test('buildCatalogue is first-wins on repo keys and counts duplicates', () => {
  const first = { owner: 'a', name: 'b', npm: 'one' }
  const second = { owner: 'a', name: 'b', npm: 'two' }
  const built = buildCatalogue([first, second])
  assert.equal(built.byRepo.get('a/b'), first)
  assert.equal(built.count, 1)
  assert.equal(built.duplicates, 1)
})

test('lookupPlugin folds case but never merges different repositories', () => {
  assert.equal(lookupPlugin(catalogue, { key: 'acme/Three' }), catalogue.byRepo.get('acme/Three'))
  assert.equal(lookupPlugin(catalogue, { key: 'acme/three' }), catalogue.byRepo.get('acme/Three'))
  assert.equal(lookupPlugin(catalogue, { key: 'acme/three/deep' }), undefined)
})

test('installSpecOf refuses an incomplete record instead of emitting git:undefined', () => {
  assert.deepEqual(installSpecOf({ owner: 'a', name: 'b', npm: 'p', version: '1.0.0' }), {
    spec: 'npm:p@1.0.0', floating: false, npm: 'p', version: '1.0.0',
  })
  assert.equal(installSpecOf({ owner: 'a', name: 'b' }).spec, 'git:a/b')
  assert.throws(() => installSpecOf(null), TypeError)
  assert.throws(() => installSpecOf({ npm: null }), TypeError)
  // The old fallback produced the undetectable `git:undefined/undefined`.
  assert.throws(() => installSpecOf({ npm: null, owner: undefined, name: undefined }), TypeError)
})

test('a null category is a gate failure, not a TypeError', () => {
  // `validateSubmission`'s shape gate (G2) catches it first; the point is that it
  // is a GateError with a message, not `Cannot read properties of null`.
  assert.throws(
    () => validateSubmission(submission({ category: null }), expected, catalogue, categories),
    (error) => error.gate === 'G2' && /expected a mapping/u.test(error.message),
  )
  // A non-object that survives the shape gate is reported by the category tree.
  assert.throws(
    () => validateSubmission(submission({ category: undefined }), expected, catalogue, categories),
    (error) => error.gate === 'G7' && /choose one of the slugs/u.test(error.message),
  )
})

test('all user-authored localized fields share one character limit', () => {
  const at = (n) => ({ zh: 'x'.repeat(n), en: 'x'.repeat(n) })
  const valid = submission({
    title: at(LOCALIZED_TEXT_MAX),
    summary: at(LOCALIZED_TEXT_MAX),
    description: at(LOCALIZED_TEXT_MAX),
    postInstall: at(LOCALIZED_TEXT_MAX),
    capabilityRedLines: [{ text: at(LOCALIZED_TEXT_MAX), members: ['acme/one'] }],
    members: [
      { plugin: 'acme/one', reason: at(LOCALIZED_TEXT_MAX) },
      { plugin: 'acme/two' },
    ],
  })
  const normalized = validateSubmission(valid, expected, catalogue, categories)
  assert.equal(normalized.title.en.length, LOCALIZED_TEXT_MAX)
  assert.equal(normalized.members[0].reason.en.length, LOCALIZED_TEXT_MAX)

  const tooLong = 'x'.repeat(LOCALIZED_TEXT_MAX + 1)
  const cases = [
    submission({ title: { zh: tooLong, en: 'Title' } }),
    submission({ summary: { zh: tooLong, en: 'One sentence' } }),
    submission({ description: { zh: tooLong, en: 'Description' } }),
    submission({ postInstall: { zh: tooLong, en: 'Installed' } }),
    submission({ capabilityRedLines: [{ text: { zh: tooLong, en: 'Warning' } }] }),
    submission({ members: [{ plugin: 'acme/one', reason: { zh: tooLong, en: 'Reason' } }, { plugin: 'acme/two' }] }),
  ]
  for (const doc of cases) {
    assert.throws(
      () => validateSubmission(doc, expected, catalogue, categories),
      (error) => error.gate === 'G2' && /longer than 100 characters/u.test(error.message),
    )
  }
})

test('zh is optional and falls back to en; en is required', () => {
  // Downstream consumers read `summary.zh` directly, so the fallback has to be
  // applied in the validator rather than left to each of them.
  const enOnly = validateSubmission(
    submission({ title: { en: 'Title' }, summary: { en: 'One sentence' } }),
    expected, catalogue, categories,
  )
  assert.deepEqual(enOnly.title, { zh: 'Title', en: 'Title' })
  assert.deepEqual(enOnly.summary, { zh: 'One sentence', en: 'One sentence' })

  // An explicit zh wins, and is not overwritten by the fallback.
  const both = validateSubmission(
    submission({ title: { zh: '标题', en: 'Title' } }), expected, catalogue, categories,
  )
  assert.deepEqual(both.title, { zh: '标题', en: 'Title' })

  // An explicit but empty zh is a mistake, not an omission.
  assert.throws(
    () => validateSubmission(submission({ title: { zh: '', en: 'Title' } }), expected, catalogue, categories),
    (error) => error.gate === 'G2' && error.path === '$.title.zh',
  )

  // en stays mandatory.
  assert.throws(
    () => validateSubmission(submission({ title: { zh: '标题' } }), expected, catalogue, categories),
    (error) => error.gate === 'G2' && error.path === '$.title.en',
  )
})

test('G11 rejects a degenerate cover URL', () => {
  for (const cover of ['https://', 'https://?x', 'http://example.com/a.png', 'not a url']) {
    assert.throws(
      () => validateSubmission(submission({ cover }), expected, catalogue, categories),
      (error) => error.gate === 'G11',
      cover,
    )
  }
  const ok = validateSubmission(
    submission({ cover: 'https://raw.githubusercontent.com/acme/repo/main/cover.png' }),
    expected, catalogue, categories,
  )
  assert.equal(ok.cover, 'https://raw.githubusercontent.com/acme/repo/main/cover.png')
})

test('G11 accepts only GitHub-hosted rasters', () => {
  const good = [
    'https://raw.githubusercontent.com/acme/repo/main/assets/cover.png',
    'https://raw.githubusercontent.com/acme/repo/main/assets/cover.jpg',
    'https://raw.githubusercontent.com/acme/repo/main/assets/cover.jpeg',
    'https://raw.githubusercontent.com/acme/repo/main/assets/cover.webp',
    'https://github.com/acme/repo/raw/main/assets/cover.png',
    'https://github.com/acme/repo/releases/download/v1/cover.png',
    // Extension case is not something a URL guarantees.
    'https://raw.githubusercontent.com/acme/repo/main/assets/cover.PNG',
  ]
  for (const value of good) {
    assert.equal(
      validateSubmission(submission({ cover: value }), expected, catalogue, categories).cover,
      value,
      value,
    )
  }

  // A third-party host would make every visitor's client fetch an image this
  // project cannot vouch for; a non-raster cannot render in an <img>.
  const bad = [
    ['https://example.com/cover.png', /hosted on GitHub/u],
    ['https://imgur.com/abc.png', /hosted on GitHub/u],
    ['https://raw.githubusercontent.com/acme/repo/main/cover.svg', /raster image/u],
    ['https://raw.githubusercontent.com/acme/repo/main/cover.gif', /raster image/u],
    ['https://raw.githubusercontent.com/acme/repo/main/cover', /raster image/u],
  ]
  for (const [value, reason] of bad) {
    assert.throws(
      () => validateSubmission(submission({ cover: value }), expected, catalogue, categories),
      (error) => error.gate === 'G11' && reason.test(error.message),
      value,
    )
  }
})

test('icon is optional, validated like cover, and defaults to null', () => {
  // Absent: the field is omitted from the document and the build resolves the
  // avatar fallback, so `null` here means "the submission said nothing".
  const absent = validateSubmission(submission(), expected, catalogue, categories)
  assert.equal(absent.icon, null)

  // Explicit null behaves the same as absent.
  const explicitNull = validateSubmission(submission({ icon: null }), expected, catalogue, categories)
  assert.equal(explicitNull.icon, null)

  // A good URL survives verbatim.
  const icon = 'https://raw.githubusercontent.com/acme/repo/main/assets/icon-180.png'
  assert.equal(
    validateSubmission(submission({ icon }), expected, catalogue, categories).icon,
    icon,
  )

  // The same rules apply: a broken image on the card is the same defect
  // whichever field produced it.
  for (const bad of ['https://', 'https://?x', 'http://example.com/a.png', 'not a url']) {
    assert.throws(
      () => validateSubmission(submission({ icon: bad }), expected, catalogue, categories),
      (error) => error.gate === 'G11' && error.message.includes('$.icon'),
      bad,
    )
  }
  assert.throws(
    () => validateSubmission(submission({ icon: 'https://example.com/icon.png' }), expected, catalogue, categories),
    (error) => error.gate === 'G11' && /hosted on GitHub/u.test(error.message),
  )
})

test('icon and cover are independent', () => {
  // Setting one must not imply the other: they are different pictures with
  // different fallbacks, and a submission may legitimately have only one.
  const icon = 'https://raw.githubusercontent.com/acme/repo/main/icon.png'
  const cover = 'https://raw.githubusercontent.com/acme/repo/main/cover.png'

  const onlyIcon = validateSubmission(submission({ icon }), expected, catalogue, categories)
  assert.equal(onlyIcon.icon, icon)
  assert.equal(onlyIcon.cover, null)

  const onlyCover = validateSubmission(submission({ cover }), expected, catalogue, categories)
  assert.equal(onlyCover.cover, cover)
  assert.equal(onlyCover.icon, null)
})

test('G1 rejects an owner that is not a GitHub login', () => {
  for (const owner of ['foo-', '-foo', 'fo--o']) {
    assert.throws(
      () => validateSubmission(submission({ owner }), { ...expected, owner }, catalogue, categories),
      (error) => error.gate === 'G1',
      owner,
    )
  }
})

test('G6 matches a member whose casing differs from the index', () => {
  const doc = validateSubmission(
    submission({ members: [{ plugin: 'acme/three' }, { plugin: 'acme/one' }] }),
    expected, catalogue, categories,
  )
  assert.equal(doc.members[0].key, 'acme/three')
  assert.equal(doc.members[0].npm, 'dsh-three')
})

test('requires is stored as the canonical key', () => {
  const doc = validateSubmission(
    submission({ members: [{ plugin: 'acme/one' }, { plugin: 'acme/two', requires: ['https://github.com/acme/one/'] }] }),
    expected, catalogue, categories,
  )
  assert.deepEqual(doc.members[1].requires, ['acme/one'])
})

test('a member description with no locale is absent, not an empty object', () => {
  const local = buildCatalogue({
    plugins: [
      { owner: 'acme', name: 'one', npm: 'dsh-one', description: {} },
      { owner: 'acme', name: 'two', npm: 'dsh-two', description: { en: 'hi' } },
    ],
  })
  const doc = validateSubmission(submission(), expected, local, categories)
  assert.equal(doc.members[0].description, undefined)
  assert.deepEqual(doc.members[1].description, { en: 'hi' })
})

test('a duplicate member fails G4 even when spelled differently', () => {
  assert.throws(
    () => validateSubmission(
      submission({ members: [{ plugin: 'acme/one' }, { plugin: 'https://github.com/acme/one' }] }),
      expected, catalogue, categories,
    ),
    (error) => error.gate === 'G4' && /duplicate member/u.test(error.message),
  )
})

test('assertVersionAdvances ignores non-semver history instead of yielding NaN', () => {
  assert.throws(() => assertVersionAdvances('1.0.0', ['1.0.0']), (error) => error.gate === 'G3')
  assert.throws(() => assertVersionAdvances('1.0.0', ['2.0.0']), (error) => error.gate === 'G3')
  assert.throws(() => assertVersionAdvances('bad', []), (error) => error.gate === 'G3')
  // A malformed entry is not a valid floor, so the comparison stays meaningful.
  assert.doesNotThrow(() => assertVersionAdvances('1.0.0', ['x.y.z']))
  assert.doesNotThrow(() => assertVersionAdvances('1.0.1', ['1.0.0']))
})

test('compareOrder is a plain three-part comparison', () => {
  assert.ok(compareOrder([1, 0, 0], [2, 0, 0]) < 0)
  assert.ok(compareOrder([1, 2, 0], [1, 10, 0]) < 0)
  assert.ok(compareOrder([2, 0, 0], [1, 0, 0]) > 0)
  assert.equal(compareOrder([1, 2, 3], [1, 2, 3]), 0)
})

test('parseSubmissionPath accepts both separators and rejects bad shapes', () => {
  assert.deepEqual(parseSubmissionPath('suites/a/b/1.0.0.yml'), { owner: 'a', id: 'b', version: '1.0.0' })
  assert.deepEqual(parseSubmissionPath('suites\\a\\b\\1.0.0.yml'), { owner: 'a', id: 'b', version: '1.0.0' })
  assert.throws(() => parseSubmissionPath('suites/a/b/1.0.0.yaml'), (error) => error.gate === 'G1')
  assert.throws(() => parseSubmissionPath('suites/a/1.0.0.yml'), (error) => error.gate === 'G1')
  // The old directory is not a synonym: a submission left under `bundles/` must
  // be rejected loudly, or a half-finished rename would publish nothing while
  // every check passed.
  assert.throws(() => parseSubmissionPath('bundles/a/b/1.0.0.yml'), (error) => error.gate === 'G1')
})

test('parseSubmissionPath enforces the version format in the file name', () => {
  // Checked here as well as on the document's `version:`, because the file name
  // is what a contributor types. `1.0` used to reach the document check and fail
  // as "disagrees with the file name", which reads as a contradiction.
  const bad = [
    'suites/a/b/1.0.yml',
    'suites/a/b/1.yml',
    'suites/a/b/v1.0.0.yml',
    'suites/a/b/01.0.0.yml',
    'suites/a/b/1.0.0.0.yml',
    'suites/a/b/1.0.0-beta.yml',
    'suites/a/b/latest.yml',
  ]
  for (const path of bad) {
    assert.throws(() => parseSubmissionPath(path), (error) => error.gate === 'G1', `should reject ${path}`)
  }
  // The accepted shape, including multi-digit and zero parts.
  for (const version of ['0.0.0', '1.0.0', '10.20.30']) {
    assert.deepEqual(
      parseSubmissionPath(`suites/a/b/${version}.yml`),
      { owner: 'a', id: 'b', version },
    )
  }
})

test('categoryLabels has no prototype to pollute', () => {
  const labels = categoryLabels(categories)
  assert.equal(Object.getPrototypeOf(labels), null)
  assert.ok(Object.hasOwn(labels, 'productivity'))
  // A `__proto__` slug becomes an own property instead of replacing the
  // prototype (which is how the old plain object silently dropped a label).
  const poisoned = categoryLabels([
    { slug: '__proto__', zh: '甲', en: 'A', secondary: [] },
    { slug: 'productivity', zh: '效率', en: 'Productivity', secondary: [] },
  ])
  assert.equal(Object.getPrototypeOf(poisoned), null)
  assert.deepEqual(Object.getOwnPropertyDescriptor(poisoned, '__proto__')?.value, { zh: '甲', en: 'A' })
})

test('explainYamlError survives a hostile linePos and a prototype-chain code', () => {
  const three = (text) => text.split('\n').length === 3
  assert.ok(three(explainYamlError({ code: 'BLOCK_AS_IMPLICIT_KEY', linePos: [{ line: 2, col: 3 }] }, 'f.yml')))
  assert.ok(three(explainYamlError({ code: 'constructor', message: 'boom' }, 'f.yml')))
  assert.ok(three(explainYamlError({ linePos: [null], message: 'boom' }, 'f.yml')))
  assert.ok(three(explainYamlError({ linePos: [{ line: 'x' }], message: 'boom' }, 'f.yml')))
  assert.ok(!explainYamlError({ code: 'constructor', message: 'boom' }, 'f.yml').includes('undefined'))
})

test('syncSchema is line-ending agnostic', () => {
  // Git checks schema/bundle.schema.json out as CRLF on Windows (core.autocrlf)
  // and as LF in CI. A raw-text comparison reported "stale" on every Windows
  // machine, and the "fix" rewrote every line of the file.
  const file = path.join(root, 'schema/bundle.schema.json')
  const onDisk = fs.readFileSync(file, 'utf8')
  // Construct BOTH cases from a canonical LF copy. Reading the file as the
  // CRLF case assumed a Windows checkout: on Linux (ubuntu-latest) the file is
  // already LF, so `crlf` was really LF and the eol assertion below failed with
  // '\n' !== '\r\n' on every Linux CI run.
  const lf = onDisk.replace(/\r\n/gu, '\n')
  const crlf = lf.replace(/\n/gu, '\r\n')
  const data = JSON.parse(fs.readFileSync(path.join(root, 'schema/categories.json'), 'utf8'))
  const schema = JSON.parse(lf)
  assert.equal(schema.$defs.localized.properties.zh.maxLength, LOCALIZED_TEXT_MAX)
  assert.equal(schema.$defs.localized.properties.en.maxLength, LOCALIZED_TEXT_MAX)

  assert.equal(syncSchema(lf, data).changed, false, 'an LF copy must be in sync')
  assert.equal(syncSchema(crlf, data).changed, false, 'a CRLF copy must be in sync')
  // The line ending is reported back so the writer can preserve it.
  assert.equal(syncSchema(lf, data).eol, '\n')
  assert.equal(syncSchema(crlf, data).eol, '\r\n')

  // A real categories change is still detected, in either convention.
  const changed = { categories: [...data.categories.slice(1)] }
  assert.equal(syncSchema(lf, changed).changed, true)
  assert.equal(syncSchema(crlf, changed).changed, true)

  // The localized maxLength is generated from the one shared limit constant.
  const staleLimit = lf.replace(`"maxLength": ${LOCALIZED_TEXT_MAX}`, '"maxLength": 99')
  assert.notEqual(staleLimit, lf)
  assert.equal(syncSchema(staleLimit, data).changed, true)
})
