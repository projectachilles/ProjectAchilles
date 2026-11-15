---
sidebar_position: 3
title: "About and Update Check"
description: "The About dialog: which release this install runs, its release notes, the official agent version, and how the daily check for newer releases works."
---

# About and Update Check

The **about** button at the bottom of the sidebar opens a dialog with three blocks:
the platform release this install runs, the agent version, and the release notes.
Every signed-in user can open it.

![About dialog — platform version, the official and registered agent versions with the fleet breakdown, and the release notes of the running release](/img/screenshots/about-dialog.png)

## Platform

The first line is the platform version. Under it, one of three things:

| You see | Meaning |
|---|---|
| **Official release · Nov 15 2026** | This install runs exactly the tagged release. |
| **2.11.0 + 4 commits · not an official release** | It was built from the main branch, 4 commits after the 2.11.0 release. Hosted installs that deploy every merge usually read like this. |
| No status line | The install can't tell. It shows the version and, when known, the commit, and makes no claim. |

An install calls itself an official release only with evidence: the checkout is
exactly on the release tag (server and appliance installs know this without any
network access), or GitHub confirms that the running commit is the tag. The
version number alone is never enough, because it stays the same on every commit
until the next release.

When a newer release exists, the block says **2.11.1 is available** with a
**What's new** button that shows that release's notes. The dialog has no upgrade
button: upgrading stays the procedure in the deployment guide for your install.

## Agent

- **Official** is the newest released agent version.
- **Registered here** is the newest version this install can hand to agents, and
  the operating systems it covers.
- **Fleet** is how many agents run each version.

The last two lines need permission to see agents. If the official version is
newer than anything registered, the dialog says so: register it on the Agents
page (upload, or **Build from source**) before agents can update to it.

## The dot on the button

Users who can open Settings see a small dot on **about** when a newer platform
release exists, or when the official agent is newer than what is registered.
Opening About clears it. It comes back only for a release newer than the one
you have already looked at.

## The update check

About once a day (and one minute after start), the backend asks GitHub which
releases are the newest. It makes two requests:

```
GET https://api.github.com/repos/projectachilles/ProjectAchilles/releases?per_page=30
GET https://api.github.com/repos/projectachilles/ProjectAchilles/compare/v<version>...<commit>
```

- **Nothing about your install is sent.** No token, no host name, no
  organization, no agent count. The only headers are `Accept` and
  `User-Agent: ProjectAchilles`. The second request contains the public commit
  the install was built from.
- **Nothing waits on it.** The check runs in the background; pages and API calls
  only read its last answer.
- **Without internet access** the dialog still shows the version, the release
  notes that shipped with the install, and the agent version that was official
  at release time. The last line reads *Last checked: never (no connection to
  GitHub)*.

To allow it through a firewall, permit outbound HTTPS to `api.github.com` from
the server.

### Turning it off

Set this in the backend's environment (`backend/.env`) and restart the backend:

```
RELEASE_CHECK=off
```

The dialog then reads *Update check is off*, shows no "available" notice and no
dot, and the backend makes no request to GitHub.

A fork that publishes its own releases can point the check at its repository
with `RELEASE_CHECK_REPO=owner/repo`.

:::note[Not on Vercel]
The About dialog needs the main backend. An install on the serverless backend
has no **about** button.
:::
