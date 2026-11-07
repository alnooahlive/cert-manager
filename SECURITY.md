# Security

- Secrets stored in Coolify env, never committed.
- Cookies HttpOnly/Secure/SameSite=Strict.
- Helmet enabled; CSP disabled for simplicity (tighten in production).
- Step-up auth (TOTP) for certificate reveal is planned (not yet implemented).
- Cloudflare API token scoped to DNS edit on the zone.
