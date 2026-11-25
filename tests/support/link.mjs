// A cross-platform "give the sandbox access to node_modules" helper.
//
// Both sandboxed tests (upgrade.test.mjs, version-advance.test.mjs) used
// `cmd /c mklink /J`, which is a hard Windows dependency: CI runs on
// ubuntu-latest, where `cmd` does not exist and the before-hook throws ENOENT
// before a single assertion runs. The whole PR gate was unreachable there.
//
// `fs.symlink` with a directory type works on Linux and macOS directly. On
// Windows a plain symlink needs Developer Mode or elevation, so a junction is
// used there — `junction` is the one link type an ordinary user can create.

import { execFileSync } from 'node:child_process'
import { symlink } from 'node:fs/promises'

/**
 * Make `target` reachable at `link`. Best effort: the caller's test will fail
 * with a clear MODULE_NOT_FOUND if this cannot work, which is better than
 * silently skipping the assertion.
 *
 * @param link - the path to create.
 * @param target - the existing directory.
 */
export async function linkDirectory(link, target) {
  if (process.platform === 'win32') {
    // Junction: no elevation and no Developer Mode required. `cmd` is the only
    // API that creates one, and it is guaranteed present on Windows.
    execFileSync('cmd', ['/c', 'mklink', '/J', link, target], { stdio: 'pipe' })
    return
  }
  await symlink(target, link, 'dir')
}
