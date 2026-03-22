#!/bin/bash
set -euo pipefail
exec > >(tee /var/log/arachne-first-boot.log) 2>&1
echo "=== arachne first-boot $(date) ==="

# --- USB gadget networking (no network needed) ---
# cmdline.txt already has modules-load=dwc2,g_ether from setup
# Just configure the static IP for usb0

cat > /etc/network/interfaces.d/usb0 <<'IFACE'
allow-hotplug usb0
iface usb0 inet static
  address 10.0.0.1
  netmask 255.255.255.0
IFACE

# Load modules now (cmdline.txt handles future boots)
modprobe dwc2 || true
modprobe g_ether || true

# Bring up interface
ifup usb0 2>/dev/null || true

echo "=== arachne first-boot complete ==="

# Self-destruct
rm -f "$0"
