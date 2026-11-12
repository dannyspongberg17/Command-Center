#!/bin/sh
# Mounted volumes (e.g. on Fly.io) are owned by root. While still root, give
# the data directory to the unprivileged "node" user (uid/gid 1000). The
# server then permanently drops root privileges as its first action
# (see dropPrivileges in src/index.ts).
set -e
if [ "$(id -u)" = "0" ]; then
  mkdir -p "$DATA_DIR"
  chown -R "${RUN_AS_UID:-1000}:${RUN_AS_GID:-1000}" "$DATA_DIR"
  chmod 700 "$DATA_DIR"
fi
exec "$@"
