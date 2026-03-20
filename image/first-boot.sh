#!/bin/bash
# arachne first-boot — runs once during DietPi initial setup
set -euo pipefail

echo "=== arachne first-boot ==="

# --- USB gadget networking (g_ether) ---
# Makes the Pi reachable at 10.0.0.1 over USB

# Ensure kernel modules load on every boot
grep -q "^dwc2$" /etc/modules 2>/dev/null || echo "dwc2" >> /etc/modules
grep -q "^g_ether$" /etc/modules 2>/dev/null || echo "g_ether" >> /etc/modules

# Load them now
modprobe dwc2 2>/dev/null || true
modprobe g_ether 2>/dev/null || true

# Static IP on usb0
cat > /etc/network/interfaces.d/usb0 <<'EOF'
allow-hotplug usb0
iface usb0 inet static
    address 10.0.0.1
    netmask 255.255.255.0
EOF

ifup usb0 2>/dev/null || true

echo "=== arachne first-boot complete ==="
