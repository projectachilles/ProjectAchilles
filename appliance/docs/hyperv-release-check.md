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
and hands it to the controller at that moment; use the **same password on
every VM** of the run (one `SSHPASS` serves VM1-VM3), or re-export it per VM.
The controller keeps it only in its shell environment and uses it through
`sshpass -e` (the `SSHPASS` variable) and `sudo -S` fed from the same
variable. A person at a terminal reads it without echo, so it stays out of the
shell history; an automated controller gets it in its chat, which is then in
that transcript: lab throwaways only, and change them (and rotate the Clerk
development secret key) after the run.

```bash
read -rs SSHPASS && export SSHPASS                  # never written to a file
KNOWN="$PWD/known_hosts.release-check"              # host keys checked in H5 only
# Both take the VM's address, then ONE remote command as ONE quoted string.
vmssh()  { sshpass -e ssh -o UserKnownHostsFile="$KNOWN" -o StrictHostKeyChecking=yes achilles@"$1" "$2"; }
vmsudo() { sshpass -e ssh -o UserKnownHostsFile="$KNOWN" -o StrictHostKeyChecking=yes achilles@"$1" "sudo -S -p '' sh -c $(printf %q "$2")" <<<"$SSHPASS"; }
```

Both refuse a VM whose key H5 hasn't checked and added to `$KNOWN`.

