#!/usr/bin/env bash

root=$(just _root)
runtimes=$(just _runtimes)

if [[ -z "$runtimes" ]]; then
    echo "No container runtimes found"
    exit 1
fi

while IFS= read -r runtime; do
    if [[ "$runtime" == "docker" ]]; then
        if [[ -S /var/run/docker.sock ]]; then
            socket="/var/run/docker.sock"
            break
        fi
    elif [[ "$runtime" == "podman" ]]; then
        if [[ -S /run/podman/podman.sock ]]; then
            socket="/run/podman/podman.sock"
            break
        elif [[ -S "$XDG_RUNTIME_DIR/podman/podman.sock" ]]; then
            socket="$XDG_RUNTIME_DIR/podman/podman.sock"
            break
        fi
    fi
done <<< "$runtimes"

if [[ -z "$socket" ]]; then
    echo "No container runtime found"
    exit 1
fi

DOCKER_HOST="unix://${socket}" act "$@"
