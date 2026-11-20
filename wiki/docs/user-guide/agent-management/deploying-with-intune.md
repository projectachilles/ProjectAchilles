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
   [endpoint prerequisites](../../deployment/endpoint-prerequisites) first: the
   signing certificate on the endpoints and the Defender ASR per-rule exclusion
   for `C:\F0`. The script checks the agent's signature, so an endpoint that
   doesn't trust the certificate yet will not install.
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
4. If the registered agent is signed, it checks that the downloaded file has a
   valid signature from the same signer. If not, it deletes the file and stops.
5. It enrolls the endpoint and installs the service.

It ends with exit code `0` when the agent is installed (or already was) and `1`
on any failure. From step 3 on it writes what it did to
`C:\F0\achilles-install.log`. The token is never written to the log.

## Intune

:::warning[Not yet validated on a tenant]
The script has been checked for syntax and behaviour outside Intune. The steps
below follow Microsoft's documentation but have not been run end to end on an
Intune tenant yet. Try them on one test device before a wider rollout.
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
   | Detection rule | **File**: path `C:\F0`, file `achilles-agent.exe`, **File or folder exists** |

   The `Sysnative` path makes Intune use 64-bit PowerShell; a plain
   `powershell.exe` there starts the 32-bit one.

Microsoft's guide:
[Add, assign, and monitor a Win32 app](https://learn.microsoft.com/intune/app-management/deployment/add-win32).

## Other tools

The script is not specific to Intune. Run it as SYSTEM with:

```
powershell.exe -NoProfile -ExecutionPolicy Bypass -File Install-AchillesAgent.ps1
```

- **Group Policy**: a computer **Startup** script
  (Computer Configuration → Policies → Windows Settings → Scripts). It runs at
  every start; from the second time on the script ends at once.
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
| "The downloaded agent is not signed by ..." | The endpoint doesn't trust the signing certificate yet, or the agent on the server was replaced by one signed with another certificate. Distribute the certificate ([prerequisites, step 2](../../deployment/endpoint-prerequisites#2-distribute-the-certificate)); after changing the certificate, download a new script. |
| "C:\F0 exists but is not a plain folder owned by SYSTEM or Administrators" | Someone created `C:\F0` before the install. Check what is in it, remove it, and let the script run again. |
| "The agent installer exited with code ..." | Often the token: expired, revoked or out of uses. Check it in **Enroll agent → Active Tokens**. |
| Nothing in the log, and no `C:\F0` | The script failed before step 3, or never ran. Check the device's script status in Intune and the management extension logs. |

## Removing the agent

Use **Uninstall** on the agent in the console
([remote uninstall](./remote-uninstall)), or run
`C:\F0\achilles-agent.exe --uninstall` on the endpoint. With route B, the Win32
app's uninstall action runs that command. With route A, remove the script's
assignment as well, or a device that is reset will install the agent again
while the token is still valid.