Convention: the address is the first argument (`vmssh "$VM1_IP" '...'`), the
remote command is **one** single-quoted string (so `stat -c "%a %n" /x` reaches
the remote intact), and `vmsudo` runs that whole string under `sudo sh -c`, so
`&&`, pipes and redirections are privileged too. Use double quotes only to
expand a controller-side variable (`"cp .../$F ..."`). `vmsudo` feeds the
password to `sudo -S` on **stdin**, so it cannot be combined with a remote
command that reads stdin (`cat`, `tee` without a file, an interactive prompt);
for those, put the data in place with `vmssh` first (into /home/achilles) and
then `vmsudo` a `cp` or `mv`. Set `VM1_IP`, `VM2_IP`, `VM3_IP` as each VM gets its address; `VM_IP` in the C1, H5
and H6 snippets means the VM under test (export it before each VM's steps).

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
logged in for SSH to answer: set its sleep to **Never** on AC power before
starting, or it sleeps mid-run and freezes the VMs. Windows drops ping by
default, so test the host with SSH, not ping.

- Take a script's exit code from `ssh`'s own exit status, or `$LASTEXITCODE`
  inside PowerShell. Not `& echo %ERRORLEVEL%` in the remote `cmd`: `cmd`
  expands it when it reads the line, before the script runs.
- `vmconnect` needs the host's desktop session (the user at the host, or RDP):
  run from SSH it opens nowhere. For the controller to see the console, save
  the VM's screen with WMI
  (`Msvm_VirtualSystemManagementService.GetVirtualSystemThumbnailImage`,
  RGB565 pixels) and convert it locally.

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
- After H3 the host's Ethernet address moves to `vEthernet (ProjectAchilles
  External)`, and the Wi-Fi address may stop answering. SSH to `.45` then,
  keeping the host key: `ssh -o HostKeyAlias=192.168.4.44 mesa@192.168.4.45`.

## Steps

### H1 - Host prerequisites (host)

```powershell
$os = Get-CimInstance Win32_OperatingSystem
"$($os.Caption) build $($os.BuildNumber) $($os.OSArchitecture)"
$PSVersionTable.PSVersion.ToString()
(New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
(Get-WindowsOptionalFeature -Online -FeatureName Microsoft-Hyper-V).State
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

1. **Keyboard**: pick **Latin American**. Check the layout in the network
   step's **Hostname** field, which shows what you type: type `@ - _ /`, look,
   then delete them (the password fields show only `*`).
2. **Password**: set one (a throwaway for the lab), **at least 12 characters
   in the first field**: the length error only shows on "Repeat", and there is
   no way back to the first field on this console (Shift+Tab does nothing
   there). If it happens, press Ctrl+C: first boot restarts at the keyboard
   step. The user hands the password to the controller in chat now (see
   "Ownership of credentials"); the controller exports it as `SSHPASS`.
3. **Network**, wrong static IP first: choose static and enter an address that
   does not exist on the LAN (for example a different subnet). Expect the
   60 s confirm-or-revert screen. Do **not** confirm: wait it out. Expected:
   the settings revert and the wizard offers the choice again. Then choose
   **DHCP**. Expected: an address within about 5 s (slow DHCP servers show a
   "no address" notice and let you choose DHCP again; record if seen).
4. **Hostname**: set it in the network form (`achilles` for VM1, `achilles2`
   for VM2). SSH is on after first boot; there is no step for it.
5. **Handoff screen**: shows `ssh achilles@<ip>` and the SHA256 host key
   fingerprint. Write both down (photo or typed) and give the controller the
   IP and the `SHA256:...` string: H5 compares against it.
6. Reboot the VM (from the handoff or `Restart-VM` on the host). Expected:
   the tty1 banner and a login prompt appear (the first-boot unit is disabled;
   no second first boot). Reboot a second time and see the same.

After the second reboot, the controller checks (see H5 for the SSH form):

```bash
vmssh "$VM_IP" 'systemctl is-enabled achilles-firstboot; systemctl is-active achilles-firstboot'
```

Expected: `is-enabled` prints `disabled` (or says the unit is not found; either
is a pass) and `is-active` prints `inactive`. Everything else as written, and
no second first-boot run after either reboot.

Repeat C1 for VM2 (H4) and VM3 (H9) with their own rows in the results table.

### H5 - SSH to the VM, compare the fingerprint first (vm, controller)

The controller holds the `SHA256:...` string the user recorded from the
console's handoff screen (C1). Compare **before** trusting the host key, with
no login:

```bash
ssh-keyscan -t ed25519 "$VM_IP" 2>/dev/null > scanned.key
ssh-keygen -lf scanned.key
```

Expected: the printed `SHA256:...` equals the fingerprint from the console
(record "match" or the two values in the results). If it differs, stop: do not
connect. Only after it matches, add **that** key (the one you just checked, not
whatever a later connection offers) and connect:

```bash
cat scanned.key >> "$KNOWN" && rm scanned.key
vmssh "$VM_IP" true     # StrictHostKeyChecking=yes against $KNOWN; exits 0
```

On the VM, check the image invariants (spec 15):

```bash
vmsudo "$VM_IP" 'stat -c "%a %n" /etc/netplan/*'
vmssh "$VM_IP" 'ls /etc/systemd/system/getty.target.wants/ 2>/dev/null | grep -c getty@tty1 || true'
vmssh "$VM_IP" 'stat -c "%a %n" /opt/projectachilles'
vmsudo "$VM_IP" 'ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub'
vmssh "$VM_IP" 'cat /etc/machine-id'
vmsudo "$VM_IP" 'git -C /opt/projectachilles tag --points-at HEAD'
vmsudo "$VM_IP" 'git -C /opt/projectachilles rev-parse HEAD'
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
vmssh "$VM_IP" 'umask 077; cat > /home/achilles/install.env' <<<"$CONFIG_TEXT"   # CONFIG_TEXT built in the controller's shell only
vmsudo "$VM_IP" '/opt/projectachilles/achilles-installer install --repo /opt/projectachilles --config /home/achilles/install.env --yes' 2>&1 | tee install.log
vmssh "$VM_IP" 'rm -f /home/achilles/install.env'      # holds the Clerk keys: remove it even if the install failed
```

Expected: completes with no image build ("Using the pre-built images for
<commit>"); if it prints "Rebuilding the backend and frontend images:
<reason>", that is a finding, record the reason (spec 15). Delete the log if
it holds anything sensitive (it should not). Then:

```bash
vmsudo "$VM_IP" '/opt/projectachilles/achilles-installer status'
vmssh "$VM_IP" "curl -sk --resolve achilles.lab.test:443:$VM_IP https://achilles.lab.test/api/health"
```

Expected: all services healthy, `status` clean, health `ok`. Right after the
install Caddy may still show `!! health starting` for about a minute; run
`status` again. The server certificate names only `ACHILLES_DOMAIN`, so the
UI does **not** open at `https://<vm-ip>/` (TLS internal error): the browser's
machine needs the name (a hosts line `<vm-ip>  achilles.lab.test`, or a DNS
record) and, to avoid the "Not secure" warning, the root CA trusted
(`http://achilles.lab.test/ca/root.cer`, SHA-256 as `status` prints it). Then
`https://achilles.lab.test` opens and the Clerk sign-in works as the admin
(the user checks this).

If the host slept since the VM started, the VM's clock lags and every Clerk
sign-in fails ("Session expired or authentication failed"): compare
`vmssh "$VM_IP" 'date -u'` with the controller and, if it lags, run
`vmsudo "$VM_IP" 'systemctl restart systemd-timesyncd'`.

### C2 - Optional: run the wizard interactively (console)

Instead of H6's unattended install, or as an extra check on a spare VM, the
user logs in on the console (or `ssh achilles@<ip>` from a terminal), picks
**install** in the menu, and answers `TLS_MODE=achilles-ca`, `ES_MODE=self`,
the VM's LAN address, and the Clerk development keys. Expected: the same result
as H6. Optional; not required for a pass.

### H7 - Enroll an agent from another LAN machine and run one test (host / user)

A fresh install has no agent binary (`/api/agent/download` answers 404): the
user first builds one in **Settings -> Agent** (Windows amd64). Then the user
creates an enrollment token in **Agents -> Enroll agent**. The commands that
dialog shows don't trust the appliance's CA: use the bootstrap script the
installer rendered instead. Copy
`/opt/projectachilles/deploy/onprem/bootstrap-windows.ps1` from the VM to the
endpoint, give the endpoint the name (hosts line or DNS, as in H6) and, in an
**elevated** PowerShell on the endpoint:

```powershell
powershell -ExecutionPolicy Bypass -File .\bootstrap-windows.ps1 -Token <enrollment-token>
```

It pins and trusts the root CA, installs the agent in `C:\F0` and starts the
`AchillesAgent` service. Then the user dispatches one read-only test (for
example the Cyber-Hygiene Bundle, Windows Defender Edition) from **Tests**.

Expected: the agent appears online with a heartbeat; the task completes (its
log is `C:\F0\achilles-agent.log`); the result shows in **Analytics -> All
Executions**, a bundle as one group with per-control rows. Record the agent
OS, the test and its exit code. Executions must not be empty while the
backend logs `Fielddata is disabled on [...]`: that is the fresh-index
mapping bug fixed in #605.

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
`ProjectAchilles2` (use a different hostname and address) and H5's fingerprint
comparison for its address.
Expected: a different host key fingerprint and machine-id from VM1 (H5 values)
-- a repeat would mean the image was not sealed (spec 15).

### H8 - Backup on VM1, restore on VM2 with a different IP (vm, controller)

On VM1 (the controller; `$VM1_IP`; in the C1/H5/H6 snippets `$VM_IP` is the VM under test, i.e. `$VM1_IP` for VM1):

```bash
vmsudo "$VM1_IP" '/opt/projectachilles/achilles-installer backup'
vmsudo "$VM1_IP" 'ls -l /var/backups/projectachilles/'        # root-owned, mode 0600
F=$(vmsudo "$VM1_IP" 'ls -t /var/backups/projectachilles/ | head -1')
vmsudo "$VM1_IP" "cp /var/backups/projectachilles/$F /home/achilles/ && chown achilles: /home/achilles/$F"
```

Verify the mode with `sudo ls -l` (expect `-rw-------`). The backup holds every
secret: copy it VM1 -> controller -> VM2 with `scp` (not a share), keep it only
in the controller's scratch directory and delete it afterwards:

```bash
S="-o UserKnownHostsFile=$KNOWN -o StrictHostKeyChecking=yes"
sshpass -e scp $S achilles@$VM1_IP:/home/achilles/$F ./ && chmod 600 ./$F && sshpass -e scp $S ./$F achilles@$VM2_IP:/home/achilles/
sha256sum ./$F && vmssh "$VM2_IP" "sha256sum /home/achilles/$F"    # same hash at every hop
```

VM2 has **never run install** (spec 15: restore on a never-installed VM) and has
a **different IP** from VM1's. On VM2, after H5's fingerprint comparison for VM2:

```bash
vmsudo "$VM2_IP" "/opt/projectachilles/achilles-installer restore /home/achilles/$F --yes"
```

(Without `--yes` it asks to type the host name.) Expected: the data restores,
then the restore stops with: `The backup's server address <VM1 ip> is not on
this server. Run `sudo /opt/projectachilles/achilles-installer install` and
choose Reconfigure to set this server's address (your data and CA are kept).`
and a non-zero exit ("the data is restored, but the stack was not started").
Then set VM2's address non-interactively: edit the restored config and
re-run the engine:

```bash
NEW_IP="$VM2_IP"          # VM2's own address
vmsudo "$VM2_IP" "sed -i 's/^CADDY_BIND_IP=.*/CADDY_BIND_IP=$NEW_IP/' /opt/projectachilles/deploy.config.env"
vmsudo "$VM2_IP" 'grep -E "^(CADDY_BIND_IP|LAN_SUBNETS)=" /opt/projectachilles/deploy.config.env'
vmsudo "$VM2_IP" '/opt/projectachilles/achilles-installer install --repo /opt/projectachilles --config /opt/projectachilles/deploy.config.env --yes'
```

If VM2 is on a different subnet than VM1, also edit `LAN_SUBNETS` the same way
(the firewall allow-list; the `grep` above shows both values).

(Equivalent to choosing Reconfigure in the TUI; the user can instead do that on
the console as C2.) Expected: the stack starts; the data (agents, settings) and
the same CA are present on VM2 (`status` shows the same root SHA-256 as VM1's);
the UI works at the same name once it points at VM2's address. This is the
new-IP restore guard end to end (QEMU gave both CI VMs the same address, so only
this step proves it).

Then move H7's agent: point the endpoint's name at VM2's address. The agent
keeps its open connection to VM1, so it moves only when that connection
drops: shut VM1 down (`Stop-VM -Name 'ProjectAchilles'`, as when retiring an
old server; H11 needs it to exist, not to run). Expected: within a minute,
VM2's backend logs the agent's heartbeats (200) with no re-enrollment.

Delete the backup copies (`shred -u`) on the VMs and the controller when done:
they hold the CA private keys.

### H9 - Restore a legacy-project backup onto a fresh import (vm, controller)

Needs a third VM (import `-Name ProjectAchilles3 -SwitchName 'ProjectAchilles External' -Yes -NoStart -MemoryGB 6`,
start it, C1, then **do not install**). If the host lacks the memory, remove VM2
first (`Stop-VM -Name ProjectAchilles2 -TurnOff -Force; Remove-VM -Name ProjectAchilles2 -Force`
and delete its `.vhdx`) once H8 is recorded. The legacy backup (its `.env` has
`COMPOSE_PROJECT_NAME=projectachilles`) comes from the user; copy it to VM3
with the same `scp` route as H8. Then:

```bash
vmsudo "$VM3_IP" '/opt/projectachilles/achilles-installer restore /home/achilles/<legacy>.tar.gz --yes' 2>&1 | tee restore.log
```

If the VM is on a different subnet than the legacy server, `LAN_SUBNETS` in
the restored `deploy.config.env` must be edited too (as in H8).

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
vmsudo "$VM3_IP" 'grep COMPOSE_PROJECT_NAME /opt/projectachilles/.env'      # expect projectachilles
vmsudo "$VM3_IP" 'docker ps --format {{.Names}}'                           # names start with projectachilles-
```

If the backup's address happens to be local to VM3, the retag lines appear in
`restore.log` instead; record where they were. This is the retag path,
previously engine-tested only.

### H10 - Upgrade to the next tag (vm, controller)

Only if a newer `v*.*.*` tag than the image's exists; otherwise record N/A.
On VM1:

```bash
vmsudo "$VM1_IP" '/opt/projectachilles/achilles-installer upgrade --ref <tag> --yes'
vmssh "$VM1_IP" 'ls -l /opt/projectachilles/achilles-installer'
vmsudo "$VM1_IP" 'git -C /opt/projectachilles tag --points-at HEAD'
vmsudo "$VM1_IP" '/opt/projectachilles/achilles-installer status'
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
| 2026-10-26 | Win 11 Ent es-DO 10.0.26300 | v2.6.1-50-g363c83f0 (#602) | H1 | Pass | Elevated check failed with `IsInRole('Administrator')` on Spanish Windows (fixed above: enum form). |
| 2026-10-26 | Win 11 Ent es-DO 10.0.26300 | v2.6.1-50-g363c83f0 (#602) | H2 | Pass | Zip + SUMS verified on controller and host. |
| 2026-10-26 | Win 11 Ent es-DO 10.0.26300 | v2.6.1-50-g363c83f0 (#602) | H3 / H3b | Fail | Import Pass; first-boot form drawn to the journal, tty1 blank (huh draws on stderr). Fixed in #604. |
| 2026-10-27 | Win 11 Ent es-DO 10.0.26300 | v2.6.1-73-gf8953030 (#604) | H3 / H3b | Pass | Redo with the #604 image; form on tty1 (under the boot log: finding). |
| 2026-10-27 | Win 11 Ent es-DO 10.0.26300 | v2.6.1-73-gf8953030 (#604) | C1 (VM1) | Pass | es-latam; wrong static IP reverted after 60 s; DHCP; two reboots clean. Findings: password length shown only on Repeat, no way back; boot log and stale frames on tty1; Ubuntu MOTD offers do-release-upgrade. |
| 2026-10-27 | Win 11 Ent es-DO 10.0.26300 | v2.6.1-73-gf8953030 (#604) | H5 | Pass | Fingerprint = handoff; unchanged after both reboots. |
| 2026-10-27 | Win 11 Ent es-DO 10.0.26300 | v2.6.1-73-gf8953030 (#604) | H6 | Pass | 34 s, pre-built images, status clean once Caddy is healthy; Clerk sign-in as admin via hosts line. VM clock lagged ~5 min after the host slept, Clerk failed until timesyncd restart (finding). |
| 2026-10-27 | Win 11 Ent es-DO 10.0.26300 | v2.6.1-73-gf8953030 (#604) | C2 (optional) | N/A |  |
| 2026-10-27 | Win 11 Ent es-DO 10.0.26300 | v2.6.1-73-gf8953030 (#604) | H7 | Pass | Agent 0.7.0 on the Spanish Win 11 host via bootstrap script; Cyber-Hygiene bundle exit 101, 48 controls. Analytics empty until the index fix (#605); agent icacls warnings on Spanish Windows (agent fix). |
| 2026-10-27 | Win 11 Ent es-DO 10.0.26300 | v2.6.1-73-gf8953030 (#604) | H4 | Pass | Switch reused; VM2 host key and machine-id differ from VM1. |
| 2026-10-27 | Win 11 Ent es-DO 10.0.26300 | v2.6.1-73-gf8953030 (#604) | C1 (VM2) | Pass | DHCP, hostname achilles2. |
| 2026-10-27 | Win 11 Ent es-DO 10.0.26300 | v2.6.1-73-gf8953030 (#604) | H8 | Pass | New-IP guard stopped the restore; Reconfigure kept data + same CA; agent moved to VM2 after VM1 shut down. |
| 2026-10-27 | Win 11 Ent es-DO 10.0.26300 | v2.6.1-73-gf8953030 (#604) | C1 (VM3) | N/A | No H9. |
| 2026-10-27 | Win 11 Ent es-DO 10.0.26300 | v2.6.1-73-gf8953030 (#604) | H9 | N/A | No pre-appliance backup available; retag path engine-tested only. |
| 2026-10-27 | Win 11 Ent es-DO 10.0.26300 | v2.6.1-73-gf8953030 (#604) | H10 | N/A | No tag newer than the image. |
| 2026-10-27 | Win 11 Ent es-DO 10.0.26300 | v2.6.1-73-gf8953030 (#604) | H11 | Pass | Refused, exit 1, nothing changed. |
