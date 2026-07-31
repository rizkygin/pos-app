# Self-hosted OSRM routing for delivery distances.
#
# Replaces router.project-osrm.org, whose usage policy states access "shall be
# withdrawn at any time and without giving a reason" — not something to hang
# courier pricing on. Point OSRM_BASE_URL at this service and nothing else in
# the app changes.
#
# Two stages so the shipped image carries only the routing graph and the server:
# the .osm.pbf source and the extraction toolchain stay in the build stage.
#
# The preprocessing runs at BUILD time, not on boot. A cold start therefore only
# mmaps the prepared graph (seconds), instead of re-running a multi-minute,
# multi-GB extract every time the container restarts.

# ─── Stage 1: fetch the region and build the routing graph ──────────────────
FROM ghcr.io/project-osrm/osrm-backend:latest AS build

# Kalimantan only (~147 MB). All of Indonesia is 1.73 GB and would cost far more
# RAM to preprocess for roads nobody in this app drives on. Override to widen:
#   --build-arg REGION_URL=https://download.geofabrik.de/asia/indonesia-latest.osm.pbf
ARG REGION_URL=https://download.geofabrik.de/asia/indonesia/kalimantan-latest.osm.pbf

# Clip to the delivery area before preprocessing.
#
# THIS IS NOT AN OPTIMISATION, IT IS LOAD-BEARING. osrm-extract on the full
# Kalimantan file peaks around 1.7 GB, which fits a plain `docker run` but OOMs
# inside BuildKit, whose builder has less headroom — the build fails with
# "cannot allocate memory". Clipping first keeps the peak in the hundreds of MB
# and makes the build reproducible on Railway's builder too.
#
# Box covers roughly 145 x 145 km around the outlets (111.64E, 2.72S), against a
# 50 km delivery cap — generous margin on every side. Widen it if the service
# area moves; routing simply stops at the edge of whatever is included here.
ARG BBOX=111.0,-3.4,112.3,-2.1

# car.lua is the shipped default. foot.lua and bicycle.lua are also in /opt —
# a motorcycle profile (couriers) would be a custom .lua copied in here.
ARG PROFILE=/opt/car.lua

WORKDIR /data

RUN apt-get update \
 && apt-get install -y --no-install-recommends curl ca-certificates osmium-tool \
 && rm -rf /var/lib/apt/lists/*

# Download the region, clip it, and drop the full file in the same layer — the
# 147 MB original must not survive into the layer cache.
RUN curl -fSL --retry 3 -o full.osm.pbf "$REGION_URL" \
 && osmium extract --bbox "$BBOX" --strategy complete_ways \
      -o region.osm.pbf full.osm.pbf \
 && rm -f full.osm.pbf \
 && echo "clipped size:" && du -h region.osm.pbf

# MLD (partition + customize) rather than CH (contract): materially lower memory
# to serve, and it is the algorithm that supports live traffic updates later
# without a full re-contract.
RUN osrm-extract -p "$PROFILE" region.osm.pbf \
 && osrm-partition region.osrm \
 && osrm-customize region.osrm \
 && rm -f region.osm.pbf

# ─── Stage 2: serve ─────────────────────────────────────────────────────────
FROM ghcr.io/project-osrm/osrm-backend:latest

WORKDIR /data
COPY --from=build /data/region.osrm* /data/

# Railway injects PORT; 5000 is OSRM's own default for local compose.
ENV PORT=5000

# --max-table-size raises the cap on the /table service (distance matrices),
# which is what a "nearest courier to this pickup" query needs. Default is 100,
# i.e. a 10x10 matrix — too small once there are more than a few couriers.
#
# Shell form deliberately: ${PORT} must expand at runtime, and exec form would
# pass it through as a literal string.
CMD osrm-routed \
      --algorithm mld \
      --ip 0.0.0.0 \
      --port "${PORT}" \
      --max-table-size 1000 \
      /data/region.osrm
