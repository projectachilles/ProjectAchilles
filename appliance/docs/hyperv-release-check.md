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
- **vm** steps run on the appliance. The **controller** runs them over SSH from
  its own machine (the VM is bridged on the LAN; if it cannot reach the VM,
  `ssh -J <user>@<host>` through the Hyper-V host). Every `vm` step below is
  written in the non-interactive form the controller can run.
- **C2** (optional) is the interactive TUI wizard, done by the user on the
  console.

Ownership of credentials: in C1 the user chooses the appliance admin password
and hands it to the controller in chat at that moment. The controller keeps it
only in its shell environment and uses it through `sshpass -e` (the
`SSHPASS` variable) and `sudo -S` fed from the same variable:

```bash
export SSHPASS='<password the user chose>'          # never written to a file
vmssh() { sshpass -e ssh -o StrictHostKeyChecking=accept-new achilles@"$VM_IP" "$@"; }
vmsudo() { sshpass -e ssh -o StrictHostKeyChecking=accept-new achilles@"$VM_IP" "sudo -S -p '' $*" <<<"$SSHPASS"; }   # sudo reads the password from stdin
```

The Clerk development keys come from
the user in chat for H6, go into a file on the VM that is deleted after the
run, and are never committed or logged. Never write a password, Clerk key or
backup into this file or the results.

## Before you start

You need: a release candidate (a `v*.*.*` tag's CI run, or a
`gh workflow run appliance.yml --ref <branch> -f full=true` run, which is green);
a second LAN machine to enroll an agent from; real Clerk **development** keys
(publishable and secret) from the user, for H6; the user at the keyboard for
every console step. For H9, a backup of a pre-appliance server install (its
`.env` has `COMPOSE_PROJECT_NAME=projectachilles`), taken with
`achilles-installer backup`.

Record the host build, the run id or tag and the zip's version first.

Memory: VM1, VM2 and VM3 (H9) are 8 GB each by default, 24 GB at the peak. H1
checks free memory against that; if the host cannot hold it, import VM2 and VM3
with `-MemoryGB 6` (the minimum), or remove VM2 before H9 (H9 says how).

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
free memory for VM1 (8 GB, or `-MemoryGB 6`), and for the whole run: VM1 + VM2 + VM3 need
24 GB at the default, 18 GB with `-MemoryGB 6` on VM2 and VM3. If the total
does not fit, use `-MemoryGB 6` on VM2/VM3 and record it. Write down which adapter carries
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

### H3 - Import with a NEW switch, not started (host)

