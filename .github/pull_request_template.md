## 这个 PR 加了什么 / What does this PR add?

<!-- 一句话：整合包名 + 新包还是更新 / One line: bundle name + whether this is a new bundle or an update -->

## 自查 / Self-check

- [ ] 路径 `suites/<owner>/<bundle_id>/<version>.yml` 与文件内的 `id`/`owner`/`version` 一致 / The path `suites/<owner>/<bundle_id>/<version>.yml` matches the `id`, `owner`, and `version` inside the file
- [ ] 成员 2–10 个 / The suite contains 2–10 members
- [ ] `summary` 每种语言 ≤40 字 / `summary` is at most 40 characters per language
- [ ] 本地跑过 `pnpm run check` 且通过 / Ran `pnpm run check` locally and it passed
- [ ] 更新已有包时，版本号大于已有版本 / When updating an existing bundle, the version is greater than the existing version

> 建议为每个成员写 `reason`，说明它为什么在整合包中；`reason` 是可选字段。 / Recommended: add a `reason` for each member explaining why it belongs to the suite; `reason` is optional.

## 给审核者看的 / For reviewers

<!-- 这套整合包解决什么场景？成员之间怎么配合？ / What scenario does this suite solve? How do the members work together? -->
