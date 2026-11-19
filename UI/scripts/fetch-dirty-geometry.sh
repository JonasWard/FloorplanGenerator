#!/usr/bin/env bash
# Clones JonasWard/dirty-geometry (source of @dirty-geometry/vec2) at a pinned commit into UI/vendor.
# Override the location with DIRTY_GEOMETRY=/path/to/dirty-geometry (see vite.config.ts).
set -euo pipefail
here="$(cd "$(dirname "$0")/.." && pwd)"
dest="$here/vendor/dirty-geometry"
rev="${DIRTY_GEOMETRY_REV:-4573de5a3c95241e02efd594fea611dc2e8dc5d1}"

if [ ! -d "$dest/.git" ]; then
  git clone https://github.com/JonasWard/dirty-geometry "$dest"
fi
git -C "$dest" fetch --quiet origin
git -C "$dest" checkout --quiet "$rev"
echo "dirty-geometry at $(git -C "$dest" rev-parse --short HEAD) in $dest"
