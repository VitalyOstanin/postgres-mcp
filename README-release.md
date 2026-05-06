# Release Procedure

This document outlines the complete release procedure for the PostgreSQL MCP project. Follow these steps in order to ensure a clean, validated release.

## Table of Contents

- [Release Procedure](#release-procedure)
  - [Table of Contents](#table-of-contents)
  - [Overview](#overview)
  - [Repository Hardening (one-time)](#repository-hardening-one-time)
    - [Branch Protection on `master`](#branch-protection-on-master)
    - [npm Trusted Publisher](#npm-trusted-publisher)
  - [Pre-Release Checklist](#pre-release-checklist)
    - [0. Environment Setup](#0-environment-setup)
    - [1. Version Update](#1-version-update)
    - [2. Lock File Update](#2-lock-file-update)
    - [3. Documentation Updates](#3-documentation-updates)
      - [CHANGELOG Updates](#changelog-updates)
      - [README Updates](#readme-updates)
      - [README TOC Verification](#readme-toc-verification)
    - [4. Build Validation](#4-build-validation)
    - [5. Linter Validation](#5-linter-validation)
    - [6. Final Code Review](#6-final-code-review)
    - [7. Git Status Check](#7-git-status-check)
  - [Release Execution](#release-execution)
    - [Automated Release via GitHub Actions](#automated-release-via-github-actions)
      - [Prerequisites](#prerequisites)
      - [Release Steps](#release-steps)
      - [Monitor Release Progress](#monitor-release-progress)
      - [What GitHub Actions Does](#what-github-actions-does)
  - [Post-Release Verification](#post-release-verification)
    - [1. Verify GitHub Actions Workflow](#1-verify-github-actions-workflow)
    - [2. Verify npm Package](#2-verify-npm-package)
    - [3. Smoke Test Published Package](#3-smoke-test-published-package)
    - [4. Verify GitHub Release](#4-verify-github-release)

## Overview

The PostgreSQL MCP project uses **automated CI/CD via GitHub Actions** for releases:

- **CI Workflow**: Automatically runs tests, linting, and builds on every push and PR
- **Publish Workflow**: Automatically publishes to npm and creates GitHub Release when you push a version tag

**Important**: All tests must pass before a release can be published. The CI workflow validates that:
- All unit tests pass
- Linting checks pass
- Build process completes successfully

**Quick Release (TL;DR):**
```bash
npm version patch              # Update version, create commit & tag
git push --follow-tags        # Push to GitHub → triggers automated release
```

For detailed instructions and prerequisites, continue reading below.

## Repository Hardening (one-time)

These settings live in the GitHub UI, not in the repo, so they have to be
configured once by a repository administrator. They protect the release
pipeline from accidental or unauthorized publishes.

### Branch Protection on `master`

Goal: every change that lands on `master` is reviewed and gated by CI, and
no one (not even an admin) can push directly. Configure under **Settings →
Branches → Branch protection rules** (classic rules) or **Settings → Rules
→ Rulesets** (newer UI — equivalent settings).

Required settings:

- **Require a pull request before merging** — at least one review approval.
  Enable **Dismiss stale pull request approvals when new commits are
  pushed** so a force-pushed PR cannot ship under an old approval.
- **Require status checks to pass before merging** — select these checks
  (their names match the matrix in `.github/workflows/ci.yml`):
  - `build-and-test (22.x)`
  - `build-and-test (24.x)`
  - `integration-tests (22.x)`
  - `integration-tests (24.x)`
  - `audit`
- **Require branches to be up to date before merging** — prevents merging
  a PR whose base has moved (and therefore whose CI run is stale).
- **Require linear history** — disallows merge commits, keeps `master`
  bisectable.
- **Do not allow bypassing the above settings** (or, in classic rules,
  enable **Include administrators**) — protections must apply uniformly.
- **Restrict who can push to matching branches** — leave empty so only
  PR merges modify `master`.
- **Allow force pushes**: disabled.
- **Allow deletions**: disabled.

Optional but recommended:

- **Require signed commits** — every merged commit must be GPG/SSH-signed.
- **Require conversation resolution before merging** — outstanding review
  threads block merge.

### npm Trusted Publisher

The publish job authenticates to the npm registry via OIDC. There is
**no `NPM_TOKEN` secret** anywhere in the repository; instead the
GitHub Actions OIDC token (`id-token: write`) is exchanged for a
short-lived registry token at publish time.

One-time setup on https://www.npmjs.com :

1. Sign in to the npm account that owns `@vitalyostanin/postgres-mcp`.
2. Go to **Package settings → Access** → **Trusted publisher → Add**.
3. Pick **GitHub Actions** and fill in:
   - **Repository owner**: `VitalyOstanin`
   - **Repository name**: `postgres-mcp`
   - **Workflow filename**: `publish.yml`
   - **Environment name**: leave empty (this repo's publish job does
     not pin to a GitHub Environment).
4. Save.

Requirements that are already wired up in this repo:

- `permissions: id-token: write` on the publish job
  (`.github/workflows/publish.yml`).
- Node.js 24 in the publish job — npm 11.5.1+ is required for Trusted
  Publishing, and Node 24 ships it out of the box.
- `package-manager-cache: false` in `actions/setup-node` (per npm docs;
  the cache otherwise interferes with the OIDC handshake).

If a `NPM_TOKEN` secret was previously configured at the repo level,
**delete it** — passing it alongside OIDC suppresses the trust-check
on the registry side.

## Pre-Release Checklist

### 0. Environment Setup

**Disable pager for all commands to ensure consistent output:**

```bash
# Disable pager globally for this session
export PAGER=cat
export LESS=

# Verify pager is disabled
echo "test" | git --paginate log --oneline -1
```

All command examples in this document assume pager is disabled. If you see paginated output, the commands may not work as expected.

### 1. Version Update

**Verify that `package.json` version has been incremented:**

```bash
# Check current version
grep '"version"' package.json
```

Version should follow [Semantic Versioning](https://semver.org/):
- **MAJOR** (x.0.0): Breaking changes or major feature additions
- **MINOR** (0.x.0): New features, backward-compatible
- **PATCH** (0.0.x): Bug fixes, backward-compatible

**Update version manually if needed:**

```bash
# For patch release
npm version patch --no-git-tag-version

# For minor release
npm version minor --no-git-tag-version

# For major release
npm version major --no-git-tag-version
```

### 2. Lock File Update

**Ensure `package-lock.json` is synchronized:**

```bash
# Update lockfile after any package.json changes
npm install

# Verify no unexpected changes
git diff package-lock.json
```

The lockfile must reflect the exact dependency tree. Never commit a stale lockfile.

### 3. Documentation Updates

**Update all relevant documentation files:**

#### CHANGELOG Updates

```bash
# Check if CHANGELOG files exist
ls -1 CHANGELOG*.md 2>/dev/null || echo "No changelog files found"
```

If CHANGELOG files exist, ensure they include:
- New version number and release date
- All new features, fixes, and breaking changes
- Links to related issues/MRs

**Example CHANGELOG entry:**

```markdown
## [0.2.0] - 2025-10-14

### Added
- PostgreSQL table analysis (#15)
- PostgreSQL connection management (#12)

### Fixed
- Query performance (#18)

### Changed
- Improved error messages for connection failures
```

#### README Updates

```bash
# Verify README files are up-to-date
ls -1 README*.md
```

Ensure both `README.md` (English) and `README-ru.md` (Russian) reflect:
- New features and tools
- Updated usage examples
- Changed configuration requirements
- Version compatibility notes

#### README TOC Verification
- Confirm that both README files include a correct Table of Contents:
  - Presence:
    ```bash
    rg -n "^## Table of Contents" README.md README-ru.md
    ```
  - Compare headers vs TOC entries:
    ```bash
    for f in README.md README-ru.md; do
      echo "== $f ==";
      echo "Headers (H2/H3):";
      rg -n "^(##|###) " "$f" | sed -E 's/^[^ ]+\s+//' | sed -E 's/^#+ //';
      echo "TOC entries:";
      rg -n "^- \\[[^\\]]+\\\\]\\(#[^)]+\\)" "$f" || true;
    done
    ```
  - If mismatches are found, update the TOC blocks before release.

### 4. Build Validation

**Run full TypeScript build:**

```bash
npm run build
```

Build must complete without errors. Check for:
- TypeScript compilation errors
- Type checking failures
- Missing dependencies

**Expected output:**
```
[no output on success]
```

Any errors must be fixed before proceeding.

### 4.1 Test Validation

**Run all tests to ensure they pass:**

```bash
npm test
```

All tests must pass before proceeding with the release. The CI/CD pipeline will automatically run tests during the release process, and the release will be blocked if any tests fail.

**Expected output:**
```
PASS src/postgres-client.test.ts
...
Test Suites: 1 passed, 1 total
Tests:       X passed, X total
```

All tests must show as PASSED before proceeding.

### 5. Linter Validation

**Run ESLint checks:**

```bash
npx eslint .
```

All files must pass linting. For auto-fixable issues:

```bash
npx eslint . --fix
```

**Expected output:**
```
[no output on clean run]
```

### 6. Final Code Review

**Perform a comprehensive code review:**

- [ ] Review all changes since last release
- [ ] Verify no debugging code (console.log, debugger statements)
- [ ] Check for TODOs or FIXMEs that should be addressed
- [ ] Ensure code follows project style guidelines (AGENTS.md)
- [ ] Validate error handling and edge cases
- [ ] Confirm API compatibility (no breaking changes without version bump)

```bash
# Review all changes since last tag
git log $(git describe --tags --abbrev=0)..HEAD --oneline

# Check for debugging artifacts
git grep -n "console\.log\|debugger" src/
```

### 7. Git Status Check

**Ensure all changes are committed:**

```bash
# Check working directory status
git status
```

**Expected output:**
```
On branch master
nothing to commit, working tree clean
```

If there are uncommitted changes:

```bash
# Stage all changes
git add .

# Create commit with descriptive message
git commit -m "chore: prepare release v0.x.x"
```

## Release Execution

Once all checklist items are completed:

### Automated Release via GitHub Actions

This project uses GitHub Actions for automated CI/CD. The release process is fully automated when you create a version tag.

#### Prerequisites

**One-time setup is described above:**
- [Branch Protection on `master`](#branch-protection-on-master) — gate
  merges on CI status checks.
- [npm Trusted Publisher](#npm-trusted-publisher) — OIDC-based
  authentication to the npm registry (no `NPM_TOKEN` secret needed).

#### Release Steps

```bash
# 1. Update version and create git tag
npm version patch   # for 0.1.0 → 0.1.1 (bug fixes)
# or
npm version minor   # for 0.1.0 → 0.2.0 (new features)
# or
npm version major   # for 0.1.0 → 1.0.0 (breaking changes)

# Note: npm version automatically:
# - Updates package.json and package-lock.json
# - Creates a git commit (e.g., "0.1.1")
# - Creates a git tag (e.g., "v0.1.1")

> **Important:** Always create annotated tags for releases.
> Use `git tag -a vX.Y.Z -m "Release vX.Y.Z"` instead of lightweight tags.
> Annotated tags include author, date, and message metadata, and are required for `git push --follow-tags` to publish them automatically.

# 2. Push commit and tags to GitHub
git push --follow-tags

# 3. GitHub Actions will automatically:
#    - pre-publish-checks job: lint, typecheck, unit tests, integration
#      tests against postgres:18.3-alpine, build, smoke pack-and-install
#    - publish job (needs: pre-publish-checks): npm publish via Trusted
#      Publishing OIDC, with provenance
#    - GitHub Release with installation instructions
```

#### Monitor Release Progress

1. **Check GitHub Actions workflow:**
   - Go to: https://github.com/VitalyOstanin/postgres-mcp/actions
   - Look for "Publish to npm" workflow run
   - Verify all steps completed successfully

2. **View created release:**
   - Go to: https://github.com/VitalyOstanin/postgres-mcp/releases
   - Verify release was created with correct version tag
   - Check release notes and installation instructions

#### What GitHub Actions Does

The automated workflow (`.github/workflows/publish.yml`) performs two jobs:

**pre-publish-checks** (no special permissions; runs first):

1. Checkout repository code; setup Node.js 24 with npm cache.
2. Spin up a `postgres:18.3-alpine` service container with healthcheck.
3. `npm ci`, then run lint, typecheck, unit tests.
4. Run integration tests against the postgres service container
   (`npm run test:integration`).
5. `npm run build`.
6. Verify package contents with `npm pack --dry-run`.
7. Smoke pack-and-install: build a real tarball, install it into a
   throwaway dir, run the bin entry with `--help` to catch broken
   `files` allow-list, missing deps, or shebang issues.

**publish** (`needs: pre-publish-checks`):

1. Checkout, setup Node.js 24 with `package-manager-cache: false`
   (Trusted Publishing requirement) and `registry-url`.
2. Log node/npm versions for OIDC diagnostics.
3. `npm ci`, `npm run build`.
4. `npm publish --provenance --access public` — authenticates via
   GitHub Actions OIDC against the npm Trusted Publisher; **no
   `NPM_TOKEN` secret involved**.
5. Create GitHub Release with installation instructions.

**Note**: If tests fail at any point during the workflow, the release is automatically cancelled.

## Post-Release Verification

After publishing, verify the release was successful:

### 1. Verify GitHub Actions Workflow

```bash
# Check latest workflow run status via GitHub CLI (optional)
gh run list --workflow=publish.yml --limit 1

# Or visit in browser:
# https://github.com/VitalyOstanin/postgres-mcp/actions/workflows/publish.yml
```

**Expected workflow status:** ✅ All steps completed successfully

### 2. Verify npm Package

```bash
# Check published version
npm view @vitalyostanin/postgres-mcp version

# Expected output: 0.x.x (matching your release tag)

# View full package info
npm view @vitalyostanin/postgres-mcp

# Check package provenance (cryptographic signature)
npm view @vitalyostanin/postgres-mcp --json | grep -i provenance
```

### 3. Smoke Test Published Package

Run the published package through npx to verify it executes correctly:

```bash
# Test that server starts and fails with expected configuration error
npx @vitalyostanin/postgres-mcp@latest 2>&1 | head -5

# Expected output (server should exit with configuration error):
# PostgreSQL MCP server crashed Error: PostgreSQL configuration error: missing environment variables: POSTGRES_MCP_CONNECTION_STRING
```

**Success criteria:**
- ✅ Package downloads and executes via npx
- ✅ Server fails with expected configuration error (not runtime errors)
- ✅ Error message clearly indicates missing required environment variables

### 4. Verify GitHub Release

```bash
# Visit releases page
# https://github.com/VitalyOstanin/postgres-mcp/releases/latest

# Or check via GitHub CLI
gh release view v0.x.x
```

**Verify:**
- ✅ Release is published (not draft)
- ✅ Release notes are properly formatted
- ✅ Installation instructions are present
- ✅ Tag matches package version

---

**Note:** Always follow this procedure completely. Skipping steps may result in broken releases, dependency conflicts, or user issues.