Precondition: no External switch exists for the chosen adapter and no VM named
`ProjectAchilles` (otherwise remove them first or pick H4's reuse path).
The import uses `-NoStart` so the controller's SSH is not blocked by the
script's IP wait (up to 300 s); H3b starts it.

```powershell
cd C:\ach
powershell -NoProfile -ExecutionPolicy Bypass -File .\Import-Achilles.ps1 `
  -ImagePath .\ProjectAchilles-<ver>-hyperv.zip -ChecksumFile .\appliance-SHA256SUMS `
  -NetAdapterName '<Ethernet adapter name from H1>' -ConfirmNetworkInterruption -NoStart
echo "exit=$LASTEXITCODE"
```

`-NetAdapterName` with `-ConfirmNetworkInterruption` skips the only prompt
(typing the adapter name); no other input is needed. Never over RDP on the
adapter being bridged: if the session arrives over that adapter, run from the
console without `-ConfirmNetworkInterruption` and type the adapter name.

Expected: `[OK]` lines for the checks, the checksum match, the disk copy, the
new switch `ProjectAchilles External`, the VM, "ready; not started (-NoStart)"
and the commands to start it; `exit=0`. Then verify what the script set
(Secure Boot template and VHDX import, spec 16):

```powershell
$vm = Get-VM -Name ProjectAchilles
$vm | Format-List Name, Generation, State, ProcessorCount, MemoryStartup, AutomaticStartAction, AutomaticStartDelay, AutomaticStopAction, CheckpointType, Notes
Get-VMFirmware $vm | Format-List SecureBoot, SecureBootTemplate
Get-VMNetworkAdapter $vm | Format-List SwitchName, Status
Get-VMIntegrationService $vm | Where-Object Enabled | Select-Object -ExpandProperty Name
(Get-VMSwitch 'ProjectAchilles External').AllowManagementOS
```

Expected: State `Off`, Generation 2, static 8 GB, 4 vCPU, `SecureBoot On`,
`MicrosoftUEFICertificateAuthority`, Production checkpoints, auto-start with a
30 s delay, shutdown on stop, Notes `ProjectAchilles appliance <ver>, imported
<date>`, Guest Service Interface and Time Synchronization enabled, the switch
reports `AllowManagementOS True`. On the lab host also confirm the host still
has its Ethernet address afterwards (`Get-NetIPAddress`) and that SSH still
answers.

### H3b - Start the VM; the user opens the console (host + console)

Tell the user first, then run on the host:

```powershell
Start-VM -Name 'ProjectAchilles'
```

The user opens the console at once (`vmconnect localhost 'ProjectAchilles'` or
Hyper-V Manager -> Connect) and begins C1. Optionally poll for the address as
its own host step (first boot has no address until the network step is done,
so an empty result before C1 step 3 is normal):

```powershell
(Get-VMNetworkAdapter -VMName 'ProjectAchilles').IPAddresses | Where-Object { $_ -match '^\d+\.\d+\.\d+\.\d+$' -and $_ -notlike '169.254.*' }
```

Expected: the VM goes to `Running` and shows the first-boot form. If it shows a
Secure Boot violation instead, that is a Fail (template/VHDX): record the
console text.

### C1 - First boot on the real console (console)

The user opens the console (`vmconnect localhost 'ProjectAchilles'`, or Hyper-V
Manager -> Connect) and walks the real FormUI (CI only exercises the test UI):

1. **Keyboard**: pick **Latin American**. Type a few symbols in the password
   step to confirm the layout (`@`, `-`, `_`, `/`).
2. **Password**: set one (a throwaway for the lab). The user hands it to the
   controller in chat now (see "Ownership of credentials"); the controller
   exports it as `SSHPASS`.
3. **Network**, wrong static IP first: choose static and enter an address that
   does not exist on the LAN (for example a different subnet). Expect the
   60 s confirm-or-revert screen. Do **not** confirm: wait it out. Expected:
   the settings revert and the wizard offers the choice again. Then choose
   **DHCP**. Expected: an address within about 5 s (slow DHCP servers show a
   "no address" notice and let you choose DHCP again; record if seen).
4. **Identity** (hostname/admin name): accept or set. **SSH on.**
5. **Handoff screen**: shows `ssh achilles@<ip>` and the SHA256 host key
   fingerprint. Write both down (photo or typed) and give the controller the
   IP and the `SHA256:...` string: H5 compares against it.
6. Reboot the VM (from the handoff or `Restart-VM` on the host). Expected:
   the tty1 banner and a login prompt appear (the first-boot unit is disabled;
   no second first boot). Reboot a second time and see the same.

After the second reboot, the controller checks (see H5 for the SSH form):

```bash
systemctl is-enabled achilles-firstboot; systemctl is-active achilles-firstboot
```

Expected: `disabled` (or not found) and `inactive`. Otherwise as written; no second
first-boot run after reboot.

Repeat C1 for VM2 (H4) and VM3 (H9) with their own rows in the results table.

### H5 - SSH to the VM, compare the fingerprint first (vm, controller)

The controller holds the `SHA256:...` string the user recorded from the
console's handoff screen (C1). Compare **before** trusting the host key, with
no login:

```bash
ssh-keyscan -t ed25519 "$VM_IP" 2>/dev/null | ssh-keygen -lf -
```

Expected: the printed `SHA256:...` equals the fingerprint from the console
(record "match" or the two values in the results). If it differs, stop: do not
connect. Only after it matches, connect non-interactively and accept the key:

```bash
vmssh true     # uses -o StrictHostKeyChecking=accept-new; exits 0
```

On the VM, check the image invariants (spec 15):

```bash
vmsudo stat -c '%a %n' /etc/netplan/*
vmssh 'ls /etc/systemd/system/getty.target.wants/ 2>/dev/null | grep -c getty@tty1 || true'
vmssh stat -c '%a %n' /opt/projectachilles
vmsudo 'sh -c "ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub"'
vmssh cat /etc/machine-id
vmsudo git -C /opt/projectachilles tag --points-at HEAD
vmsudo git -C /opt/projectachilles rev-parse HEAD
```

(`/opt/projectachilles` is `root:root` 0755, so `git` needs `sudo`, otherwise
it refuses with "dubious ownership".) Expected: `50-achilles.yaml` is `600`
and there is no `50-cloud-init.yaml`; the getty count is `0`;
`/opt/projectachilles` is `755`; the key fingerprint matches C1; for a release
zip, `tag --points-at HEAD` contains the zip's version tag; for a main-branch
CI build, `rev-parse HEAD` starts with the `-g<sha>` in the image version.
Write down the machine-id and the fingerprint (compared with VM2 in H4).

### H6 - Install, unattended (vm, controller)

The controller writes the install config on the VM, from the example, with the
user's real Clerk **development** keys (from chat; never committed; deleted
after). Start from `/opt/projectachilles/deploy.config.env.example` and set at
least:

