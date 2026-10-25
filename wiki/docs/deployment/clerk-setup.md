---
sidebar_position: 2.5
title: Clerk Setup
description: Step-by-step Clerk Dashboard setup for ProjectAchilles — create the app, copy the keys, put the role in the session token, restrict sign-ups and make the first admin.
---

# Clerk Setup

ProjectAchilles signs people in with [Clerk](https://clerk.com). Every
deployment, from the [Server Installer](./server-installer) to Docker Compose,
Fly.io, Render, Railway and Vercel, needs one Clerk application set up as on
this page. It takes about 15 minutes in the Clerk Dashboard
([dashboard.clerk.com](https://dashboard.clerk.com)).

When you're done you have:

- the **publishable key** and **secret key** your deployment asks for;
- the user's **role** in every session token, so permissions work;
- sign-ups limited to people you **invite**;
- a **first admin**, who invites everyone else from ProjectAchilles.

:::info[Development or production instance]
Every Clerk application has a **Development** instance, where it starts, and can
have a **Production** instance. Development keys (`pk_test_`, `sk_test_`) are
free and work on any hostname, including private-only names such as
`achilles.corp.lan`, but every page shows a "Development mode" banner and Clerk
applies lower usage limits. Use them for trials and private-only names. For a
deployment people rely on, under a public domain you own, use a Production
instance (`pk_live_`, `sk_live_`): do steps 1–5 on Development first if you
like, then follow [Production instance](#production-instance).

The screenshots on this page show a Development instance. The Production
instance's pages look the same.
:::

## 1. Create the application

On the Applications page, select **Create application**.

![Clerk's Create application form: application name ProjectAchilles, project type Consumer, sign-in options Email and Google on](/img/screenshots/clerk/clerk-create-app.png)

- **Application name:** what people see on the sign-in page, for example
  `ProjectAchilles` or `ProjectAchilles – Acme`.
- **Project type:** **Consumer** is enough. ProjectAchilles keeps each person's
  role in their own Clerk user, not in Clerk Organizations.
- **Sign in options:** keep **Email** on. Turn on the social logins your team
  uses (Google, Microsoft, GitHub). On a Development instance they work with
  Clerk's shared credentials; a Production instance needs your own
  ([Production instance](#production-instance)). You can change these later
  under **Configure → User & authentication**.

Select **Create application**. The new app opens on its **Development**
instance: the switcher at the top of the dashboard shows **Development**.

## 2. Copy the API keys

Open **Configure**, then **API keys** under **Instance** in the left menu.

![Clerk's API keys page: the publishable key and two secret keys, named installer and default, values hidden](/img/screenshots/clerk/clerk-api-keys.png)

| Key | Starts with | Where it goes |
|-----|-------------|---------------|
| **Publishable key** | `pk_test_` or `pk_live_` | Server Installer: **Clerk publishable key**. Other targets: `CLERK_PUBLISHABLE_KEY` (and `VITE_CLERK_PUBLISHABLE_KEY` on the Vercel frontend). |
| **Secret key** | `sk_test_` or `sk_live_` | Server Installer: **Clerk secret key**. Other targets: `CLERK_SECRET_KEY` (backend only). |

- **Publishable key:** the copy button next to it.
- **Secret key:** create a new one for this deployment. Clerk shows a secret key
  in full only once, when it's created. The keys already listed may not copy:
  selecting one can open **Edit IP allowlist** (a Business-plan feature)
  instead.
  1. Select **Add new key**.
  2. Enter a name that says where the key is used, for example
     `projectachilles-prod`, and select **Create key**.
  3. In **Secret key created successfully**, select **Copy key and close**, and
     paste the key into the installer (or your secret store) straight away.
     Clerk can't show it again: if you lose it, create another key and delete
     this one.

  One key per server lets you revoke one without touching the others.
- Ignore the **Quick copy** box at the top of the page: it shows variable names
  for other frameworks (such as Next.js), not the ones ProjectAchilles uses.

:::warning[The secret key is an admin credential]
It can create users, change roles and change your Clerk settings. Never put it in
a ticket, a chat or the frontend, and replace it (**Add new key**, then delete
the old one) if it leaks.
:::

## 3. Add the role to the session token \{#session-token-claim}

Open **Configure → Sessions → Sessions** and scroll to **Customize session
token**.

![Clerk's Customize session token panel: name __session, claims editor with the metadata claim](/img/screenshots/clerk/clerk-session-token.png)

1. Leave **Name** as it is (`__session`).
2. In the **Claims** editor, enter:

   ```json
   {
     "metadata": "{{user.public_metadata}}"
   }
   ```

   If the editor already holds other claims, add the `metadata` line next to
   them.
3. An **Unsaved changes** bar appears at the bottom of the page: select **Save**.

This puts each user's public metadata, which holds their ProjectAchilles role
(step 5), into every session token, so the backend can check permissions on
every request.

:::info[What happens without it]
Releases before v2.5.0 treat every user as read-only when the claim is missing,
admins included: every admin action fails with **Insufficient permissions**
(403). From v2.5.0 the backend looks the role of each signed-in browser session
up in Clerk instead (cached for a minute per user), so permissions still work,
at the cost of those lookups. Set the claim either way. Clerk has no API for this
setting, so no installer can set it for you.
:::

## 4. Restrict sign-ups \{#restrict-sign-ups}

Open **Configure → User & authentication → Access mode**.

![Clerk's Access mode page with Invite-only selected; the left menu shows Access mode marked Invite-only](/img/screenshots/clerk/clerk-access-mode.png)

Select **Invite-only**, then **Save** in the **Unsaved changes** bar at the
bottom. The menu and the instance switcher now show an **Invite-only** badge.

| Mode | What it means for ProjectAchilles |
|------|-----------------------------------|
| **Invite-only** (recommended) | Only invited people can create an account. Invitations from the Server Installer and from ProjectAchilles **Settings → Users** still work, and those carry the role. |
| **Waitlist** | Nobody can sign up, but people can ask to join; you approve them in Clerk, then give them a role (step 5). |
| **Open** | Anyone who can reach the sign-up page can create an account. An account with no role is read-only, but it can still see the dashboards and the test library. Use it only when nobody outside your organisation can reach the server. |

:::tip[Already set when the installer invites the first admin]
With Invite-only on before you install, the Server Installer's first-admin
invitation still gets through. People who aren't invited see that sign-ups are
closed.
:::

## 5. Make the first admin \{#first-admin}

A person's role is a `role` key in their Clerk user's **public metadata**:
`admin`, `operator`, `analyst` or `explorer`. Someone without a role gets
`explorer`, which is read-only. Every deployment needs one admin, who then
invites everyone else from ProjectAchilles.

**With the Server Installer:** give the first admin's email on the **Login**
screen (or `ADMIN_EMAIL` in an unattended install). The installer invites that
address with the admin role, or adds the role to an existing account. Accept the
invitation email and you're done: skip to step 6.

**By hand** (other deployment targets, or when you left the installer field
blank):

1. Create the account:
   - **Invite-only:** in the Clerk Dashboard, open **Users → Invitations →
     Invite user**, enter the email and send it. The person accepts the
     invitation. (The dashboard's invitation can't carry a role, so continue
     with step 2.)
   - **Open:** the person signs up at `https://<your-domain>/sign-up`.
2. Open **Users**, select the person, and scroll to **Metadata**.

   ![The user's Metadata section in Clerk: Public metadata shows role admin, with an Edit button](/img/screenshots/clerk/clerk-user-metadata.png)

3. Select **Edit** next to **Public**, enter the following, and select **Save**:

   ```json
   {
     "role": "admin"
   }
   ```

   ![Clerk's Edit public metadata dialog containing the role admin JSON, with Cancel and Save buttons](/img/screenshots/clerk/clerk-metadata-edit.png)

   If the metadata already holds other keys (such as `org_id`), keep them and add
   `"role": "admin"` next to them.
4. In ProjectAchilles, sign out and sign in again (or wait a minute), so the
   session picks up the role. **Settings → Users** is now visible.

## 6. Invite everyone else

From now on, manage people in ProjectAchilles, not in Clerk: an admin opens
**Settings → Users**, enters an email, picks a role and sends the invitation.
The account created from it has that role, so there's nothing to set in Clerk.

| Role | Can |
|------|-----|
| `admin` | Everything, including users, integrations and settings |
| `operator` | Run and schedule tests, manage agents and builds (no deletes, no users) |
| `analyst` | Read results and analytics, add task notes |
| `explorer` | Read dashboards and the test library (also what a user with no role gets) |

## Production instance

Do this for a deployment under a public domain you own. There are no
screenshots for these steps; the pages look like the ones above.

1. **Create the instance.** Select **Go to prod** at the top right of the
   dashboard (or open the **Development** switcher) and follow Clerk's steps.
   Clerk asks for the domain the app runs on.
2. **Pick the domain.** It must be your ProjectAchilles hostname or one of its
   parents. The Server Installer checks this: for `achilles.corp.example.com`,
   the production key's Clerk domain must be `clerk.achilles.corp.example.com`,
   `clerk.corp.example.com` or `clerk.example.com`. One app on a parent domain
   can serve several hostnames under it.
3. **Add the DNS records.** Open **Configure → Developers → Domains**. Clerk lists
   the records to create (a `clerk.` CNAME for sign-in plus records for its
   emails). Add them at your public DNS provider and wait until Clerk shows each
   one as verified. Sign-in doesn't work until then. On an on-prem LAN, these go
   in the **public** zone; the server's own A record can stay internal-only
   ([DNS and Clerk](./server-installer#dns-and-clerk-pick-your-situation)).
4. **Social logins.** A Production instance needs your own OAuth credentials for
   Google, Microsoft and GitHub. Without them the buttons fail with an empty
   `client_id`. See [OAuth providers](./prerequisites#4-configure-oauth-providers).
5. **Repeat steps 2–5 on the Production instance.** Clerk keeps these settings
   per instance: copy the **production** keys (`pk_live_`, `sk_live_`), set the
   session token claim and **Invite-only** again, and make the first admin again.
   Development users don't exist in Production.
6. **Put the production keys into the deployment.** Server Installer: run it
   again, choose **Reconfigure** and paste the new keys on the Login screen.
   Other targets: replace `CLERK_PUBLISHABLE_KEY` and `CLERK_SECRET_KEY` and
   redeploy.

## Checklist

| | Where in Clerk | Done when |
|---|---|---|
| Keys | **Configure → API keys** | Both keys are in your deployment, from the same instance |
| Session token claim | **Configure → Sessions → Customize session token** | Claims hold `"metadata": "{{user.public_metadata}}"` and are saved |
| Sign-ups | **Configure → User & authentication → Access mode** | The badge says **Invite-only** |
| First admin | **Users →** the user **→ Metadata → Public** | It holds `"role": "admin"`, and **Settings → Users** shows in ProjectAchilles |
| Production only | **Configure → Developers → Domains** | Every record shows as verified |

## Troubleshooting

| Symptom | Cause and fix |
|---------|---------------|
| Signed in, but actions fail with **Insufficient permissions** (403) | The account has no role (step 5), or the session hasn't picked it up yet: sign out and in again. On releases before v2.5.0, also check the session token claim (step 3). |
| Settings → Users is missing from the menu | Same as above: the account isn't an admin yet. |
| The sign-up page says sign-ups are closed | Access mode is Invite-only or Waitlist: invite the person from **Settings → Users** (or, for the first admin, from Clerk's **Users → Invitations**). |
| A "Development mode" banner on every page | The deployment uses development keys (`pk_test_`). Expected on a trial; for production, see [Production instance](#production-instance). |
| Google, Microsoft or GitHub sign-in fails with a 404 and an empty `client_id` | A Production instance without your own OAuth credentials (production step 4). |
| Sign-in fails right after switching to production keys | Clerk's DNS records aren't verified yet (production step 3). |
| Server Installer: `This production key belongs to …` | The production app's domain doesn't fit the hostname (production step 2). |
| Selecting the secret key opens **Edit IP allowlist** | Existing secret keys can't always be copied. Create a new one with **Add new key** and copy it from the dialog (step 2). |
| No invitation email | Check spam, then **Users → Invitations** in Clerk for a pending invitation. |
