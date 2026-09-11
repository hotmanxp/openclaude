---
name: release-opencc
description: "Release OpenCC: bump version, build, publish to npm, and commit changes"
argument-hint:
  - <version_type>
---

# Release OpenCC

## Version Bump

**Type**: `{version_type=patch}`

版本升级类型：
- `patch` (默认): 0.10.3 → 0.10.4
- `minor`: 0.10.3 → 0.11.0
- `major`: 0.10.3 → 1.0.0

执行版本升级：
```bash
npm version {version_type} --no-git-tag-version
```

## Build

```bash
bun run build
```

## NPM Publish

```bash
npm publish
```

## Commit Changes

发布成功后，提交版本号变更：
```bash
git add package.json && git commit -m "HRMSV3-ZN-WEBSITE#668 chore(release): bump version to $(node -p "require('./package.json').version")"
```

## Summary

完成以下步骤：
1. ✅ 升级版本号 (patch/minor/major)
2. ✅ 构建项目 (bun run build)
3. ✅ 发布到 npm
4. ✅ 提交版本变更
