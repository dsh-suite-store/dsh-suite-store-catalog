#!/usr/bin/env bash
# Copy ONLY trusted submission YAML from an extracted PR tree into `suites/`.
#
# Called by the CI overlay step. The attacks this closes:
#
#   1. A PR adds `suites/.gitignore` containing `*.yml`. A plain
#      `git add -A suites` then COMMITS only the .gitignore; the YAML stays in
#      the worktree but is absent from the diff, so owner/G3 gates see nothing
#      and the check still walks the worktree and passes. `git add -f` would
#      force them in, but copying only known-good paths is stricter: no hidden
#      config, no symlink, no stray file can reach the validation tree at all.
#
#   2. A PR adds a symlink inside suites/ pointing outside the workspace.
#      tar/cp -a preserve it and build.mjs's readFile() would follow it.
#
#   3. A filename containing a newline: `1.0.0.yml<LF>JUNK`. The whitelist used
#      to be `printf | grep -Eq`, and grep matches PER LINE — the first line
#      satisfied the pattern, so an arbitrary non-YAML path was copied into the
#      protected tree, and the owner/G3 `sed` could not parse it either.
#
# Validation is a SEPARATE PASS that finishes before anything is copied. A half
# written destination would otherwise be left behind when the third file of a
# PR is rejected, and the caller would have to distinguish "rejected" from
# "partially copied".
set -euo pipefail

SRC=$1
DST=${2:-suites}

if [ ! -d "$SRC/suites" ]; then
  echo "overlay-suites: no suites/ in the PR tree" >&2
  exit 2
fi

# One pattern, used for every path, so the message and the check cannot drift.
PATTERN='^[A-Za-z0-9-]+/[a-z0-9-]+/[0-9]+\.[0-9]+\.[0-9]+\.yml$'

# ---- pass 1: validate -------------------------------------------------------
#
# Reject ANY symlink under suites/ first, even without a valid YAML beside it.
if find "$SRC/suites" -type l -print -quit | grep -q .; then
  echo "::error::PR contains a symlink under suites/:" >&2
  find "$SRC/suites" -type l -print >&2
  exit 1
fi

# A gitlink (submodule, mode 160000) is exported by the GitHub tarball as an
# EMPTY DIRECTORY. `find -type f` enumerates nothing inside it, so the path used
# to vanish silently: the overlay staged no change for it, owner and G3 never
# saw it, and the merged tree could carry a submodule pointing at a repository
# the attacker controls. An empty directory under suites/ has no legitimate
# meaning either — every real submission is a file three levels down.
#
# Detecting it by shape rather than by mode: the tarball has already lost the
# mode, but an empty directory (or one containing only empty directories) can
# only be a gitlink or leftover junk.
while IFS= read -r -d '' dir; do
  if [ -z "$(find "$dir" -mindepth 1 -print -quit)" ]; then
    echo "::error::empty directory under suites/ (a gitlink/submodule is not a submission): ${dir#"$SRC"/suites/}" >&2
    exit 1
  fi
done < <(find "$SRC/suites" -mindepth 1 -type d -print0)

selected=()
while IFS= read -r -d '' file; do
  rel=${file#"$SRC"/suites/}

  # Control characters first. [[:cntrl:]] covers LF, CR, TAB, NUL and the rest.
  # A path with any of them can never be a submission, and `$rel` is compared as
  # a single string so a newline cannot smuggle a suffix past the pattern.
  if [[ $rel == *[[:cntrl:]]* ]]; then
    printf '::error::control character in a suites/ path (refusing to copy it):\n' >&2
    printf '%s' "$rel" | od -An -c | head -n 3 >&2
    exit 1
  fi

  # Whole-string match. `[[ =~ ]]` anchors `^…$` to the entire value here,
  # unlike grep, which would match just the first line.
  if [[ ! $rel =~ $PATTERN ]]; then
    echo "::error::unexpected file under suites/: $rel (only suites/<owner>/<id>/<version>.yml is accepted)" >&2
    exit 1
  fi

  selected+=("$rel")
done < <(find "$SRC/suites" -type f -print0)

# ---- pass 2: copy -----------------------------------------------------------
rm -rf "$DST"
mkdir -p "$DST"
for rel in ${selected[@]+"${selected[@]}"}; do
  mkdir -p "$DST/$(dirname "$rel")"
  cp -- "$SRC/suites/$rel" "$DST/$rel"
done

echo "${#selected[@]}"
