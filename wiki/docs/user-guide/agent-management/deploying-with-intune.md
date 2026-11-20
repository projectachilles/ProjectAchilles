---
sidebar_position: 3
title: "Deploying with Intune"
description: "Install the ProjectAchilles agent on many Windows endpoints with Microsoft Intune or another management tool, using a script from the Enroll agent dialog."
---

# Deploying with Intune or another management tool

To enroll many Windows endpoints, let your management tool run the install
instead of pasting a command on each one. The **Enroll agent** dialog gives you a
script for that: `Install-AchillesAgent.ps1`.

The script installs the same agent as the Windows install command. Nothing is
built per enrollment, so the agent your fleet runs is the one registered in
**Settings → Agent**, and it keeps updating itself as usual.

This page covers Windows. On Linux and macOS the install command is already a
shell script that Jamf, Ansible or a similar tool can run as it is.

## Before you start

1. **Prepare the endpoints.** Do the
   [endpoint prerequisites](../../deployment/endpoint-prerequisites) first, in
   particular the Defender ASR per-rule exclusion for `C:\F0`. The script
   itself does not need the signing certificate on the endpoints (see
   [the signature check](#the-signature-check)), but your application control
   or EDR may.
2. **Register a Windows agent** in **Settings → Agent**. Without one the dialog
   offers no script.
3. **Create a token for the whole rollout.** In **Agents → Enroll agent**, set
   **Max Uses** to at least the number of endpoints and **TTL** long enough for
   all of them to check in. Endpoints that are switched off pick the script up
   days later; the maximum is 720 hours (30 days) and 1,000 uses.
4. Open the **Management tool** tab and select **Download
   Install-AchillesAgent.ps1**.

:::warning[The script contains the token]
Anyone who can read the script can enroll an agent with it until the token
expires or runs out of uses. Keep the file out of shared folders and tickets,
give the token no more uses and time than the rollout needs, and revoke it in
**Enroll agent → Active Tokens** when the rollout is done. Revoking a token
does not affect agents that are already enrolled.

The token can also be read in other places while it is valid:

- **Where the tool stores the script.** In Intune, anyone who can read the
  script policy. A Group Policy script lives in SYSVOL, which every domain
  user can read ([Other tools](#other-tools)).
- **PowerShell script block logging** (event 4104), where it is turned on,
  records the whole script.
- **The agent's command line.** The script passes the token to the agent as
  `--enroll <token>`, so process-creation logging and EDR telemetry on the
  endpoint show it. The paste-in install command has the same property.

The script keeps the token out of its own log, `C:\F0\achilles-install.log`.
:::

## What the script does

It runs unattended and needs SYSTEM or an administrator.

1. If the agent is already installed (the `AchillesAgent` service,
   `C:\F0\achilles-agent.exe` and `C:\F0\achilles-agent.yaml` all exist), it
   starts the service if it is stopped and ends. It does not download, enroll
   or spend a token use.
2. It checks `C:\F0`: an existing folder must be a plain folder owned by SYSTEM
   or Administrators. It then locks the folder to those two.
3. It downloads the agent from your ProjectAchilles server into `C:\F0`.
4. If the registered agent is signed, it checks the downloaded file's
   signature. If the check fails, it deletes the file and stops.
5. It enrolls the endpoint and installs the service.

It ends with exit code `0` when the agent is installed (or already was) and `1`
on any failure. From step 3 on it writes what it did, and what the agent
printed, to `C:\F0\achilles-install.log`, with the token masked.

### The signature check

The script carries the SHA-256 fingerprint of the certificate your server
signed the registered Windows agent with. On the endpoint it accepts the
download only when both are true:

- the file's signature is intact (Windows reports a changed file as
  `HashMismatch` and an unsigned one as `NotSigned`, whatever the endpoint
  trusts);
- the signature was made with exactly that certificate.

A certificate with the same name but another key does not pass. The endpoint
does not have to trust the certificate for this check, so the script also works
with a self-signed certificate that Windows reports as `UnknownError`.

The script is tied to that certificate. After you change the signing
certificate and rebuild the agent, download a new script.

The dialog tells you when there is no check: the registered agent is not
signed, or the server could not read its certificate. The script then runs
whatever the server returns, like the paste-in command does.

What the check does not do:

- **It does not tell the agent from another binary signed with the same
  certificate.** The agent and every test binary share the active signing
  certificate. Someone able to change the download in transit could serve a
  test binary built on your server, or an older agent, and it would pass.
  Use an HTTPS server address, so the download can't be changed on the way;
  the dialog warns when the address is plain HTTP.
- **It does not protect against a compromised server.** The server holds the
  signing certificate and supplies the fingerprint.
- **On plain HTTP the token is readable in transit**, whatever the check does.

### What has been verified

On Windows 11 with Windows PowerShell 5.1, run as SYSTEM through a scheduled
task, against a server with a signed agent whose certificate was **not** trusted
on the endpoint:

| Case | Result |
|------|--------|
| Fresh computer | Installed; `C:\F0` locked to SYSTEM and Administrators; service running; agent seen by the server |
| Second run on the installed agent | "Agent already installed; nothing to do.", exit 0, no token use spent |
| Service registered but files missing | Installed |
| Script pinned to a different certificate | Exit 1, download deleted, no token use spent |

Not verified: a run as a standard (non-administrator) user, and anything inside
Intune itself.

## Intune

:::warning[Not yet validated on a tenant]
The script has been run as SYSTEM outside Intune (see
[What has been verified](#what-has-been-verified)). The steps below follow
Microsoft's documentation but have not been run end to end on an Intune tenant
yet. Try them on one test device before a wider rollout.
:::

Use route A unless you need Intune to report the install per device or to
uninstall the agent later.

### Route A: platform script

The simplest route: Intune runs the script once on each device.

1. In the [Microsoft Intune admin center](https://intune.microsoft.com), go to
   **Devices → Scripts and remediations → Platform scripts → Add → Windows 10
   and later**.
2. Upload `Install-AchillesAgent.ps1` and set:

   | Setting | Value |
   |---------|-------|
   | Run this script using the logged on credentials | **No** |
   | Enforce script signature check | **No** |
   | Run script in 64-bit PowerShell host | **Yes** |

3. Assign it to the device group that holds your test endpoints.

What to expect:

- The first setting defaults to **Yes**. With **Yes** the script runs as the
  signed-in user and stops with a message naming this setting.
- Intune runs the script once per device, and three more times if it fails.
- A script assigned to devices runs again for each new user who signs in. That
  is harmless here: the script finds the agent installed and ends.
- Devices must be Microsoft Entra joined or hybrid joined. Devices that are only
  registered don't receive scripts.

Microsoft's guide:
[Use PowerShell scripts on Windows devices in Intune](https://learn.microsoft.com/intune/device-management/tools/run-powershell-scripts-windows).

### Route B: Win32 app

More setup, in exchange for an install status per device, a detection rule and
an uninstall action.

1. Put `Install-AchillesAgent.ps1` alone in a folder and package the folder
   with the
   [Microsoft Win32 Content Prep Tool](https://learn.microsoft.com/intune/app-management/deployment/create-win32-package).
   Do not add the agent binary to the package: the script downloads it into
   `C:\F0`, where the ASR exclusion applies. Intune runs package content from
   another folder.
2. Add the `.intunewin` file as a **Windows app (Win32)** and set:

   | Setting | Value |
   |---------|-------|
   | Install command | `%SystemRoot%\Sysnative\WindowsPowerShell\v1.0\powershell.exe -ExecutionPolicy Bypass -File Install-AchillesAgent.ps1` |
   | Uninstall command | `C:\F0\achilles-agent.exe --uninstall` |
   | Install behavior | **System** |
   | Detection rule | **Registry**: key path `HKEY_LOCAL_MACHINE\SYSTEM\CurrentControlSet\Services\AchillesAgent`, **Key exists** |

   The `Sysnative` path makes Intune use 64-bit PowerShell; a plain
   `powershell.exe` there starts the 32-bit one.

   Detect the service's registry key, not the agent file: the uninstall
   command removes the service but cannot delete its own running program, so
   `C:\F0\achilles-agent.exe` stays behind after an uninstall.

Microsoft's guide:
[Add, assign, and monitor a Win32 app](https://learn.microsoft.com/intune/app-management/deployment/add-win32).

## Other tools

The script is not specific to Intune. Run it as SYSTEM with:

```
powershell.exe -NoProfile -ExecutionPolicy Bypass -File Install-AchillesAgent.ps1
```

- **Group Policy**: a computer **Startup** script
  (Computer Configuration → Policies → Windows Settings → Scripts). It runs at
  every start; from the second time on the script ends at once. Startup
  scripts are stored in SYSVOL, where every domain user can read them, and so
  the token. Restrict the script file's permissions to **Domain Computers**
  (and administrators), use a token with a short TTL, and revoke it as soon as
  the endpoints have enrolled.
- **Configuration Manager**: a script or a package that runs the line above as
  the system account.

## Troubleshooting

Start with `C:\F0\achilles-install.log` on the endpoint, then the Intune
management extension logs in
`C:\ProgramData\Microsoft\IntuneManagementExtension\Logs`.

| What you see | Cause and fix |
|--------------|---------------|
| "This script must run as SYSTEM or an administrator" | Route A: set **Run this script using the logged on credentials** to **No**. Route B: set **Install behavior** to **System**. |
| "Could not download the agent from ..." | The endpoint can't reach your server as the SYSTEM account. SYSTEM does not use a signed-in user's proxy settings; allow the server's address directly or set a machine-wide proxy. |
| "The downloaded agent does not carry the expected signing certificate ..." | The agent on the server is now signed with another certificate than when the script was made, or the download was changed on the way. The message shows the signature status and the certificate it found. After changing the signing certificate, download a new script. |
| "C:\F0 exists but is not a plain folder owned by SYSTEM or Administrators" | Someone created `C:\F0` before the install. Check what is in it, remove it, and let the script run again. |
| "The agent installer exited with code ..." | The lines starting with `agent:` just above it in the log are the agent's own message. Often the token: expired, revoked or out of uses. Check it in **Enroll agent → Active Tokens**. |
| Nothing in the log, and no `C:\F0` | The script failed before step 3, or never ran. Check the device's script status in Intune and the management extension logs. |

## Removing the agent

Use **Uninstall** on the agent in the console
([remote uninstall](./remote-uninstall)), or run
`C:\F0\achilles-agent.exe --uninstall` on the endpoint. With route B, the Win32
app's uninstall action runs that command. Run on the endpoint, the command
removes the service but leaves `C:\F0\achilles-agent.exe` behind; delete the
`C:\F0` folder afterwards if you want nothing left. With route A, remove the script's
assignment as well, or a device that is reset will install the agent again
while the token is still valid.
