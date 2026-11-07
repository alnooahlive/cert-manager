# Cert Manager

Mikrotik Hotspot SSL certificate manager. Issues Let's Encrypt certificates via Cloudflare DNS-01 and delivers them to Mikrotik routers (ROS v6/v7) over HTTPS.

## Run locally

```sh
cp .env.example .env
# edit .env
npm install
npm run build
npm run migrate
npm start
```

Docker:

```sh
docker compose up -d --build
```

## Deploy (Coolify)

Docker Compose service. Set env vars in Coolify. Health check: `GET /health`.

## Verification

```sh
BASE_URL=https://hotspotmikrotik.alnooah.pro \
ADMIN_EMAIL=admin@alnooah.pro \
ADMIN_PASSWORD='Admin123!ChangeMe' \
npm run verify
```

## CI/CD

GitHub Actions: `.github/workflows/ci.yml` (build + verify) and `deploy.yml` (trigger Coolify + verify).
Required secrets: `BASE_URL`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `COOLIFY_TOKEN`, `COOLIFY_BASE`, `COOLIFY_APP_UUID`.

## Agent host

Routers fetch from `https://<AGENT_HOST>/agent/v1/<token>/...`. Ensure DNS A record points to the app host.

## License

MIT
