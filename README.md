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

## Agent host

Routers fetch from `https://<AGENT_HOST>/agent/v1/<token>/...`. Ensure DNS A record points to the app host.

## License

MIT
