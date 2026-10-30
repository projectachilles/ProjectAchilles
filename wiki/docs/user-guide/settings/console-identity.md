---
sidebar_position: 4
title: "Console Identity"
description: "Show which organization a console belongs to: an organization code, optional full name and a preset colour across the sidebar, page headers, browser tab and favicon."
---

# Console Identity

When you work with more than one ProjectAchilles install, it is easy to run a test or change a setting in the wrong customer's console. Console identity labels each console with the organization it belongs to, so everyone who signs in sees it at once.

An administrator sets three values:

| Field | Rules |
|-------|-------|
| **Code** | Required. 2 to 6 letters or digits, uppercased automatically (for example `ACME`). Other characters are removed as you type. |
| **Full name** | Optional. Up to 80 characters, for example `Acme Financial Group`. Leave it empty for no name. |
| **Colour** | A preset swatch, or **None**. |

## Where it shows

- **Sidebar**: a plate under the logo with the code chip and the full name.
- **Page headers**: a small pill with the code and name, right-aligned in the page header. Pages without a page header (for example the Dashboard and Agents) show the sidebar plate and the ribbon but no pill.
- **Colour ribbon**: a thin bar across the top of the window, when a colour is chosen.
- **Browser tab**: the title becomes `[ACME] Settings · f0_csv` (the suffix is the console wordmark) and the favicon becomes a rounded square carrying the code, so you can tell consoles apart in a crowded tab strip.
- **CLI authorization**: the "Authorize CLI" screen shows the identity, so you know which console you are granting access to.

It is not shown on the sign-in pages or on printed reports and evidence pages. If no code is set anywhere, nothing changes: the console looks exactly as it did before.

## Colours

Violet, Indigo, Blue, Cyan, Fuchsia, Pink, Orange and Silver, plus **None** (a neutral plate, no ribbon, a dark favicon).

Green, amber and red are left out on purpose: they mean Protected, warning and Unprotected throughout the console, and an identity colour must never be mistaken for a result. There is no custom colour input.

## Editing it

Open **Settings → General** (visible to administrators only). The **Preview** row shows the favicon, the tab title and the header pill, and updates as you type, before you save.

- **Save** is available once the code has at least 2 characters.
- **Reset to environment** removes the saved identity and goes back to the environment values below. It is disabled when nothing is saved.
- When the values on screen come from the environment, the card shows **From environment** next to them.

## Setting it from the environment

For installs where you would rather configure the identity at deploy time, set these variables in `backend/.env` (or in `deploy.config.env` for the server installer, which forwards them to `backend/.env`):

```bash
CONSOLE_ORG_CODE=ACME
CONSOLE_ORG_NAME="Acme Financial Group"   # falls back to ORGANIZATION_NAME
CONSOLE_ORG_COLOR=violet                # violet|indigo|blue|cyan|fuchsia|pink|orange|silver|none
```

If `CONSOLE_ORG_NAME` is not set, `ORGANIZATION_NAME` is used instead. `deploy.config.env` is read by bash, so quote a name that contains spaces.

### Precedence

A saved identity **replaces** the environment values entirely. If you save a code and leave the name blank, the name stays blank; it does not fall back to `CONSOLE_ORG_NAME`. **Reset to environment** deletes the saved record, and the environment values apply again.

## Who can change it

Everyone signed in can see the identity. Changing or resetting it needs the `settings:platform:write` permission (administrators) **and** a signed-in browser session. API keys and CLI tokens cannot change it, even with the `admin` scope.

## API

| Method | Path | Notes |
|--------|------|-------|
| `GET` | `/api/settings/identity` | Returns the effective identity. Any signed-in user, and API keys. |
| `PUT` | `/api/settings/identity` | Saves the identity. Needs `settings:platform:write` and a browser session. |
| `DELETE` | `/api/settings/identity` | Removes the saved identity (back to the environment). Same requirements as `PUT`. |

`PUT` body:

```json
{ "code": "ACME", "name": "Acme Financial Group", "color": "violet" }
```

`name` may be `null`; `color` is a preset key or `none`. Invalid input returns `400` with `{ "success": false, "error": "..." }`. API keys and CLI tokens get `403`. Every response carries `{ code, name, color, source }`, where `source` is `saved`, `env` or `none`.

:::note[Not available on Vercel]
The serverless (Vercel) deployment does not include console identity. Settings → General is hidden there and the console makes no identity requests.
:::
