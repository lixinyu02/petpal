#!/bin/sh
set -eu
umask 077
mkdir -p /runtime/browser
# The browser is confined by the outer unprivileged container, with no host mounts.
exec chromium --no-sandbox --disable-dev-shm-usage --no-first-run --user-data-dir=/runtime/browser "$@"
