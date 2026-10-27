# Hyper-V release check for the Windows appliance

Manual check, run per release until the appliance has a proven track record
(spec 10.2, plus the carry-overs in spec 15 and 16). It takes a release
candidate zip from the `appliance-hyperv` CI artifact through
`Import-Achilles.ps1`, first boot, the install wizard, an agent, backup and
restore, and an upgrade, on a real Windows host with Hyper-V.

Each step has an ID, an owner, the exact command or action, and the expected
result. Record the outcome in the results table at the end.

- **host** steps are Windows PowerShell commands on the Hyper-V host. Claude
  runs them over SSH (see "Running host steps").
- **console** steps are done by a person in Hyper-V Manager (Connect) or
  `vmconnect localhost '<Name>'`, on the VM's console.
- **vm** steps run on the appliance, over SSH from the host (or a workstation).

Never write a password, Clerk key or backup into this file or the results.

## Before you start

You need: a release candidate (a `v*.*.*` tag's CI run, or a
`gh workflow run appliance.yml --ref <branch> -f full=true` run, which is green);
a second LAN machine to enroll an agent from; real Clerk **development** keys
(publishable and secret) from the user, for H6; the user at the keyboard for
every console step. For H9, a backup of a pre-appliance server install (its
`.env` has `COMPOSE_PROJECT_NAME=projectachilles`), taken with
`achilles-installer backup`.

Record the host build, the run id or tag and the zip's version first.

## Running host steps

Hyper-V commands need an elevated Windows PowerShell 5.1 (`powershell.exe`);
the script also runs under `pwsh` 7, but 5.1 is what a stock host has. Over
SSH, multi-line scripts go through `-EncodedCommand` (base64 of UTF-16LE), which
avoids every quoting problem:

```bash
# on the controller (bash); script.ps1 holds the commands
ssh <user>@<host> "powershell -NoProfile -EncodedCommand $(iconv -f UTF-8 -t UTF-16LE script.ps1 | base64 -w0)"
```

One-liners can be passed as `powershell -NoProfile -Command "..."`.
The SSH account must be an administrator and the session elevated (the OpenSSH
server gives administrators an elevated token). The host must be awake and
logged in for SSH to answer.

### Lab host (this runbook's first run; not a requirement for other hosts)

- Windows 11 Enterprise 24H2, Spanish (es-DO), Windows PowerShell 5.1, HP
  laptop, Hyper-V enabled. Adapter and switch names, and error text, may be
  Spanish.
- Ethernet `192.168.4.45` is the adapter for the External switch. Wi-Fi
  `192.168.4.44` carries the controller's SSH: `ssh mesa@192.168.4.44`. The
  user supplies the password per session.
- Because SSH arrives over Wi-Fi, creating the External switch on Ethernet does
  not cut the SSH session, so H3 can run over SSH with `-NetAdapterName` and
  `-ConfirmNetworkInterruption`. On a host where the session arrives over the
  adapter being bridged, do H3 from the console or a local session.

## Steps

### H1 - Host prerequisites (host)

```powershell
$os = Get-CimInstance Win32_OperatingSystem
"$($os.Caption) build $($os.BuildNumber) $($os.OSArchitecture)"
$PSVersionTable.PSVersion.ToString()
(New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())).IsInRole('Administrator')
(Get-WindowsOptionalFeature -Online -FeatureName Microsoft-Hyper-V-All).State
(Get-Service ClusSvc -ErrorAction SilentlyContinue).Status
$vh = (Get-VMHost).VirtualHardDiskPath; $vh
(Get-PSDrive -Name $vh.Substring(0,1)).Free / 1GB
(Get-CimInstance Win32_OperatingSystem).FreePhysicalMemory / 1MB
Get-NetAdapter | Where-Object Status -eq 'Up' | Format-Table Name, InterfaceDescription, LinkSpeed
Get-NetIPAddress -AddressFamily IPv4 | Format-Table InterfaceAlias, IPAddress
Get-VMSwitch | Format-Table Name, SwitchType, NetAdapterInterfaceDescription
```

Expected: Windows 10/11 Pro/Enterprise or Server 2019+; elevated `True`;
Hyper-V `Enabled`; `ClusSvc` absent or not running; at least 25 GB free at the
VHD path (image size + 20 GB; check the VHDX size in the zip); at least 8 GB
free memory (the VM's `-MemoryGB`; 6 minimum). Write down which adapter carries
the host's own connection (the one holding the SSH session's address): it must
**not** be the adapter you bridge unless you are on the console. Note any
existing External switch (decides H3 vs reuse).

### H2 - Fetch the artifact and the script (host)

On the controller:

