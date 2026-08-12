#!/usr/bin/env bash
set -euo pipefail
cd /opt/picomeet
sudo -u picomeet git pull
sudo -u picomeet npm install --omit=dev
systemctl restart picomeet
echo "PicoMeet updated and restarted."
