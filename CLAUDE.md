# CLAUDE.md — FitCast Project Reference

## Project Summary

FitCast is an Electron desktop app (React renderer + Node main process) that parses cycling `.fit` files into a normalized data model and provides two pipelines: (1) **Render mode** generates a pre-composited overlay video with alpha channel for Premiere compositing, and (2) **Playback mode** replays ride data in real-time over ANT+ radio, driving external overlay tools like Xert EBC. The UI has three primary actions: **Render** (video output), **Start Broadcasting** (idle ANT+ sensor discovery), and **Playback** (live ride data over ANT+).

Both pipelines operate on a **time range selected on the timeline**, not on the whole ride.

## Repository Layout

- `app/` — the Electron app itself: `package.json`, all source, config, and tooling. **Run every `npm` command from inside `app/`**, not the repo root. See [`app/CLAUDE.md`](app/CLAUDE.md) for architecture decisions, environment setup, and the file map.
- `docs/` — documentation, findings, and plans that aren't `CHANGELOG.md`, `CLAUDE.md`, or `README.md`.
- Repo root — only `CHANGELOG.md`, `CLAUDE.md`, `LICENSE`, `README.md`, `app/`, and `docs/`.

## CHANGELOG.md

### Format
Follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Version headers are `v`-prefixed (`## [v0.1.0]`) to match the git tag name exactly — the link footer below depends on this. Each version splits into two audience subsections:

- `### Release Notes` — what a user of the packaged app would notice. **Always present**, even with nothing to say (see below) — the release workflow extracts this subsection into the GitHub Release (bumping its `####` category headers to `##`, since the release page has no wrapping version/subsection levels to nest under), so it can't be omitted the way an empty category header can.
- `### Contributor Notes` — CI/CD, build tooling, dev-workflow changes a contributor cares about but a user never sees. Omit entirely when there's nothing to say, same as any other empty section.

Within each, entries group under `#### Added` / `#### Changed` / `#### Fixed` / `#### Removed` / `#### Deprecated` / `#### Security`, newest version first, dates as `YYYY-MM-DD`. Omit empty category headers rather than leaving them blank.

If a cycle has no user-facing changes, `### Release Notes` still appears, holding one line — "No user-facing changes in this release." — instead of category headers.

### Every change gets an Unreleased entry
Any change worth noting gets a bullet under `## [Unreleased]` in the same commit/PR that makes the change, not backfilled later. Skip purely internal changes (refactors, test-only changes) that neither a user nor a contributor would notice. Sort what's left by audience: would an end user of the packaged app notice? → `### Release Notes`. Only a contributor would (CI/CD, build tooling, dev workflow) → `### Contributor Notes`. Write Release Notes entries in user-facing language describing what changed, not which file changed — match the tone of the existing v0.1.0 entries.

Before adding a new bullet, check whether Unreleased already has one for the same feature/area. If a feature was added, then fixed, then changed again, then fixed again — all before the next release — that's **one** entry, edited in place each time, not four. `[Unreleased]` should always read as the diff between the last released version and right now, never as a log of the individual commits that got you there. When a fix lands for something Unreleased already claims as `Added`/`Changed` this cycle, correct that existing bullet (and its wording) instead of appending a separate `Fixed` bullet — a `Fixed` entry belongs in Unreleased only when it fixes something that shipped in a *previous* release.

### Cutting a new version
1. Rename `## [Unreleased]` to `## [vX.Y.Z] - YYYY-MM-DD` and add a fresh, empty `## [Unreleased]` above it.
2. Update the link footer (see below).
3. `git tag -a vX.Y.Z -m "..."` on the release commit, then `git push origin vX.Y.Z`.

### Link footer
Each version header is a markdown link reference, resolved at the bottom of the file, using GitHub's `/compare/{base}...{head}` diff view:
- `[Unreleased]` always compares the newest tagged version against `HEAD`: `.../compare/vX.Y.Z...HEAD`.
- Every version *after* the first compares against the version immediately before it: `.../compare/vPREV...vX.Y.Z`.
- The very first version has nothing to diff against, so it links straight to the tag instead: `.../tree/vX.Y.Z`. Switch that to `.../releases/tag/vX.Y.Z` if a GitHub Release is ever published for it — a bare pushed tag doesn't get a releases page on its own.

Concretely, when v0.2.0 ships the footer becomes:
```
[Unreleased]: https://github.com/TheNightAngel17/fitcast/compare/v0.2.0...HEAD
[v0.2.0]: https://github.com/TheNightAngel17/fitcast/compare/v0.1.0...v0.2.0
[v0.1.0]: https://github.com/TheNightAngel17/fitcast/tree/v0.1.0
```

## Agent skills

### Issue tracker

Issues and specs live as GitHub Issues in `TheNightAngel17/fitcast`, via the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Domain docs

Single-context layout: `CONTEXT.md` + `docs/adr/` at the repo root. See `docs/agents/domain.md`.
