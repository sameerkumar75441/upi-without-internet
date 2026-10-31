# UPI Offline Mesh - MERN Demo

An encrypted offline payment-mesh simulation. A payment packet is encrypted, forwarded through virtual devices, uploaded by a bridge node, and settled exactly once. It is **not real UPI, Bluetooth, or bank integration**.

## Production readiness

- Dockerfiles for the API and React dashboard
- MongoDB Atlas-compatible environment configuration
- `/health` endpoint for deployment health checks
- Configurable, restricted CORS for REST and Socket.IO
- Security response headers, request-size limit and graceful shutdown
- Environment examples with no secrets committed

## Local development

```powershell
docker compose up -d
cd server; npm install; npm run dev
cd client; npm install; npm run dev
```

Open `http://localhost:5173`. All demo accounts use PIN `1234`.

## Deploy the API

Deploy `server/` to Render, Railway, Fly.io, or any Docker host.

Set these environment variables:

```text
MONGODB_URI=<MongoDB Atlas replica-set connection string>
CORS_ORIGIN=https://your-frontend-domain.com
PORT=8080
PACKET_MAX_AGE_SECONDS=86400
IDEMPOTENCY_TTL_SECONDS=86400
```

Set the platform health-check path to `/health`. MongoDB must be an Atlas replica set because settlement uses MongoDB transactions.

## Deploy the frontend

Deploy `client/` to Vercel, Netlify, or a Docker host. Set this build variable:

```text
VITE_API_URL=https://your-api-domain.com/api
```

Then set the API's `CORS_ORIGIN` to the final frontend URL. Socket.IO uses the API base URL automatically.

## Docker production build

1. Copy `.env.production.example` to `.env.production` and fill in real public URLs and the Atlas URI.
2. Run:

```powershell
docker compose --env-file .env.production -f docker-compose.prod.yml up --build -d
```

The dashboard is served on port 80 and the API is on port 8080. For public deployment, place a managed HTTPS reverse proxy in front of them or use platform-managed domains.

## Test

```powershell
cd server; npm test
cd client; npm run build
```
