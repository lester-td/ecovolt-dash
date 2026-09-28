import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const app = express();
const PORT = Number(process.env.PORT ?? 3001);
const ECOVOLT_API = process.env.ECOVOLT_API_URL ?? 'https://api.ecovolt.ai';

app.use(express.json({ limit: '1mb' }));

type Level = 'system' | 'tenant' | 'zone' | 'room' | 'distributionBox' | 'device';
type Mode = 'daily' | 'hourly' | 'realtime' | 'environment-hourly' | 'environment-realtime';

function requiredString(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${field} is required`);
  return value.trim();
}

async function ecovoltFetch(apiKey: string, endpoint: string) {
  const url = new URL(endpoint, ECOVOLT_API);
  const response = await fetch(url, {
    headers: { 'x-api-key': apiKey }
  });

  const text = await response.text();
  let payload: unknown = text;
  try { payload = text ? JSON.parse(text) : null; } catch { /* leave as text */ }

  if (!response.ok) {
    const detail = typeof payload === 'string' ? payload : JSON.stringify(payload);
    throw new Error(`Ecovolt ${response.status}: ${detail}`);
  }
  return payload;
}

app.post('/api/directory', async (req, res) => {
  try {
    const apiKey = requiredString(req.body.apiKey, 'apiKey');
    const systemId = requiredString(req.body.systemId, 'systemId');
    const data = await ecovoltFetch(apiKey, `/api/system/${encodeURIComponent(systemId)}/sandbox-directory`);
    res.json(data);
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : 'Unknown error' });
  }
});

app.post('/api/query', async (req, res) => {
  try {
    const apiKey = requiredString(req.body.apiKey, 'apiKey');
    const systemId = requiredString(req.body.systemId, 'systemId');
    const level = requiredString(req.body.level, 'level') as Level;
    const mode = requiredString(req.body.mode, 'mode') as Mode;
    const from = requiredString(req.body.from, 'from');
    const till = requiredString(req.body.till, 'till');
    const entityId = level === 'system' ? systemId : requiredString(req.body.entityId, 'entityId');
    const deviceType = typeof req.body.deviceType === 'string' ? req.body.deviceType : undefined;
    const bucketMinutes = [1, 5, 10].includes(Number(req.body.bucketMinutes)) ? Number(req.body.bucketMinutes) : 1;

    const start = new Date(from);
    const end = new Date(till);
    if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || start >= end) {
      throw new Error('Invalid date range');
    }

    const q = new URLSearchParams({ from: start.toISOString(), till: end.toISOString() });
    let endpoint: string;

    if (mode === 'daily') {
      const map: Record<Level, string> = {
        system: `/api/usage-history/date-range/system/${entityId}`,
        tenant: `/api/usage-history/date-range/tenant/${entityId}`,
        zone: `/api/usage-history/date-range/zone/${entityId}`,
        room: `/api/usage-history/date-range/room/${entityId}`,
        distributionBox: `/api/usage-history/date-range/distribution-box/${entityId}`,
        device: `/api/usage-history/date-range/device/${entityId}`
      };
      endpoint = `${map[level]}?${q}`;
    } else if (mode === 'hourly') {
      const map: Record<Level, string> = {
        system: `/api/usage-history/date-range/system-id/hour/${entityId}`,
        tenant: `/api/usage-history/date-range/tenant-id/hour/${entityId}`,
        zone: `/api/usage-history/date-range/zone-id/hour/${entityId}`,
        room: `/api/usage-history/date-range/room-id/hour/${entityId}`,
        distributionBox: `/api/usage-history/date-range/distribution-box-id/hour/${entityId}`,
        device: `/api/usage-history/date-range/device-id/${entityId}`
      };
      endpoint = `${map[level]}?${q}`;
    } else if (mode === 'realtime') {
      const spanMs = end.getTime() - start.getTime();
      if (spanMs > 2 * 86_400_000) throw new Error('Realtime queries are limited to 2 days by the Ecovolt API');

      if (level === 'device') {
        if (deviceType === 'ENV_SENSOR') throw new Error('Use Environment realtime for environment sensors');
        endpoint = `/api/usage-history/date-range/realTime/energy/device-id/${entityId}?${q}`;
      } else if (level === 'room') {
        endpoint = `/api/usage-history/date-range/realTime/room/${entityId}/mcb?${q}`;
      } else if (level === 'zone') {
        endpoint = `/api/usage-history/date-range/realTime/zone/${entityId}/mcb?${q}`;
      } else if (level === 'distributionBox') {
        endpoint = `/api/usage-history/date-range/realTime/distribution-box/${entityId}/mcb?${q}`;
      } else {
        throw new Error('Realtime MCB aggregation is available for zone, room, distribution box, or individual energy devices');
      }
    } else if (mode === 'environment-hourly') {
      if (level !== 'device' || deviceType !== 'ENV_SENSOR') throw new Error('Environment hourly requires an ENV_SENSOR device');
      endpoint = `/api/usage-history/environment-sensor/hourly/${entityId}?${q}`;
    } else if (mode === 'environment-realtime') {
      if (level !== 'device' || deviceType !== 'ENV_SENSOR') throw new Error('Environment realtime requires an ENV_SENSOR device');
      const spanMs = end.getTime() - start.getTime();
      if (spanMs > 2 * 86_400_000) throw new Error('Environment realtime queries are limited to 2 days by the Ecovolt API');
      q.set('bucketMinutes', String(bucketMinutes));
      endpoint = `/api/usage-history/environment-sensor/realtime/${entityId}?${q}`;
    } else {
      throw new Error('Unsupported query mode');
    }

    const data = await ecovoltFetch(apiKey, endpoint);
    res.json({ endpoint, data });
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : 'Unknown error' });
  }
});

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dist = path.resolve(__dirname, '../dist');
app.use(express.static(dist));
app.use((_req, res) => res.sendFile(path.join(dist, 'index.html')));

app.listen(PORT, () => {
  console.log(`Ecovolt Explorer backend listening on http://localhost:${PORT}`);
});
