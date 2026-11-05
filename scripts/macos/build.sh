#!/usr/bin/env bash
set -euo pipefail
if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "macOS applications must be built on a Mac (or a macOS CI runner)." >&2
  exit 1
fi
task_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$task_root"
# Keep host build tools / proc macros loadable with newer macOS linkers.
# Stripping their debug information can produce a misaligned Mach-O LINKEDIT
# string pool. This does not enable debug information in the shipped app.
export CARGO_PROFILE_RELEASE_BUILD_OVERRIDE_DEBUG="${CARGO_PROFILE_RELEASE_BUILD_OVERRIDE_DEBUG:-true}"
npm run tauri -- build "$@"
