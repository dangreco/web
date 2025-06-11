#!/usr/bin/env bash

runtimes=(
    docker
    podman
)

found=0

for rt in "${runtimes[@]}"; do
    if command -v "$rt" >/dev/null 2>&1; then
        echo "$rt"
        found=1
    fi
done

if [[ $found -eq 0 ]]; then
    exit 1
fi
