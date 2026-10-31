---
sidebar_position: 5.6
title: Windows Hyper-V Appliance
description: Download the prebuilt ProjectAchilles virtual machine, import it into Hyper-V with a verified checksum, and have a working server on your LAN without installing Linux yourself.
---

# Windows Hyper-V Appliance

A prebuilt **Linux virtual machine** with ProjectAchilles ready to install. You
download one zip, import it into Hyper-V with a script that verifies it, and
answer the same install wizard as the [Server Installer](./server-installer). You
do not install or manage Linux yourself.

## What it is and what you need

The appliance is the same on-prem install as the
[Server Installer](./server-installer) (Docker Compose stack behind Caddy, with
the managed ProjectAchilles CA), packaged as a Generation 2 Hyper-V VM.

You need:

- A **Windows host with Hyper-V enabled** (Windows 10/11 Pro or Enterprise, or Windows Server), with **8 GB of free RAM** for the VM (6 GB is the minimum) and enough free disk for the image.
- An **elevated** Windows PowerShell on that host.
- A **Clerk** application (publishable and secret keys), as for any install. See [Clerk Setup](./clerk-setup).

:::warning[No VirtualBox alongside Hyper-V]
Do not run VirtualBox on the same host. When Hyper-V is enabled the two
hypervisors conflict, and VirtualBox VMs hang or fail to start.
:::

The import script never enables Hyper-V for you. It checks the host first and
refuses, before changing anything, when it is not elevated, Hyper-V is off, the
host is a failover cluster node, a VM or disk of the same name exists, or disk
or memory is short.

## 1. Download

Download `ProjectAchilles-v<version>-hyperv.zip` from the release's download
link:

```text
https://pub-a6274ea13e824eb9b36c451d2740eced.r2.dev/appliance/ProjectAchilles-v<version>-hyperv.zip
```