```bash
gh run download <run-id> -n appliance-hyperv -D appliance-hyperv   # zip + appliance-SHA256SUMS
cd appliance-hyperv && sha256sum -c appliance-SHA256SUMS
scp ProjectAchilles-<ver>-hyperv.zip appliance-SHA256SUMS ../appliance/windows/Import-Achilles.ps1 <user>@<host>:C:/ach/
```

`C:\ach` must exist first and be on a drive with the free space from H1.
On the host, confirm the files arrived and the checksum file lists the zip:

```powershell
Get-ChildItem C:\ach | Format-Table Name, Length
Select-String -Path C:\ach\appliance-SHA256SUMS -Pattern 'hyperv.zip'
```

Expected: `sha256sum -c` prints OK on the controller; three files on the host. The
script itself re-verifies the zip in H3 against the checksum file (there is no
way to skip verification). Also run `Get-FileHash` on the host if the copy went
through anything you do not trust.

### H3 - Import with a NEW switch (host, or console / local session)

Precondition: no External switch exists for the chosen adapter and no VM named
`ProjectAchilles` (otherwise remove them first or pick H4's reuse path).

```powershell
cd C:\ach
powershell -NoProfile -ExecutionPolicy Bypass -File .\Import-Achilles.ps1 `
  -ImagePath .\ProjectAchilles-<ver>-hyperv.zip -ChecksumFile .\appliance-SHA256SUMS `
  -NetAdapterName '<Ethernet adapter name from H1>' -ConfirmNetworkInterruption
```

Never over RDP on the adapter being bridged. If the session arrives over that
adapter, run from the console without `-ConfirmNetworkInterruption` and type
the adapter name when asked.

Expected: `[OK]` lines for the checks, the checksum match, the disk copy, the new
switch `ProjectAchilles External`, the VM, and "Started the VM"; the console
command is printed before "Waiting up to 300 s"; exit code 0. No IPv4 address in
300 s is normal (first boot waits for the console): not a failure. Then verify
what the script set (Secure Boot template and VHDX import, spec 16):

```powershell
$vm = Get-VM -Name ProjectAchilles
$vm | Format-List Name, Generation, State, ProcessorCount, MemoryStartup, AutomaticStartAction, AutomaticStartDelay, AutomaticStopAction, CheckpointType, Notes
Get-VMFirmware $vm | Format-List SecureBoot, SecureBootTemplate
Get-VMNetworkAdapter $vm | Format-List SwitchName, Status
Get-VMIntegrationService $vm | Where-Object Enabled | Select-Object -ExpandProperty Name
(Get-VMSwitch 'ProjectAchilles External').AllowManagementOS
```

Expected: Generation 2, static 8 GB, 4 vCPU, `SecureBoot On`,
`MicrosoftUEFICertificateAuthority`, Production checkpoints, auto-start with a
30 s delay, shutdown on stop, Notes `ProjectAchilles appliance <ver>, imported
<date>`, Guest Service Interface and Time Synchronization enabled, the switch
reports `AllowManagementOS True`. On the lab host also confirm the host still
has its Ethernet address afterwards (`Get-NetIPAddress`) and that SSH still
answers.

If the VM booted to a Secure Boot violation instead of first boot, that is a
Fail (template/VHDX): record the console text.

### C1 - First boot on the real console (console)

The user opens the console (`vmconnect localhost 'ProjectAchilles'`, or Hyper-V
Manager -> Connect) and walks the real FormUI (CI only exercises the test UI):

1. **Keyboard**: pick **Latin American**. Type a few symbols in the password
   step to confirm the layout (`@`, `-`, `_`, `/`).
2. **Password**: set one (a throwaway for the lab; the user keeps it).
3. **Network**, wrong static IP first: choose static and enter an address that
   does not exist on the LAN (for example a different subnet). Expect the
   60 s confirm-or-revert screen. Do **not** confirm: wait it out. Expected:
   the settings revert and the wizard offers the choice again. Then choose
   **DHCP**. Expected: an address within about 5 s (slow DHCP servers show a
   "no address" notice and let you choose DHCP again; record if seen).
4. **Identity** (hostname/admin name): accept or set. **SSH on.**
5. **Handoff screen**: shows `ssh achilles@<ip>` and the SHA256 host key
   fingerprint. Write both down (photo or typed).
6. Reboot the VM (from the handoff or `Restart-VM` on the host). Expected:
   the tty1 banner and a login prompt appear (the first-boot unit is disabled;
   no second first boot). Reboot a second time and see the same.

Expected: every step as written; no second first-boot run after reboot.

### H5 - SSH from the host to the VM, compare the fingerprint (host)

```powershell
ssh achilles@<ip-from-C1>
```

On the first connect, ssh prints `SHA256:...` for the ED25519 key. Expected:
it equals the fingerprint written down in C1. Accept it and log in. If the
host has no `ssh.exe`, use the controller or another LAN machine and note it.
On the VM, check the image invariants (spec 15):

```bash
sudo stat -c '%a %n' /etc/netplan/*
ls /etc/systemd/system/getty.target.wants/ 2>&1 | grep -c 'getty@tty1' || true
stat -c '%a %n' /opt/projectachilles
sudo cat /etc/ssh/ssh_host_ed25519_key.pub | ssh-keygen -lf -
cat /etc/machine-id
git -C /opt/projectachilles describe --tags
```

Expected: `50-achilles.yaml` is `600` and no `50-cloud-init.yaml`; the getty
count is `0` (no `getty@tty1.service` in `getty.target.wants`); `/opt/projectachilles`
is `755`; the key fingerprint matches C1; the git tag matches the zip version.
Write down the machine-id and the fingerprint (compared with VM2 in H8). After
login a menu offers install / restore / shell.

### H6 - Install wizard over SSH (vm)

At the login menu choose **install** (or run
`sudo /opt/projectachilles/achilles-installer install`). Answers:
`TLS_MODE=achilles-ca`, `ES_MODE=self`, the VM's LAN address as the server
address, and the real Clerk **development** keys the user supplies (never
recorded here). Note the output at the image step.

Expected: the wizard completes with no image build ("Using the pre-built
images for <commit>"); if it instead prints "Rebuilding the backend and
frontend images: <reason>", that is a finding, record the reason (spec 15:
silent rebuild must at least say why). Then:

```bash
sudo /opt/projectachilles/achilles-installer status
curl -sk https://<vm-ip>/api/health
```

Expected: all services healthy, `status` clean, health `ok`. The UI opens at
`https://<vm-ip>/` from a LAN browser after trusting the exported CA, and the
Clerk sign-in works (first admin per the cloud/installer docs).

### H7 - Enroll an agent from another LAN machine and run one test (host / user)

From the UI create an enrollment token, install the agent on a second LAN
machine with the appliance's CA (`ca_cert`) per the installer output, then
dispatch one test to it.

Expected: the agent appears online with a heartbeat; the test task runs and
its result shows in Analytics/Executions. Record the agent OS and the test.

### H4 - Second import reusing the switch (host)

Do this before H8 (VM2 is the restore target); it is numbered H4 to follow the
spec's order of "new switch, then existing switch".

```powershell
cd C:\ach
powershell -NoProfile -ExecutionPolicy Bypass -File .\Import-Achilles.ps1 `
  -ImagePath .\ProjectAchilles-<ver>-hyperv.zip -ChecksumFile .\appliance-SHA256SUMS `
  -Name ProjectAchilles2 -SwitchName 'ProjectAchilles External' -Yes
```

Expected: exit 0; "reusing" the existing switch, no new switch created, no
network interruption; VM `ProjectAchilles2` created and started with its own
disk `ProjectAchilles2.vhdx`; the first VM is untouched. Then repeat C1 on
`ProjectAchilles2` (a different static/DHCP address; use a different hostname).
Expected: a different host key fingerprint and machine-id from VM1 (H5 values)
-- a repeat would mean the image was not sealed (spec 15).

### H8 - Backup on VM1, restore on VM2 with a different IP (vm)

On VM1:

```bash
sudo /opt/projectachilles/achilles-installer backup
ls -l /var/backups/projectachilles/
```

Copy the file with `scp` (it holds every secret) to VM2. VM2 has **never run
install** (spec 15: restore on a never-installed VM) and has a **different IP**
from VM1's. On VM2:

```bash
sudo /opt/projectachilles/achilles-installer restore /path/<timestamp>.tar.gz
```

Expected: the data restores, then the restore stops with: `The backup's server
address <VM1 ip> is not on this server. Run `sudo /opt/projectachilles/achilles-installer install`
and choose Reconfigure to set this server's address (your data and CA are
kept).` Then run `sudo /opt/projectachilles/achilles-installer install`, choose
**Reconfigure**, set VM2's address, finish. Expected: the stack starts; the
Clerk-linked data (agents, settings) and the same CA are present on VM2
(`status` shows the CA expiry equal to VM1's); the UI at VM2's address works
after trusting the (same) CA. This is the new-IP restore guard end to end
(QEMU gave both CI VMs the same address, so only this step proves it).

### H9 - Restore a legacy-project backup onto a fresh import (vm)

Needs a third VM (import with `-Name ProjectAchilles3 -SwitchName 'ProjectAchilles External' -Yes`,
C1, then **do not install**), or reuse VM2 after resetting it
(`Remove-VM` and re-import). Restore the pre-appliance backup (its `.env`
has `COMPOSE_PROJECT_NAME=projectachilles`):

```bash
sudo /opt/projectachilles/achilles-installer restore /path/<legacy>.tar.gz
```

Expected (before the stack starts): a line "Tagging the appliance's pre-built
achilles-server-* images as projectachilles-* ...", then "Using the pre-built
images for <commit>"; no image build and no download. If the address guard from
H8 fires, Reconfigure as there. The stack comes up on the legacy project name
(`docker ps` names start with `projectachilles-`). This is the retag path,
previously engine-tested only.

### H10 - Upgrade to the next tag (vm)

Only if a newer `v*.*.*` tag than the image's exists; otherwise record N/A.

```bash
sudo /opt/projectachilles/achilles-installer upgrade
ls -l /opt/projectachilles/achilles-installer
git -C /opt/projectachilles describe --tags
sudo /opt/projectachilles/achilles-installer status
```

Expected: shows `Upgrade: <from> -> <to>`, asks for confirmation, completes
(online: the VM needs internet; pulls/builds the new images) and `status` is
clean; the checkout is at the new tag and `/opt/projectachilles/achilles-installer`
was replaced (its modification time is new; the units call that path, spec 15). If it fails,
the rollback steps it prints are the result to record.

### H11 - Third import of the same zip is refused (host)

```powershell
cd C:\ach
powershell -NoProfile -ExecutionPolicy Bypass -File .\Import-Achilles.ps1 `
  -ImagePath .\ProjectAchilles-<ver>-hyperv.zip -ChecksumFile .\appliance-SHA256SUMS `
  -SwitchName 'ProjectAchilles External' -Yes
echo "exit=$LASTEXITCODE"
```

(No `-Name`, so it is `ProjectAchilles` again.) Expected: `[FAIL]` saying a VM
named `ProjectAchilles` **already exists**; `exit=1`; no new VM or disk, nothing
changed.

## Order and cleanup

Run H1, H2, H3, C1, H5, H6, H7 (VM1 done), then H4 (+ C1 on VM2), H8, H9, H10,
H11. H10 last on VM1 so earlier steps test the unmodified image. Cleanup after
the run (host), only for what this run created:

```powershell
Stop-VM -Name ProjectAchilles2 -TurnOff -Force; Remove-VM -Name ProjectAchilles2 -Force
Remove-Item C:\ach -Recurse
# The External switch and VM1 stay unless the user says otherwise.
```

Remove each VM's `.vhdx` from the VHD path after `Remove-VM`.

## Coverage

| Spec item | Step |
|-----------|------|
| 10.2 Import with a new switch | H3 |
| 10.2 Import with an existing switch | H4 |
| 10.2 First boot, then SSH | C1, H5 |
| 10.2 Wizard with real Clerk development keys | H6 |
| 10.2 Enroll one agent from a LAN machine, run one test | H7 |
| 10.2 `achilles-installer upgrade` to the next tag | H10 |
| 10.2 OVA in VMware Workstation, VirtualBox, ESXi/Proxmox (once per minor) | Not here: the OVA is Phase 5 |
| 15 No `50-cloud-init.yaml`; `50-achilles.yaml` is 0600 | H5 (netplan check); C1 (a static address takes effect) |
| 15 `getty@tty1` not enabled in the image | H5 (`getty.target.wants`); C1 (login prompt after reboot) |
| 15 Reboot a second time: banner and login prompt, no second first boot | C1 step 6 |
| 15 Distinct SSH host keys and machine-ids per VM | H5 (VM1 values), H4 (VM2 differs) |
| 15 `/opt/projectachilles` is 0755 (menu as `achilles`) | H5, and the login menu appearing |
| 15 Installer binary stays current after `upgrade` | H10 |
| 15 Pre-built image reuse logs why it rebuilds | H6, H9 |
| 15 `restore` on a VM where `install` never ran | H8 (VM2), H9 |
| 15 DHCP wait is about 5 s; "no address" notice | C1 step 3 |
| 16 New-IP restore guard end to end | H8 |
| 16 FormUI first boot on a real console | C1 |
| 16 Secure Boot template and VHDX import | H3 (firmware check), C1 (boots) |
| 16 Restore of a legacy-project backup (`projectachilles`) | H9 |
| 16 First CI run green before the next tag, `full=true` | "Before you start" (the run being tested) |
| 16 Phase 5 items (SHA256SUMS on the release path, R2, OVA, docs, NOTICES) and deferred hardening | Not here: Phase 5 / hardening |

## Results

One row per step per run. Result is Pass, Fail, N/A or Blocked.

| Date | Host build | Image version | Step | Pass/Fail | Notes |
|------|------------|---------------|------|-----------|-------|
|  |  |  | H1 |  |  |
|  |  |  | H2 |  |  |
|  |  |  | H3 |  |  |
|  |  |  | C1 |  |  |
|  |  |  | H5 |  |  |
|  |  |  | H6 |  |  |
|  |  |  | H7 |  |  |
|  |  |  | H4 |  |  |
|  |  |  | H8 |  |  |
|  |  |  | H9 |  |  |
|  |  |  | H10 |  |  |
|  |  |  | H11 |  |  |
