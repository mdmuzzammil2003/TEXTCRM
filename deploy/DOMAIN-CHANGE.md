# Moving the CRM to its final domain

The code has no domain baked in. The deploy pipeline reaches the server by IP (`VPS_HOST` secret), and
the Caddyfile reads `APP_HOST` / `FILES_HOST` from the server's `.env`. Changing domain is configuration
only — no code change, no new commit.

Example below: app at `crm.makemysolar.com.au`, files at `files.crm.makemysolar.com.au`.

## 1. DNS (Hostinger DNS for makemysolar.com.au)
- [ ] `A  crm`        → `187.127.101.62`
- [ ] `A  files.crm`  → `187.127.101.62`
- [ ] Wait until both resolve (`nslookup crm.makemysolar.com.au`) **before** step 3, or Caddy can't get
      the HTTPS certificates.

## 2. Outside services — add the new URLs (keep the old ones until the switch is done)
- [ ] **Firebase** → Authentication → Settings → Authorized domains: add `crm.makemysolar.com.au`
      (Google sign-in fails without it).
- [ ] **Google Cloud** → OAuth client (Gmail): add JavaScript origin `https://crm.makemysolar.com.au`
      and redirect URI `https://crm.makemysolar.com.au/<same path as GOOGLE_OAUTH_REDIRECT_URI today>`.
- [ ] **Google Cloud** → Pub/Sub push subscription (Gmail): endpoint → new domain; audience must equal
      `GMAIL_PUSH_AUDIENCE`. (Note 2026-11-14: `GMAIL_PUSH_AUDIENCE` on the server already points at
      `makemysolar.com.au` while the app runs on the temporary domain — check it when Gmail push is set up.)
- [ ] **Xero** developer portal: add redirect URI `https://crm.makemysolar.com.au/api/integrations/xero/callback`.
- [ ] **MessageMedia / VoIPLine / OpenSolar / WhatsApp / BridgeSelect** webhooks, if any are registered
      by hand in their portals: point them at the new domain.

## 3. Server `.env` (`/opt/mmscrm/.env`, root only)
- [ ] `APP_HOST=crm.makemysolar.com.au`
- [ ] `FILES_HOST=files.crm.makemysolar.com.au`
- [ ] `APP_URL=https://crm.makemysolar.com.au`
- [ ] `API_URL=https://crm.makemysolar.com.au`
- [ ] `GOOGLE_OAUTH_REDIRECT_URI` → new domain, same path
- [ ] `XERO_REDIRECT_URI` → new domain, same path
- [ ] `GMAIL_PUSH_AUDIENCE` → matches the Pub/Sub subscription
- [ ] Back up first: `cp /opt/mmscrm/.env /opt/mmscrm/.env.bak-$(date +%F)`

## 4. Apply
- [ ] `cd /opt/mmscrm && docker compose -f docker-compose.prod.yml up -d` (recreates api/worker/web with
      the new env; Caddy fetches certificates on first request). About 10–30 s of downtime.
- [ ] Check: `https://crm.makemysolar.com.au/api/health` → `{"status":"ok"}`; sign in with Google;
      upload and download a file; Settings → integrations → "Test" each connected one.

## 5. After the switch
- [ ] Gmail and Xero connections: if a reconnect is asked for, reconnect once from Settings.
- [ ] Optional: redirect the old temporary domain to the new one in the Caddyfile for a few weeks
      (this is the only case that touches a file in the repo).
- [ ] Remove the old URLs from Firebase / Google / Xero once nobody uses the old address.
- [ ] Update bible §4 tasks T-03 / T-18 and the old Vercel deployment (T-04).
