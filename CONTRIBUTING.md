# Contributing

## Branching model

`dev` is the default branch and the target for all work. `main` is
machine-maintained: it is fast-forwarded to each released commit, so it always
points at the latest release. **Never push to `main`.**

```
feat/* ──PR──▶ dev ──▶ release-please keeps a "chore(main): release X.Y.Z" PR open
                            │ merge
                            ▼
        tag vX.Y.Z + GitHub Release ──▶ CD publishes the image
                            │
                            ▼
                   main fast-forwarded
```

## Making a change

Branch off `dev` as `feat/<slug>` (or `fix/<slug>`), then open a PR against
`dev`.

PRs are **squash-merged**, so the PR title becomes the commit subject on `dev` —
and that subject is what release-please parses to decide the next version. The
PR title must therefore be a
[conventional commit](https://www.conventionalcommits.org/), and CI enforces it:

| Prefix                                          | Effect on the next release |
| ----------------------------------------------- | -------------------------- |
| `feat:`                                         | minor bump                 |
| `fix:`, `perf:`                                 | patch bump                 |
| `refactor:`, `docs:`, `build:`, `chore:`, `ci:` | no bump (still allowed)    |
| any `!` suffix or `BREAKING CHANGE:` footer     | major bump                 |

Individual commits within the PR don't need to follow the convention — only the
title does.

## Releasing

You don't cut releases by hand. release-please keeps a release PR open against
`dev` for as long as there are unreleased, releasable commits. Merging that PR
bumps the version in `deno.json`, updates `CHANGELOG.md`, tags `vX.Y.Z`, creates
the GitHub Release, and fast-forwards `main`. The tag push is what triggers CD
to build and publish `ghcr.io/dangreco/web` (`:X.Y.Z`, `:X.Y`, `:X`, `:latest`).

The deployment tracks `:latest`. Because the `Dockerfile` builds on floating
base images (`nixos/nix:latest`, `nginx:alpine`), a base-image refresh with no
code change needs either a release or a manual `workflow_dispatch` run of the CD
workflow.

## Local development

```sh
nix develop           # dev shell (deno, go-task, pinact, ...)
task serve            # run the site with live reload
task check            # lint + format checks, same as CI
task fix              # autofix what it can
```

GitHub Actions are SHA-pinned. After adding or bumping an action, run
`pinact run` rather than writing the SHA by hand.
