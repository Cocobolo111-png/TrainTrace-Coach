#!/bin/bash
set -euo pipefail
root=/srv/www/sites/traintrace
service=traintrace.service
site=/etc/caddy/sites-enabled/traintrace.caddy
mode=${1:-}
[[ $EUID -eq 0 ]] || { echo 'Run with sudo'; exit 1; }
exec 9>/run/lock/traintrace-release.lock
flock -n 9 || { echo 'Another TrainTrace release is running'; exit 1; }
disable_site() {
  if [[ -f "$site" ]]; then
    backup="$root/ops/traintrace.caddy.withdrawn-$(date -u +%Y%m%dT%H%M%SZ)"
    mv "$site" "$backup"
    if ! caddy validate --config /etc/caddy/Caddyfile >/dev/null 2>&1; then mv "$backup" "$site"; echo 'Caddy validation failed; original site retained'; exit 1; fi
    if ! systemctl reload caddy; then mv "$backup" "$site"; systemctl reload caddy; exit 1; fi
  fi
  systemctl disable --now "$service"
  echo 'TrainTrace withdrawn; other sites and release files preserved'
}
if [[ "$mode" == disable ]]; then disable_site; exit; fi
if [[ "$mode" == rollback ]]; then
  if [[ ! -L "$root/previous" ]]; then disable_site; echo 'First production release: no previous server version'; exit; fi
  target=$(basename "$(readlink -f "$root/previous")")
elif [[ "$mode" == activate ]]; then target=${2:-}
else echo 'Usage: traintrace-release activate <release> | rollback | disable'; exit 2; fi
[[ "$target" =~ ^[0-9a-f]{12,40}$ ]] || { echo 'Invalid release ID'; exit 2; }
release="$root/releases/$target"
[[ -f "$release/SHA256SUMS" && -f "$release/dist-byok/index.html" && -f "$release/dist-server/index.js" ]] || { echo 'Incomplete release'; exit 1; }
(cd "$release" && sha256sum -c SHA256SUMS >/dev/null)
old=""
if [[ -L "$root/current" && -e "$root/current" ]]; then old=$(readlink -f "$root/current"); fi
ln -s "releases/$target" "$root/.current-next"
mv -Tf "$root/.current-next" "$root/current"
if ! systemctl restart "$service" || ! curl --retry 5 --retry-delay 1 --retry-connrefused -fsS http://127.0.0.1:8788/ >/dev/null; then
  if [[ -n "$old" && "$old" != "$release" ]]; then ln -s "$old" "$root/.current-next"; mv -Tf "$root/.current-next" "$root/current"; systemctl restart "$service"; else systemctl stop "$service"; fi
  echo 'Activation failed; previous service restored when available'; exit 1
fi
if [[ -n "$old" && "$old" != "$release" ]]; then
  ln -s "$old" "$root/.previous-next"; mv -Tf "$root/.previous-next" "$root/previous"
fi
systemctl enable "$service" >/dev/null
printf '%s\n' "$target" > "$release/.verified"
echo "Active TrainTrace release: $target"
