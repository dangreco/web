root := `git rev-parse --show-toplevel`

_default:
    @just --list

_root:
    @echo {{ root }}

_runtimes:
    @{{ root }}/scripts/runtimes.sh

act *args:
    @{{ root }}/scripts/act.sh {{ args }}

dev:
    @pnpm run dev --open

build:
    @pnpm run build

preview:
    @pnpm run preview
