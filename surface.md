# CLI API Surface — Auto-detect Transport

## Transport detection

On every invocation, the CLI detects the transport automatically:

1. Run `arp -n 10.0.0.1` (timeout: 2s)
2. If a MAC address is present, try USB (10.0.0.1:22) with a 5s SSH timeout
3. If USB SSH fails, fall back to WiFi (ngrok tunnel at 3.tcp.ngrok.io:21045)
4. If no MAC address, use WiFi directly

```
arp -n 10.0.0.1 → "? (10.0.0.1) at e:af:be:e3:9e:37 on en8 ..."  → USB
arp -n 10.0.0.1 → "? (10.0.0.1) at (incomplete) ..."              → no USB
arp -n 10.0.0.1 → (no output)                                     → no USB
```

Fallback only applies in auto-detect mode. Forced transport (`-u`/`-w`) has no fallback — fail clearly if the forced transport is unavailable.

Every command prints a transport indicator prefix on the first output line:

```
[usb] Deploying to Pi...
```

On fallback:

```
[usb] SSH connection failed. Falling back to WiFi...
[wifi] Deploying to Pi...
```

## Commands

```
deno task pi                          # SSH into Pi
deno task pi deploy                   # deploy to Pi
deno task pi status                   # Pi health dashboard
deno task pi wifi                     # interactive WiFi manager (see below)
```

## Force transport override

```
deno task pi --via-usb <command>          # force USB (long form)
deno task pi --via-wifi <command>         # force WiFi (long form)
deno task pi -u <command>                 # force USB (short form)
deno task pi -w <command>                 # force WiFi (short form)
```

## `deno task pi wifi` — interactive

```
What do you want to do?
> add
  remove
  reset

--- add ---
SSID (blank for current): _
Password: _

--- remove ---
SSID:
> Ducksworth    (current)
  CoffeeShop
  HomeNetwork

--- reset ---
This will remove ALL saved WiFi networks. The Pi will only be
reachable via USB after this. Continue? [y/N]
```

If `wifi reset` is selected while connected via WiFi, the interactive menu shows an error and returns to the menu instead of exiting:

```
Error: Cannot run 'wifi reset' over WiFi — this would disconnect
the Pi and lock you out. Connect via USB cable and try again.
```

Same for `wifi remove` when selecting the current network over WiFi.

## `deno task pi wifi` — subcommands (for CI/CD)

```
deno task pi wifi add                 # detect Mac's current SSID, prompt password
deno task pi wifi add <ssid>          # prompt password only
deno task pi wifi add <ssid> <pass>   # fully non-interactive
deno task pi wifi add <ssid> --password-stdin   # read password from pipe
deno task pi wifi list                # list saved networks
deno task pi wifi remove <ssid>       # remove a saved network
deno task pi wifi reset               # wipe all WiFi config (USB only)
```

### `--password-stdin`

- Reads exactly one line from stdin (strips trailing newline)
- Mutually exclusive with positional `<pass>` — providing both is a usage error (exit 2)
- If stdin is a TTY (not piped), error immediately — do not hang

```
echo "$PASS" | deno task pi wifi add CoffeeShop --password-stdin
```

## Safety guards

### `wifi reset` over WiFi — blocked

Running `wifi reset` over WiFi would disconnect the Pi and lock you out. The CLI blocks this entirely:

```
Error: Cannot run 'wifi reset' over WiFi — this would disconnect
the Pi and lock you out. Connect via USB cable and try again.
```

### `wifi remove <current-network>` over WiFi — blocked

Same risk. Removing the active WiFi network over WiFi disconnects the session:

```
Error: Cannot remove active WiFi network while connected via WiFi.
Connect via USB cable and try again.
```

### Fallback into blocked commands

If auto-detect finds USB but SSH fails, and the command is `wifi reset` or `wifi remove <current-network>`, do NOT fall back to WiFi. Abort:

```
Error: Cannot run 'wifi reset' — USB was detected but SSH failed,
and this command is blocked over WiFi.
Check your USB cable connection and try again.
```

## Error messages

All errors are human-readable, wrapped from raw SSH/network errors:

```
[usb] Error: Connection refused.
  ssh: connect to host 10.0.0.1 port 22: Connection refused
  Is the Pi powered on? Check the USB cable.

[wifi] Error: Connection timed out.
  ssh: connect to host 3.tcp.ngrok.io port 21045: Operation timed out
  Is ngrok running on the Pi?

Error: Could not connect to Pi.
  USB  (10.0.0.1:22)             — Connection timed out
  WiFi (3.tcp.ngrok.io:21045)    — Connection refused
  Check that the Pi is powered on and reachable.
```

## Mutation feedback

After `add`/`remove`/`reset`, echo what changed:

```
[usb] Added WiFi network "CoffeeShop".
  Saved networks: Ducksworth (current), CoffeeShop, HomeNetwork

[usb] Removed WiFi network "CoffeeShop".
  Remaining networks: Ducksworth (current), HomeNetwork

[usb] All WiFi networks removed. Pi is now USB-only.
```

## Timeouts (hardcoded)

| Operation       | Timeout |
|-----------------|---------|
| ARP detection   | 2s      |
| SSH connection  | 5s      |
| Command exec    | 30s     |

No `--timeout` flag. Hardcode sensible defaults.

## Exit codes

| Code | Meaning           |
|------|--------------------|
| 0    | Success            |
| 1    | General error      |
| 2    | Usage error        |
| 3    | Connection failed  |
| 4    | Timeout            |
| 5    | Operation blocked  |

## Help text

### `deno task pi --help`

```
arachne — Raspberry Pi management over USB or WiFi

Usage:
  deno task pi                         SSH into the Pi
  deno task pi deploy                  Deploy to the Pi
  deno task pi status                  Show Pi health dashboard
  deno task pi wifi                    Manage WiFi networks (interactive)

Transport:
  Auto-detected via ARP lookup. Falls back to WiFi if USB is
  unavailable. All output is prefixed with [usb] or [wifi].

  --via-usb,  -u    Force USB transport (no fallback)
  --via-wifi, -w    Force WiFi transport (no fallback)

Exit codes:
  0  Success          3  Connection failed
  1  General error    4  Timeout
  2  Usage error      5  Operation blocked

Run 'deno task pi <command> --help' for command-specific help.
```

### `deno task pi wifi --help`

```
arachne wifi — Manage WiFi networks on the Pi

Interactive mode:
  deno task pi wifi              Opens interactive menu (add/remove/reset)

Direct commands:
  deno task pi wifi add [ssid] [password]   Add a WiFi network
  deno task pi wifi add [ssid] --password-stdin
  deno task pi wifi list                    List saved networks
  deno task pi wifi remove <ssid>           Remove a saved network
  deno task pi wifi reset                   Wipe all WiFi config (USB only)

Notes:
  - 'wifi add' with no args detects your Mac's current SSID
  - 'wifi add <ssid>' prompts for password interactively
  - 'wifi add <ssid> <pass>' is fully non-interactive
  - --password-stdin reads one line from stdin; mutually exclusive
    with positional password
  - 'wifi reset' is blocked over WiFi (exit code 5)
```