```
ACHILLES_DOMAIN=achilles.lab.test
TLS_MODE=achilles-ca
CADDY_BIND_IP=<vm ip>
CA_ZONE=lab.test
HOSTS_ENTRY=true
ES_MODE=self
CLERK_PUBLISHABLE_KEY=<pk_test_ from the user>
CLERK_SECRET_KEY=<sk_test_ from the user>
ADMIN_EMAIL=<user's email>
```

(Adjust names to the lab; the rest keeps the example's defaults.) Then:

```bash
vmssh 'umask 077; cat > /home/achilles/install.env' <<<"$CONFIG_TEXT"   # CONFIG_TEXT built in the controller's shell only
vmsudo /opt/projectachilles/achilles-installer install --repo /opt/projectachilles --config /home/achilles/install.env --yes 2>&1 | tee install.log
```

Expected: completes with no image build ("Using the pre-built images for
<commit>"); if it prints "Rebuilding the backend and frontend images:
<reason>", that is a finding, record the reason (spec 15). Delete the log if
it holds anything sensitive (it should not). Then:

```bash
vmsudo /opt/projectachilles/achilles-installer status
vmssh 'curl -sk https://<vm-ip>/api/health'
vmssh 'rm -f /home/achilles/install.env'      # holds the Clerk keys
```

Expected: all services healthy, `status` clean, health `ok`. The UI opens at
`https://<vm-ip>/` from a LAN browser after trusting the exported CA, and the
Clerk sign-in works (the user checks this).

### C2 - Optional: run the wizard interactively (console)

Instead of H6's unattended install, or as an extra check on a spare VM, the
user logs in on the console (or `ssh achilles@<ip>` from a terminal), picks
**install** in the menu, and answers `TLS_MODE=achilles-ca`, `ES_MODE=self`,
the VM's LAN address, and the Clerk development keys. Expected: the same result
as H6. Optional; not required for a pass.

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
  -Name ProjectAchilles2 -SwitchName 'ProjectAchilles External' -Yes -NoStart -MemoryGB <8, or 6 if H1 said so>
echo "exit=$LASTEXITCODE"
```

`-Yes` here only answers the reuse confirmation; with `-SwitchName` there are no
prompts, so it needs no input (and `-ConfirmNetworkInterruption` is not needed
because nothing is created). Start it with `Start-VM -Name 'ProjectAchilles2'`
once the user is at the console.

Expected: exit 0; the line "The VM will connect to the External switch
'ProjectAchilles External' ..." (no new switch created, no network
interruption); VM `ProjectAchilles2` created with its own disk
`ProjectAchilles2.vhdx`; the first VM is untouched. Then repeat C1 on
`ProjectAchilles2` (and H5's fingerprint comparison for its address) (a different static/DHCP address; use a different hostname).
Expected: a different host key fingerprint and machine-id from VM1 (H5 values)
-- a repeat would mean the image was not sealed (spec 15).

### H8 - Backup on VM1, restore on VM2 with a different IP (vm, controller)

On VM1 (the controller; `$VM1_IP`):

```bash
vmsudo /opt/projectachilles/achilles-installer backup
vmsudo 'ls -l /var/backups/projectachilles/'        # root-owned, mode 0600
F=$(vmsudo 'ls -t /var/backups/projectachilles/ | head -1')
vmsudo "cp /var/backups/projectachilles/$F /home/achilles/ && chown achilles: /home/achilles/$F"
```

Verify the mode with `sudo ls -l` (expect `-rw-------`). The backup holds every
secret: copy it VM1 -> controller -> VM2 with `scp` (not a share), keep it only
in the controller's scratch directory and delete it afterwards:

```bash
sshpass -e scp achilles@$VM1_IP:/home/achilles/$F ./ && sshpass -e scp ./$F achilles@$VM2_IP:/home/achilles/
```

VM2 has **never run install** (spec 15: restore on a never-installed VM) and has
a **different IP** from VM1's. On VM2, after H5's fingerprint comparison for VM2:

```bash
vmsudo /opt/projectachilles/achilles-installer restore /home/achilles/$F --yes
```

(Without `--yes` it asks to type the host name.) Expected: the data restores,
then the restore stops with: `The backup's server address <VM1 ip> is not on
this server. Run `sudo /opt/projectachilles/achilles-installer install` and
choose Reconfigure to set this server's address (your data and CA are kept).`
and a non-zero exit ("the data is restored, but the stack was not started").
Then set VM2's address non-interactively: edit the restored config and
re-run the engine:

```bash
vmsudo sed -i 's/^CADDY_BIND_IP=.*/CADDY_BIND_IP=<VM2 ip>/' /opt/projectachilles/deploy.config.env
vmsudo /opt/projectachilles/achilles-installer install --repo /opt/projectachilles --config /opt/projectachilles/deploy.config.env --yes
```

(Equivalent to choosing Reconfigure in the TUI; the user can instead do that on
the console as C2.) Expected: the stack starts; the data (agents, settings) and
the same CA are present on VM2 (`status` shows the CA expiry equal to VM1's);
the UI at VM2's address works after trusting the (same) CA. This is the
new-IP restore guard end to end (QEMU gave both CI VMs the same address, so only
this step proves it). Delete the backup copies (`rm`) on the VMs and the
controller when done.

### H9 - Restore a legacy-project backup onto a fresh import (vm, controller)

Needs a third VM (import `-Name ProjectAchilles3 -SwitchName 'ProjectAchilles External' -Yes -NoStart -MemoryGB 6`,
start it, C1, then **do not install**). If the host lacks the memory, remove VM2
first (`Stop-VM -Name ProjectAchilles2 -TurnOff -Force; Remove-VM -Name ProjectAchilles2 -Force`
and delete its `.vhdx`) once H8 is recorded. The legacy backup (its `.env` has
`COMPOSE_PROJECT_NAME=projectachilles`) comes from the user; copy it to VM3
with the same `scp` route as H8. Then:

```bash
vmsudo /opt/projectachilles/achilles-installer restore /home/achilles/<legacy>.tar.gz --yes 2>&1 | tee restore.log
```

A legacy backup from another server normally trips the new-IP guard **first**
(same stop message as H8), so the retag lines are **not** in this output. Then
run the Reconfigure form from H8 (edit `CADDY_BIND_IP`, run
`install --config /opt/projectachilles/deploy.config.env --yes 2>&1 | tee install.log`).
Look in **install.log** (the Reconfigure run), in this order:

1. "Tagging the appliance's pre-built achilles-server-* images as projectachilles-*
   (built from <commit>)", then
2. "Using the pre-built images for <commit>".

Expected: both lines appear, in that order; no image build and no download.
Unverified until run: the project name stays `projectachilles` after
Reconfigure:

```bash
vmsudo grep COMPOSE_PROJECT_NAME /opt/projectachilles/.env      # expect projectachilles
vmsudo 'docker ps --format {{.Names}}'                           # names start with projectachilles-
```

If the backup's address happens to be local to VM3, the retag lines appear in
`restore.log` instead; record where they were. This is the retag path,
previously engine-tested only.

### H10 - Upgrade to the next tag (vm, controller)

Only if a newer `v*.*.*` tag than the image's exists; otherwise record N/A.
On VM1:

```bash
vmsudo /opt/projectachilles/achilles-installer upgrade --ref <tag> --yes
vmssh 'ls -l /opt/projectachilles/achilles-installer'
vmsudo git -C /opt/projectachilles tag --points-at HEAD
vmsudo /opt/projectachilles/achilles-installer status
```

Expected: shows `Upgrade: <from> -> <to>`, completes (the VM needs internet; it
pulls/builds the new images) and `status` is clean; the checkout is at the new
tag and `/opt/projectachilles/achilles-installer` was replaced (its
modification time is new; the units call that path, spec 15). If it fails, the
rollback steps it prints are the result to record.

### H11 - Third import of the same zip is refused (host)

```powershell
cd C:\ach
powershell -NoProfile -ExecutionPolicy Bypass -File .\Import-Achilles.ps1 `
  -ImagePath .\ProjectAchilles-<ver>-hyperv.zip -ChecksumFile .\appliance-SHA256SUMS `
  -SwitchName 'ProjectAchilles External' -Yes
echo "exit=$LASTEXITCODE"
```

(No `-Name`, so it is `ProjectAchilles` again.) The script asks nothing here; it refuses before any prompt. Expected: `[FAIL]` saying a VM
named `ProjectAchilles` **already exists**; `exit=1`; no new VM or disk, nothing
changed.

## Order and cleanup

Run H1, H2, H3, H3b, C1, H5, H6, H7 (VM1 done), then H4 (+ C1 on VM2), H8, H9, H10,
H11. H10 last on VM1 so earlier steps test the unmodified image. Cleanup after
the run (host), only for what this run created:

```powershell
foreach ($n in 'ProjectAchilles2','ProjectAchilles3') {
  if (Get-VM -Name $n -ErrorAction SilentlyContinue) { Stop-VM -Name $n -TurnOff -Force; Remove-VM -Name $n -Force }
  Remove-Item -LiteralPath (Join-Path (Get-VMHost).VirtualHardDiskPath "$n.vhdx") -ErrorAction SilentlyContinue
}
Remove-Item C:\ach -Recurse
# The External switch and VM1 stay unless the user says otherwise.
```

VM2 and VM3 and their `.vhdx` files go (the loop above); VM1 stays unless the
user says otherwise. Also delete the copies of the backups and `install.env`.

## Coverage

| Spec item | Step |
|-----------|------|
| 10.2 Import with a new switch | H3 |
| 10.2 Import with an existing switch | H4 |
| 10.2 First boot, then SSH | C1, H5 |
| 10.2 Interactive wizard (optional) | C2 |
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
|  |  |  | H3 / H3b |  |  |
|  |  |  | C1 (VM1) |  |  |
|  |  |  | H5 |  |  |
|  |  |  | H6 |  |  |
|  |  |  | C2 (optional) |  |  |
|  |  |  | H7 |  |  |
|  |  |  | H4 |  |  |
|  |  |  | C1 (VM2) |  |  |
|  |  |  | H8 |  |  |
|  |  |  | C1 (VM3) |  |  |
|  |  |  | H9 |  |  |
|  |  |  | H10 |  |  |
|  |  |  | H11 |  |  |
