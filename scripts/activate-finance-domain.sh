#!/usr/bin/env bash
# Run on the existing deployment host from the committed release checkout.
set -euo pipefail
cd "$(dirname "$0")/.."
python3 - <<'PY'
import socket
host='dashboard.jamkkangudok.com'
try: addresses={x[4][0] for x in socket.getaddrinfo(host,80,type=socket.SOCK_STREAM)}
except socket.gaierror: raise SystemExit('DNS is not configured: add dashboard A -> 43.155.153.165 in Porkbun first.')
if '43.155.153.165' not in addresses: raise SystemExit('DNS does not point to the deployment host; no changes applied.')
PY
sudo install -d -m 0755 /var/www/dashboard-acme
sudo certbot certonly --webroot -w /var/www/dashboard-acme -d dashboard.jamkkangudok.com --non-interactive
sudo install -m 0644 deploy/nginx/dashboard.jamkkangudok.com.conf /etc/nginx/sites-available/dashboard.jamkkangudok.com.conf
sudo nginx -t
sudo systemctl reload nginx
curl --fail-with-body -s -o /dev/null -w 'HTTPS response: %{http_code}\n' https://dashboard.jamkkangudok.com/ || test "$?" = 22
