/**
 * Which image a card shows.
 *
 * Three cases, and the ORDER between them is the whole reason this is a separate
 * test: an explicit `icon` must win over the avatar fallback, and the first-party
 * owner must NOT get an avatar (it would show whatever that account happens to
 * have rather than the store's own mark).
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { FIRST_PARTY_OWNER, resolveIcon } from '../scripts/build.mjs'

describe('resolveIcon', () => {
  it('uses an explicit icon verbatim', () => {
    // A contributor's own mark is a decision, so it is never rewritten.
    const icon = 'https://raw.githubusercontent.com/someone/repo/main/assets/icon-180.png'
    assert.equal(
      resolveIcon({ owner: 'someone', icon }),
      icon,
    )
  })

  it('falls back to the GitHub avatar for a person', () => {
    // `github.com/<login>.png` is the documented redirect: no API, no token,
    // and it tracks a changed avatar.
    assert.equal(resolveIcon({ owner: 'zhangsan', icon: null }), 'https://github.com/zhangsan.png?size=180')
    assert.equal(resolveIcon({ owner: 'zhangsan' }), 'https://github.com/zhangsan.png?size=180')
  })

  it('gives the first-party owner no avatar at all', () => {
    // `null` means "the plugin's bundled default". Emitting
    // `github.com/dsh-suite-store.png` would point at an account avatar, which
    // is not the store's mark.
    assert.equal(resolveIcon({ owner: FIRST_PARTY_OWNER }), null)
    assert.equal(resolveIcon({ owner: 'dsh-suite-store', icon: null }), null)
  })

  it('treats the first-party owner case-insensitively', () => {
    // GitHub logins are case-insensitive; a different casing is the same account
    // and must not be routed to a stranger's avatar.
    assert.equal(resolveIcon({ owner: 'DSH-Suite-Store' }), null)
    assert.equal(resolveIcon({ owner: 'Dsh-Suite-Store' }), null)
  })

  it('lets an explicit icon override even the first-party owner', () => {
    // If the first party fills one in later, it is honoured: the bundled default
    // is a fallback, not a rule.
    const icon = 'https://example.test/brand.png'
    assert.equal(resolveIcon({ owner: FIRST_PARTY_OWNER, icon }), icon)
  })

  it('ignores an empty-string icon and falls through', () => {
    // An empty value is what a half-filled template leaves behind; treating it
    // as "no icon" is better than emitting `src=""`, which re-requests the page.
    assert.equal(resolveIcon({ owner: 'zhangsan', icon: '' }), 'https://github.com/zhangsan.png?size=180')
  })

  it('escapes an owner so the URL cannot be bent', () => {
    // Owners are validated as GitHub logins upstream, so this is defence in
    // depth: an unexpected character must not become a path segment.
    assert.equal(resolveIcon({ owner: 'a b' }), 'https://github.com/a%20b.png?size=180')
  })
})
