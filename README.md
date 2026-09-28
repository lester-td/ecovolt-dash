# Ecovolt Explorer

A small full-stack TypeScript app for the Ecovolt hackathon sandbox.

It lets you:
- enter an Ecovolt API key + System ID
- load `/api/system/{systemId}/sandbox-directory`
- navigate tenant → zone → room → distribution box → device
- query daily energy, hourly energy, realtime power, and environment-sensor telemetry
- chart results and inspect/download the raw JSON

The API key is **not written to disk or localStorage**. The browser sends it to the local Express backend for each request, and the backend forwards it as `x-api-key` to Ecovolt.

## Run

Requires Node.js 18+ (Node 20+ recommended).

```bash
npm install
npm run dev
```

Open: http://localhost:5173

The backend runs on http://localhost:3001 and Vite proxies `/api` requests to it.

## Production-ish local run

```bash
npm run build
npm start
```

Open: http://localhost:3001

## Supported queries

| Scope | Daily | Hourly | Realtime |
|---|---:|---:|---:|
| System | ✓ | ✓ | — |
| Tenant | ✓ | ✓ | — |
| Zone | ✓ | ✓ | MCB aggregate |
| Room | ✓ | ✓ | MCB aggregate |
| Distribution box | ✓ | ✓ | MCB aggregate |
| MCB / PLUG device | ✓ | ✓ | power/current/voltage payload, charting power |
| ENV_SENSOR | — | environment hourly | environment realtime (1/5/10 minute buckets) |

Realtime queries are capped at 2 days because the Ecovolt sandbox endpoints specify that limit.

## Notes

- The default System ID field is pre-filled with the SUSS sandbox ID from the hackathon directory, but you can replace it.
- If an endpoint is disabled for your sandbox key, the app shows the Ecovolt error rather than hiding it.
- This is intentionally a simple data explorer, not the NERVE dashboard yet. It is a good base for exporting/understanding the data before building the optimisation layer.
