import type { Conn } from "../../../dto/transport.ts";
import type { OverclockProfile } from "../../../dto/overclock.ts";
import { CliError, EXIT } from "../../../dto/exit-codes.ts";
import { TextHelpers } from "../../business/text-helpers/mod.ts";
import { SshClient } from "../ssh/mod.ts";

const text = new TextHelpers();

const MODEL_MAP: [string, string][] = [
  ["Raspberry Pi Zero 2", "zero2w"],
  ["Raspberry Pi 3 Model B +", "3b_plus"],
  ["Raspberry Pi 4 Model B", "4b"],
  ["Raspberry Pi 5", "5"],
];

const REVERT_SERVICE = `[Unit]
Description=Revert overclock settings

[Service]
Type=oneshot
ExecStart=/bin/bash -c 'cp /boot/firmware/config.txt.known-good /boot/firmware/config.txt && reboot'
`;

const REVERT_TIMER = `[Unit]
Description=Revert overclock after 20 min if not cancelled

[Timer]
OnBootSec=20min
Unit=overclock-revert.service

[Install]
WantedBy=timers.target
`;

export class OverclockManager {
  constructor(private readonly ssh: SshClient) {}

  async loadProfiles(): Promise<Record<string, OverclockProfile>> {
    const path = new URL("../../../assets/overclock.json", import.meta.url).pathname;
    return JSON.parse(await Deno.readTextFile(path));
  }

  async detectModel(c: Conn): Promise<[string, OverclockProfile]> {
    const r = await this.ssh.exec(c, "cat /proc/device-tree/model");
    if (!r.ok) throw new CliError(`${text.tag(c.transport)} Error: Could not detect Pi model.`, EXIT.GENERAL);
    const model = r.stdout;
    const profiles = await this.loadProfiles();
    for (const [substr, key] of MODEL_MAP) {
      if (model.includes(substr)) {
        const profile = profiles[key];
        if (!profile) throw new CliError(`${text.tag(c.transport)} Error: No overclock profile for ${model}.`, EXIT.GENERAL);
        return [key, profile];
      }
    }
    throw new CliError(`${text.tag(c.transport)} Error: Unknown Pi model: ${model}\n  Supported: ${MODEL_MAP.map(([s]) => s).join(", ")}`, EXIT.GENERAL);
  }

  async setupWatchdog(c: Conn) {
    await this.ssh.exec(c, [
      `grep -q '^dtparam=watchdog=on' /boot/firmware/config.txt || echo 'dtparam=watchdog=on' >> /boot/firmware/config.txt`,
      `modprobe bcm2835_wdt 2>/dev/null || true`,
      `grep -q '^RuntimeWatchdogSec' /etc/systemd/system.conf || sed -i 's/^#RuntimeWatchdogSec=.*/RuntimeWatchdogSec=30/' /etc/systemd/system.conf`,
    ].join(" && "));
  }

  async installDeadManSwitch(c: Conn) {
    await this.ssh.exec(c, [
      `cp /boot/firmware/config.txt /boot/firmware/config.txt.known-good`,
      `cat > /etc/systemd/system/overclock-revert.service << 'EOF'\n${REVERT_SERVICE}EOF`,
      `cat > /etc/systemd/system/overclock-revert.timer << 'EOF'\n${REVERT_TIMER}EOF`,
      `systemctl daemon-reload`,
      `systemctl enable --now overclock-revert.timer`,
    ].join(" && "));
  }

  async cancelDeadManSwitch(c: Conn) {
    await this.ssh.exec(c, [
      `systemctl disable --now overclock-revert.timer 2>/dev/null || true`,
      `rm -f /etc/systemd/system/overclock-revert.service /etc/systemd/system/overclock-revert.timer`,
      `systemctl daemon-reload`,
    ].join(" && "));
  }

  async waitForReboot(c: Conn, timeoutSec = 180): Promise<boolean> {
    await new Promise((r) => setTimeout(r, 5000));
    const start = Date.now();
    while (Date.now() - start < timeoutSec * 1000) {
      const probe = await this.ssh.probe(c);
      if (probe.ok) return true;
      await new Promise((r) => setTimeout(r, 10000));
    }
    return false;
  }

  async readTemp(c: Conn): Promise<number> {
    const r = await this.ssh.exec(c, "cat /sys/class/thermal/thermal_zone0/temp");
    return r.ok ? parseInt(r.stdout) / 1000 : -1;
  }
}
