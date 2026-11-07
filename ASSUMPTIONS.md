# Assumptions

- Coolify provisions Postgres via the bundled postgres service.
- MASTER_KEY is a 32-byte base64 secret set in Coolify env.
- ACME_ENV defaults to staging; switch to production only after validation.
- AGENT_HOST (hotspotmikrotik.alnooah.pro) DNS A record points to the Coolify server IP.
