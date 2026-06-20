#!/bin/sh
set -e

# The Railway volume mounted at public/uploads starts empty, shadowing
# whatever was baked into the image at that path. Seed it once from the
# image's copy without ever overwriting files already on the volume
# (newer uploads, or files from a previous container).
if [ -d /app/seed-uploads ]; then
  mkdir -p /app/public/uploads
  cp -rn /app/seed-uploads/* /app/public/uploads/ 2>/dev/null || true
fi

exec "$@"
