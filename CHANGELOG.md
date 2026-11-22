# Changelog

## [0.3.0](https://github.com/Soleone/workwork/compare/v0.2.0...v0.3.0) (2026-11-22)

### ⚠ BREAKING CHANGES

* --play is --blueprint, `workwork plays` is `workwork
  blueprints`, and the JSON fields play and level are blueprint and attention,
  with auto now none. Old play files, the plays folder, level, auto and the
  rotation finder are still read.

### Features

* plays are blueprints, level is attention (none, skim, decide), rotation is batch ([0ac4505](https://github.com/Soleone/workwork/commit/0ac450545ebe2ea35fec4271a5432ed1d4edf83e))

## [0.2.0](https://github.com/Soleone/workwork/compare/v0.1.2...v0.2.0) (2026-11-22)

### Features

* rotation plays work on batches of related files, and file-size flags files over 500 lines ([ca8a616](https://github.com/Soleone/workwork/commit/ca8a6165b864dfcdd30d5ee729d8dd5f76625f69))

### Bug Fixes

* **plays:** allow missing descriptions on custom plays ([4a105c6](https://github.com/Soleone/workwork/commit/4a105c6fc52efdac497120744dc1f73289fb2b03))
* report pnpm outdated failures ([#1](https://github.com/Soleone/workwork/issues/1)) ([a675113](https://github.com/Soleone/workwork/commit/a675113875f778cf42663740f9e22550bf0d0281))

## [0.1.2](https://github.com/Soleone/workwork/compare/v0.1.1...v0.1.2) (2026-11-19)

### Features

* --json marks each candidate as a finding, a rotation or a scan ([4ed2b10](https://github.com/Soleone/workwork/commit/4ed2b10b80351e01a77195168aad932b20a89b27))
* plays say what they do, and `workwork plays` lists them ([7b25da9](https://github.com/Soleone/workwork/commit/7b25da97dd4c5e93766337a314d0c5add0b35fbd))

### Bug Fixes

* knip finder reads its report after pnpm's install output ([f46613b](https://github.com/Soleone/workwork/commit/f46613b34ea13c6f14e7641fe81192abb315f3ad))

## [0.1.1](https://github.com/Soleone/workwork/compare/v0.1.0...v0.1.1) (2026-11-16)

### Features

* --json lists the shown candidates for scripts ([f913ee6](https://github.com/Soleone/workwork/commit/f913ee6e01f69333d545572bc9854b8230b60e2d))

## 0.1.0 (2026-11-15)

### Features

* list candidates by attention level, prompts, and decisions on a meta branch ([3ebe496](https://github.com/Soleone/workwork/commit/3ebe496ea1a1a0f7fc7e791da07cf59cd186c25a))
* point chisel prompts at engram and warn when its index is stale ([9b32cec](https://github.com/Soleone/workwork/commit/9b32ceceb6e64db26cb749650c6a539602404aaa))
* scan and rotation plays, keep verdicts, and setup that works on any machine ([40c67a6](https://github.com/Soleone/workwork/commit/40c67a626d09b367a804d3936a81babdc4f18170))

### Bug Fixes

* say 1 candidate, not 1 candidates ([137c6ac](https://github.com/Soleone/workwork/commit/137c6accdc98fface4347ee1255eb8630012068a))
* tolerate pnpm warnings, skip worktrees, and quiet idle repos in --all ([8d403f2](https://github.com/Soleone/workwork/commit/8d403f264e90537ea21f268298ed63c592ed1d4e))