The current link is on the
[GitHub releases page](https://github.com/projectachilles/ProjectAchilles/releases)
and is announced with each release. Also download `Import-Achilles.ps1` from
the same release.

The zip is **not** downloaded by the script: `-ImagePath` is a local path to
the file you saved.

## 2. Import into Hyper-V

From an **elevated** PowerShell, in the folder that holds the script and the zip:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\Import-Achilles.ps1 -ImagePath .\ProjectAchilles-v<version>-hyperv.zip -Version <version>
```

`<version>` is the bare release number, for example `2.8.0`. With `-Version`,
the script downloads the authoritative `appliance-SHA256SUMS` from that GitHub
release and verifies your zip against it before touching Hyper-V. The checksum
comes from GitHub on purpose: the zip is hosted elsewhere, so a forged image
would also need a forged GitHub release.

A host **without internet access** uses a copy of the checksum file instead:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\Import-Achilles.ps1 -ImagePath D:\ProjectAchilles-v<version>-hyperv.zip -ChecksumFile D:\appliance-SHA256SUMS
```

Use either `-Version` or `-ChecksumFile`. There is no way to skip verification.

:::note
A checksum is not a signature: it proves the image matches what was published
on the release. Run the script with the `powershell -NoProfile -ExecutionPolicy Bypass -File`
form above (a script downloaded with a browser is blocked by the default
execution policy); do not dot-source it.
:::

The script then copies the disk, picks or creates an **External** virtual
switch, creates a Generation 2 VM named `ProjectAchilles` and starts it. The VM
needs an External switch so the agents on your network can reach it:

- An existing External switch is reused.
- Otherwise the script lists the physical adapters that are up and creates `ProjectAchilles External` on the one you type. **This interrupts the host's network on that adapter for several seconds**, so a Remote Desktop session over it disconnects. Do this step at the host, or over a different adapter.
- It never picks the Default Switch or an Internal/Private switch by itself (only `-SwitchName` can). Agents will not reach the VM through those.

Useful options: `-Name`, `-SwitchName`, `-NetAdapterName`, `-VlanId`,
`-MemoryGB` (default 8, minimum 6), `-CpuCount` (default 4), `-Destination`,
`-NoStart`. Run `Get-Help .\Import-Achilles.ps1 -Full` for all of them. After
a failure the VM and its disk are kept, and the script prints the commands
that remove them.

## 3. First boot on the console

Open the console from the **Windows desktop** of the host (Hyper-V Manager,
then Connect, or `vmconnect localhost 'ProjectAchilles'`). First boot asks for:

1. The **console keyboard layout**.
2. A password for the `achilles` admin account: **at least 12 characters**. It is your login for the console and SSH; keep it in a password manager.
3. The **network**: DHCP, or a static address (CIDR, gateway, 1 to 3 DNS servers). Prefer a **fixed address** (a DHCP reservation is fine): agents and the certificate depend on it.

Each VM generates its own SSH host key and machine identity on first boot, so
two imports never share them. When it finishes, the console shows the address
and the SSH host key fingerprint. Write both down.

Then log in on the console as `achilles` and run the install wizard (choose **install** in the menu). It is the
same wizard as in the [Server Installer](./server-installer): choose
`achilles-ca` TLS, the domain name for the server, and enter your Clerk keys
(`pk_live_XXX` and your secret key). It ends on the **Done** screen, which prints the
URL, the server IP, the root CA files and the CA's **SHA-256 fingerprint**. Keep
that screen's values for the next step, or print them again with
`achilles-installer status` and `achilles-installer ca export --out <dir>`.

## 4. Name and browser trust

The server's certificate names only the domain you chose, so the UI does **not**
open at `https://<vm-ip>/`. Browsers need the name, and to trust the CA.

### Trial: one workstation

On the workstation that will use the UI (as administrator), add a hosts line
built from the IP and domain the Done screen shows:

```text
# C:\Windows\System32\drivers\etc\hosts
<server-ip>  <your-domain>
```

Then download the root CA from `http://<your-domain>/ca/root.cer` and check its
SHA-256 against the fingerprint the Done screen printed (`<sha256>`):

```powershell
Get-FileHash .\root.cer -Algorithm SHA256
```

Import it into **Trusted Root Certification Authorities** (double-click the
file, Install Certificate, Local Machine). Only then open
`https://<your-domain>` and sign in with Clerk.

### Production: DNS and GPO

For a real fleet, do not edit hosts files. Create an **internal DNS A record**
for the domain pointing at the server, and push `root.cer` to the endpoints'
Trusted Root store with a **GPO** (or Intune). The full procedure, including who
owns each piece, is in
[Server Installer: distributing trust](./server-installer#distributing-trust-and-enrolling-windows-endpoints).

## 5. Enroll endpoints

Windows endpoints enroll with the fingerprint-pinned `bootstrap-windows.ps1`
generated on the server at `/opt/projectachilles/deploy/onprem/`. Copy it over
SSH, then on each endpoint, from an elevated PowerShell:

```powershell
powershell -ExecutionPolicy Bypass -File .\bootstrap-windows.ps1 -Token "<enrollment-token>"
```

Create the enrollment token in the UI's agent management. Details and troubleshooting
are in [Server Installer: enroll with the bootstrap script](./server-installer#distributing-trust-and-enrolling-windows-endpoints).
Prepare the endpoints first (signing certificate, Defender ASR exclusion for `C:\F0`):
[Endpoint Prerequisites](./endpoint-prerequisites).

## 6. Backup, restore and migration

Run these on the VM (SSH in as `achilles`, or use the console):

```bash
cd /opt/projectachilles
sudo ./achilles-installer backup            # /var/backups/projectachilles/<UTC timestamp>.tar.gz (or .tar.zst)
sudo ./achilles-installer restore <file>    # overwrites volumes, config and CA
```

A backup holds the data, the configuration and the **CA including its root
key**: copy it off the VM and store it as a secret.

**Moving to a new appliance** (or rebuilding one): import a fresh VM, run
`restore` with the backup, and give the new server the **same address and
domain**. Agents move to the new server when they reconnect, because the CA and
name are unchanged. Then **retire the old server**: shut it down and delete
it, so two servers never serve the same fleet.

## 7. Upgrading

Upgrade in place; do **not** import a new image over an existing install. New
releases publish a new image for new installs only. Existing installs update
with the installer:

```bash
cd /opt/projectachilles
sudo ./achilles-installer backup
sudo ./achilles-installer upgrade
```

`upgrade` asks for confirmation and prints any follow-up steps; see
[Server Installer: upgrading](./server-installer#upgrading) for the order.

## Troubleshooting

**Clerk sign-in fails with "Session expired or authentication failed".**
If the Hyper-V host slept (a laptop host does), the VM's clock can lag behind
real time, and Clerk rejects the session because of it. Check the clock on the
VM with `date -u` and compare it with real time; `sudo ./achilles-installer status`
reports the server's health. If the clock is behind, restart time sync:

```bash
sudo systemctl restart systemd-timesyncd
```

To avoid it, set the host's sleep to **Never** on AC power. There is no
automatic clock fix in the image yet.

**`vmconnect` opens nothing.** It needs the host's desktop session (the user at
the host, or Remote Desktop). Run from an SSH session it opens nowhere. Use
Hyper-V Manager at the desktop, or SSH into the VM directly.

**The UI shows a certificate error, or "Not secure".** You opened it by IP
(the certificate names only the domain), or the root CA is not trusted on that
machine. Use the domain and import `root.cer` as in step 4.

**The agents cannot reach the server.** The VM is on the Default Switch or an
Internal/Private switch. Connect it to an External switch (`Connect-VMNetworkAdapter -VMName ProjectAchilles -SwitchName <switch>`,
or Hyper-V Manager).

**Non-English Windows.** The script and commands work on localized Windows;
adapter and switch names, and some error text, appear in the local language.
Type adapter names exactly as the script lists them. Agent versions before
0.7.1 can print `icacls` warnings on non-English Windows during enrollment;
update the agent to 0.7.1 or later.

**The import script stops half way.** It prints the exact commands that remove
the partly created VM and disk. Run them, fix the cause, and run the import again.
