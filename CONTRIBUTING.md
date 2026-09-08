# Contributing to FitCast

Practical guide to the dev workflow, branching/PR process, and CI/CD. For architecture decisions and the file map, see [`app/CLAUDE.md`](app/CLAUDE.md); for the `CHANGELOG.md` format and release process in full detail, see the root [`CLAUDE.md`](CLAUDE.md).

## Getting started

```bash
# Prerequisites: Node.js 22+ (pinned in app/.nvmrc), npm
cd app
npm install   # also runs electron-builder install-app-deps via postinstall, rebuilding native modules
npm run dev
```

Run every `npm` command from inside `app/`, never the repo root — that's where `package.json` and all tooling config live.

## Repository layout

- `app/` — the Electron app itself: source, config, tooling.
- `docs/` — documentation and findings that aren't `CHANGELOG.md`, `CLAUDE.md`, `CONTRIBUTING.md`, or `README.md`.
- Repo root — only `CHANGELOG.md`, `CLAUDE.md`, `CONTRIBUTING.md`, `LICENSE`, `README.md`, `app/`, and `docs/`.

## Branching and PRs

- `main` is protected — no direct pushes. Work on a branch, open a PR, merge (squash) once CI is green.
- Every user- or contributor-facing change gets a `## [Unreleased]` bullet in `CHANGELOG.md` in the same PR — see [`CLAUDE.md`](CLAUDE.md#changelogmd) for the exact format (each version splits into `### Release Notes` and `### Contributor Notes`) and the "edit the existing bullet, don't append a new one" rule for changes within the same release cycle.
- Issues and specs live as GitHub Issues in this repo, managed via the `gh` CLI — see [`docs/agents/issue-tracker.md`](docs/agents/issue-tracker.md).

## Testing your changes locally

From `app/`, the same four checks CI runs:

```bash
npm run lint
npm run typecheck
npm test
npm run build
```

## CI/CD

`.github/workflows/ci.yml` runs on every pull request and every push to `main`, on a self-hosted Windows runner — matching the actual shipping target (Windows NSIS installer, and the ANT+ USB driver story is Windows-specific), rather than a GitHub-hosted Linux runner that can't exercise the same native-module rebuild path a real install does.

It's three jobs, not one:

1. **`ci-build-test-check-dir`** — cheap, runs first, diffs the incoming changes against their base and checks whether anything under `app/` or `ci.yml` itself changed.
2. **`windows-ci-build-test`** — install, lint, typecheck, test, build. Skipped entirely when the first job found nothing relevant changed (a docs-only PR, for example), so those merge fast without waiting on a native rebuild.
3. **`ci-build-test-gate`** — always runs regardless of what the other two did, and is the job meant to act as the required status check: it reports a real pass/fail either way, so a skipped build job still gates green instead of leaving the PR stuck waiting on a check that never ran.

If you're touching `ci.yml` itself, that counts as a relevant change — the pipeline always runs for real on changes to its own file, so you get to see whether your edit actually works before it lands.

## Releasing

1. Rename `## [Unreleased]` to `## [vX.Y.Z] - YYYY-MM-DD` in `CHANGELOG.md`, add a fresh empty `## [Unreleased]` above it, and update the compare-link footer at the bottom of the file (full steps in [`CLAUDE.md`](CLAUDE.md#cutting-a-new-version)).
2. Merge that to `main`, then tag the release commit and push the tag:
   ```bash
   git tag -a vX.Y.Z -m "vX.Y.Z"
   git push origin vX.Y.Z
   ```
3. Pushing the tag triggers `.github/workflows/release.yml`, which builds the Windows NSIS installer and publishes it to a GitHub Release, with release notes pulled straight from that version's `### Release Notes` section in `CHANGELOG.md`.

Releases are **unsigned** — code signing needs a paid certificate plus identity verification, real friction for this project at its current stage — so installers trigger a Windows SmartScreen warning ("More info" → "Run anyway" to proceed). This is a deliberate, documented trade-off, not an oversight.
