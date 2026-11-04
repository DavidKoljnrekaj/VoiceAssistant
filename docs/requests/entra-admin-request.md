# Request to the Microsoft 365 administrator: one app registration for the company assistant

**For:** the tenant administrator (Global Administrator, or Application Administrator together
with a role that can grant tenant-wide admin consent).
**Time needed:** about 20 minutes, in one sitting.
**Why once:** everything the assistant will need from Entra for the foreseeable future is in this
one request, and the requester (below) becomes the app's owner so later changes such as redirect
addresses and secret renewal do not need you again.

## What this is for

The company's AI assistant will read the signed-in employee's own Outlook mail and calendar and,
only after the employee confirms each action, reply to a message or flag it. It uses delegated
permissions only: it acts as the employee who connected their own mailbox, never as an application
with access to every mailbox. Nothing here touches the existing Landmark (Cognilion) sign-in app
registration; please leave that one as it is.

Requester and future owner of the app: **David Koljnrekaj** (his work account in this tenant).

## Steps

### 1. Create the app registration

Entra admin center → **Identity** → **Applications** → **App registrations** → **New registration**.

| Field                   | Value                                                                     |
| ----------------------- | ------------------------------------------------------------------------- |
| Name                    | `Asistent`                                                                |
| Supported account types | **Accounts in this organizational directory only** (single tenant)        |
| Redirect URI            | Platform **Web**, `http://localhost:3000/integrations/microsoft/callback` |

Register. The production redirect address does not exist yet; David adds it himself later as the
app's owner (step 5).

### 2. API permissions (delegated, Microsoft Graph)

App → **API permissions** → **Add a permission** → **Microsoft Graph** → **Delegated permissions**.
Add all of these, then remove nothing else that is listed by default except as noted:

| Permission                   | Why                                                                                                       |
| ---------------------------- | --------------------------------------------------------------------------------------------------------- |
| `openid`, `profile`, `email` | identify the employee who connects (and a possible "Sign in with Microsoft" later)                        |
| `offline_access`             | stay connected without asking the employee to sign in every hour                                          |
| `User.Read`                  | read the employee's own name and address, to check they connect their own mailbox                         |
| `Mail.ReadWrite`             | read the employee's mail, and set or clear a flag on a message they chose                                 |
| `Mail.Send`                  | send a reply the employee dictated and confirmed                                                          |
| `Calendars.Read`             | read the employee's own calendar                                                                          |
| `People.Read`                | resolve a spoken name ("Marko") to a colleague, for a later part; included now so you are not asked again |

No application permissions. Then click **Grant admin consent for <tenant>** and confirm. Every
row should show a green "Granted" status.

### 3. A client secret

App → **Certificates & secrets** → **Client secrets** → **New client secret**: description
`assistant-api`, expiry **24 months**. Copy the **Value** immediately (it is shown once).

Please send the value to David through a one-time secret link (for example Bitwarden Send or a
1Password share link), never in plain email or chat. Tell him the expiry date.

### 4. Who may connect

Entra admin center → **Enterprise applications** → `Asistent` → **Properties** → **Assignment
required?** → **Yes**, save. Then **Users and groups** → **Add user/group** → add **David
Koljnrekaj** (the pilot user). Only assigned users can connect their mailbox; David will add
colleagues later as the owner (step 5).

### 5. Make the requester the owner

- **App registrations** → `Asistent` → **Owners** → **Add owners** → David Koljnrekaj.
- **Enterprise applications** → `Asistent` → **Owners** → **Add** → David Koljnrekaj.

As owner he can add the production redirect address, renew the secret before it expires and
assign further users, without another request to you. Adding a **new** permission later would
need your consent again; that is why step 2 lists everything up front.

## What to send back to David

1. **Directory (tenant) ID** and **Application (client) ID** (app → Overview; these are not secret).
2. The client secret value, through a one-time link, and its expiry date.
3. Confirmation that admin consent shows "Granted" for all permissions in step 2.

## If you would rather not grant something

`People.Read` is the only permission not needed in the first release; it can be dropped, at the
cost of a second, short request later. `Mail.ReadWrite` is needed only for flags; without it the
assistant can still read (`Mail.Read`) and reply (`Mail.Send`).
