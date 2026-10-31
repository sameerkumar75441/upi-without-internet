# UPI Offline Mesh - MERN Demo

An encrypted offline payment-mesh simulation. A payment packet is encrypted, forwarded through virtual devices, uploaded by a bridge node, and settled exactly once. It is **not real UPI, Bluetooth, or bank integration**.

## Stack

- React + Vite dashboard
- Node.js + Express + Socket.IO API
- MongoDB Atlas + Mongoose
- RSA-OAEP, AES-256-GCM and SHA-256 through Node `crypto`

## One-time MongoDB Atlas setup

1. Create an Atlas cluster and a database user.
2. In Atlas **Network Access**, allow your development IP address. For deployment, allow the hosting platform's outbound IP range or `0.0.0.0/0` only if you understand the security trade-off.
3. Copy the Drivers connection URI and replace the password. URL-encode special characters in the password: `@` becomes `%40`, `#` becomes `%23` and `/` becomes `%2F`.
4. Atlas clusters support the MongoDB transactions used by this project.

## Local run with Atlas

1. Copy `server/.env.example` to `server/.env`.
2. Put your real Atlas URI in `server/.env` as `MONGODB_URI`.
3. Run the API and dashboard:

```powershell
cd server; npm install; npm run dev
cd client; npm install; npm run dev
```

Open `http://localhost:5173`. All demo accounts use PIN `1234`.

## Deployment

### Backend - Render or Railway

Deploy the `server/` folder. Build command: `npm install`. Start command: `npm start`.

Set these environment variables in the hosting dashboard:

```text
MONGODB_URI=<your Atlas connection URI>
CORS_ORIGIN=https://your-frontend-domain.com
PORT=8080
PACKET_MAX_AGE_SECONDS=86400
IDEMPOTENCY_TTL_SECONDS=86400
```

Set the health-check path to `/health`.

### Frontend - Vercel or Netlify

Deploy the `client/` folder. Build command: `npm run build`; publish directory: `dist`.

Set this build variable:

```text
VITE_API_URL=https://your-api-domain.com/api
```

After deploying the frontend, update the backend `CORS_ORIGIN` to the final frontend URL and redeploy the backend.

## Test

```powershell
cd server; npm test
cd client; npm run build
```
