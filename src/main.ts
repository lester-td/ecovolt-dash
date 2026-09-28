import Chart from 'chart.js/auto';
import './style.css';

type NamedEntity = { _id: string; name?: string; tenantId?: string; zoneId?: string; roomId?: string; distributionBoxId?: string };
type Device = NamedEntity & { deviceType: string };
type Directory = {
  groups: string[];
  tenants: NamedEntity[];
  zones: NamedEntity[];
  rooms: NamedEntity[];
  distributionBoxes: NamedEntity[];
  devices: Device[];
};
type Level = 'system' | 'tenant' | 'zone' | 'room' | 'distributionBox' | 'device';
type QueryMode = 'daily' | 'hourly' | 'realtime' | 'environment-hourly' | 'environment-realtime';

const app = document.querySelector<HTMLDivElement>('#app')!;
app.innerHTML = `
<div class="shell">
  <div class="header">
    <div><h1>Ecovolt Explorer</h1><p>Browse the sandbox hierarchy and query energy/environment history.</p></div>
    <div class="badge">local key proxy · key not persisted</div>
  </div>
  <div class="grid">
    <section class="card stack">
      <h2>1 · Connect</h2>
      <label>API key <input id="apiKey" type="password" autocomplete="off" placeholder="Ecovolt API key" /></label>
      <label>System ID <input id="systemId" placeholder="System ID" /></label>
      <button id="connect" class="primary">Load directory</button>
      <div id="connectStatus" class="status">Enter your sandbox key and system ID.</div>
      <div id="directoryStats" class="directory-stats"></div>
      <hr/>
      <h2>2 · Choose scope</h2>
      <label>Query level
        <select id="level">
          <option value="system">Whole system</option><option value="tenant">Tenant</option><option value="zone">Zone</option>
          <option value="room">Room</option><option value="distributionBox">Distribution box</option><option value="device">Device</option>
        </select>
      </label>
      <label>Tenant <select id="tenant"><option value="">— any / select —</option></select></label>
      <label>Zone <select id="zone"><option value="">— any / select —</option></select></label>
      <label>Room <select id="room"><option value="">— any / select —</option></select></label>
      <label>Distribution box <select id="distributionBox"><option value="">— any / select —</option></select></label>
      <label>Device <select id="device"><option value="">— select —</option></select></label>
      <div id="selection" class="selection">Load the directory first.</div>
      <hr/>
      <h2>3 · Query</h2>
      <label>Resolution / data type <select id="mode"></select></label>
      <div id="envMetricWrap" class="hidden">
        <label>Environment metric
          <select id="envMetric">
            <option value="temperature">Temperature (°C)</option><option value="humidity">Humidity (%)</option>
            <option value="carbonDioxide">CO₂ (ppm)</option><option value="lux">Lux</option>
            <option value="soundLevel">Sound (dB)</option><option value="pm2_5">PM2.5</option>
            <option value="totalVolatileOrganicCompounds">TVOC</option><option value="motionDetected">Motion (0/1)</option>
          </select>
        </label>
      </div>
      <div id="bucketWrap" class="hidden"><label>Realtime bucket <select id="bucket"><option value="1">1 minute</option><option value="5">5 minutes</option><option value="10">10 minutes</option></select></label></div>
      <div class="row">
        <label>From <input id="from" type="datetime-local" /></label>
        <label>Till <input id="till" type="datetime-local" /></label>
      </div>
      <div class="hint">Realtime endpoints allow a maximum 2-day range. Daily/hourly can use longer ranges.</div>
      <button id="run" class="primary" disabled>Run query</button>
      <div id="queryStatus" class="status"></div>
    </section>

    <section class="card">
      <h2>Results</h2>
      <div class="summary">
        <div class="metric"><div class="k">Points</div><div class="v" id="mPoints">—</div></div>
        <div class="metric"><div class="k" id="m1k">Total energy</div><div class="v" id="m1">—</div></div>
        <div class="metric"><div class="k" id="m2k">Cost / average</div><div class="v" id="m2">—</div></div>
        <div class="metric"><div class="k" id="m3k">Tariff / peak</div><div class="v" id="m3">—</div></div>
      </div>
      <div class="chart-wrap"><canvas id="chart"></canvas></div>
      <div class="toolbar">
        <div id="endpoint" class="endpoint">No request yet.</div>
        <button id="download" class="secondary" disabled>Download JSON</button>
      </div>
      <details><summary>Raw response</summary><pre id="raw">No data.</pre></details>
    </section>
  </div>
</div>`;

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const apiKey = $('apiKey') as HTMLInputElement;
const systemId = $('systemId') as HTMLInputElement;
const connect = $('connect') as HTMLButtonElement;
const connectStatus = $('connectStatus');
const directoryStats = $('directoryStats');
const level = $('level') as HTMLSelectElement;
const tenant = $('tenant') as HTMLSelectElement;
const zone = $('zone') as HTMLSelectElement;
const room = $('room') as HTMLSelectElement;
const distributionBox = $('distributionBox') as HTMLSelectElement;
const device = $('device') as HTMLSelectElement;
const selection = $('selection');
const mode = $('mode') as HTMLSelectElement;
const envMetricWrap = $('envMetricWrap');
const envMetric = $('envMetric') as HTMLSelectElement;
const bucketWrap = $('bucketWrap');
const bucket = $('bucket') as HTMLSelectElement;
const from = $('from') as HTMLInputElement;
const till = $('till') as HTMLInputElement;
const run = $('run') as HTMLButtonElement;
const queryStatus = $('queryStatus');
const raw = $('raw');
const endpointEl = $('endpoint');
const download = $('download') as HTMLButtonElement;

let directory: Directory | null = null;
let chart: Chart | null = null;
let lastData: unknown = null;
let lastEndpoint = '';

function localInput(d: Date) {
  const copy = new Date(d.getTime() - d.getTimezoneOffset() * 60_000);
  return copy.toISOString().slice(0, 16);
}
const now = new Date();
till.value = localInput(now);
from.value = localInput(new Date(now.getTime() - 24 * 60 * 60_000));

function setOptions(select: HTMLSelectElement, items: NamedEntity[], placeholder: string, suffix?: (x: NamedEntity) => string) {
  const previous = select.value;
  select.innerHTML = `<option value="">${placeholder}</option>` + items.map(x =>
    `<option value="${x._id}">${escapeHtml(x.name ?? x._id)}${suffix ? escapeHtml(suffix(x)) : ''}</option>`
  ).join('');
  if (items.some(x => x._id === previous)) select.value = previous;
}
function escapeHtml(s: string) { return s.replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]!)); }

function refreshHierarchy(changed?: string) {
  if (!directory) return;
  if (changed === 'tenant') { zone.value = ''; room.value = ''; distributionBox.value = ''; device.value = ''; }
  if (changed === 'zone') { room.value = ''; distributionBox.value = ''; device.value = ''; }
  if (changed === 'room') { distributionBox.value = ''; device.value = ''; }
  if (changed === 'distributionBox') device.value = '';

  const zones = directory.zones.filter(x => !tenant.value || x.tenantId === tenant.value);
  setOptions(zone, zones, '— any / select —');
  const rooms = directory.rooms.filter(x => (!tenant.value || x.tenantId === tenant.value) && (!zone.value || x.zoneId === zone.value));
  setOptions(room, rooms, '— any / select —');
  const boxes = directory.distributionBoxes.filter(x => (!tenant.value || x.tenantId === tenant.value) && (!zone.value || x.zoneId === zone.value) && (!room.value || x.roomId === room.value));
  setOptions(distributionBox, boxes, '— any / select —');
  const devices = directory.devices.filter(x =>
    (!tenant.value || x.tenantId === tenant.value) && (!zone.value || x.zoneId === zone.value) && (!room.value || x.roomId === room.value) && (!distributionBox.value || x.distributionBoxId === distributionBox.value)
  );
  setOptions(device, devices, '— select —', x => ` · ${(x as Device).deviceType}`);
  updateLevelControls();
}

function selectedDevice() { return directory?.devices.find(x => x._id === device.value); }
function entityIdForLevel(l: Level) {
  return l === 'system' ? systemId.value.trim() : ({ tenant: tenant.value, zone: zone.value, room: room.value, distributionBox: distributionBox.value, device: device.value } as const)[l];
}
function entityNameForLevel(l: Level) {
  if (!directory || l === 'system') return `System ${systemId.value.trim()}`;
  const collections: Record<Exclude<Level,'system'>, NamedEntity[]> = { tenant: directory.tenants, zone: directory.zones, room: directory.rooms, distributionBox: directory.distributionBoxes, device: directory.devices };
  const e = collections[l].find(x => x._id === entityIdForLevel(l));
  return e?.name ?? e?._id ?? 'Not selected';
}

function updateLevelControls() {
  const l = level.value as Level;
  tenant.disabled = l === 'system';
  zone.disabled = ['system','tenant'].includes(l);
  room.disabled = ['system','tenant','zone'].includes(l);
  distributionBox.disabled = ['system','tenant','zone','room'].includes(l);
  device.disabled = l !== 'device';
  updateModes();
  const id = entityIdForLevel(l);
  const dev = selectedDevice();
  selection.innerHTML = `<strong>${escapeHtml(entityNameForLevel(l))}</strong><br>${escapeHtml(l)}${dev && l === 'device' ? ` · ${escapeHtml(dev.deviceType)}` : ''}${id ? `<br><span style="color:#90a49d">${escapeHtml(id)}</span>` : ''}`;
  run.disabled = !directory || !id;
}

function updateModes() {
  const l = level.value as Level;
  const dev = selectedDevice();
  let options: Array<[QueryMode,string]> = [];
  if (l === 'device' && dev?.deviceType === 'ENV_SENSOR') {
    options = [['environment-realtime','Environment realtime'], ['environment-hourly','Environment hourly']];
  } else {
    options = [['daily','Daily energy'], ['hourly','Hourly energy']];
    if (['zone','room','distributionBox','device'].includes(l)) options.push(['realtime','Realtime power']);
  }
  const current = mode.value;
  mode.innerHTML = options.map(([v,t]) => `<option value="${v}">${t}</option>`).join('');
  if (options.some(([v]) => v === current)) mode.value = current;
  envMetricWrap.classList.toggle('hidden', !mode.value.startsWith('environment'));
  bucketWrap.classList.toggle('hidden', mode.value !== 'environment-realtime');
}

connect.addEventListener('click', async () => {
  connectStatus.className = 'status'; connectStatus.textContent = 'Loading directory…';
  connect.disabled = true;
  try {
    const response = await fetch('/api/directory', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ apiKey: apiKey.value, systemId: systemId.value }) });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error ?? 'Directory request failed');
    directory = payload as Directory;
    setOptions(tenant, directory.tenants, '— any / select —');
    refreshHierarchy();
    directoryStats.innerHTML = [
      `${directory.tenants.length} tenants`, `${directory.zones.length} zones`, `${directory.rooms.length} rooms`, `${directory.distributionBoxes.length} DBs`, `${directory.devices.length} devices`, ...directory.groups
    ].map(x => `<span class="pill">${escapeHtml(x)}</span>`).join('');
    connectStatus.className = 'status ok'; connectStatus.textContent = 'Connected. Directory loaded.';
    updateLevelControls();
  } catch (e) {
    connectStatus.className = 'status error'; connectStatus.textContent = e instanceof Error ? e.message : String(e);
  } finally { connect.disabled = false; }
});

[tenant, zone, room, distributionBox].forEach(s => s.addEventListener('change', () => refreshHierarchy(s.id)));
device.addEventListener('change', updateLevelControls);
level.addEventListener('change', updateLevelControls);
mode.addEventListener('change', () => {
  envMetricWrap.classList.toggle('hidden', !mode.value.startsWith('environment'));
  bucketWrap.classList.toggle('hidden', mode.value !== 'environment-realtime');
});
envMetric.addEventListener('change', () => lastData && render(lastData, mode.value as QueryMode));

run.addEventListener('click', async () => {
  const l = level.value as Level;
  const id = entityIdForLevel(l);
  queryStatus.className = 'status'; queryStatus.textContent = 'Querying Ecovolt…'; run.disabled = true;
  try {
    const body = {
      apiKey: apiKey.value,
      systemId: systemId.value,
      level: l,
      entityId: id,
      deviceType: selectedDevice()?.deviceType,
      mode: mode.value,
      from: new Date(from.value).toISOString(),
      till: new Date(till.value).toISOString(),
      bucketMinutes: Number(bucket.value)
    };
    const response = await fetch('/api/query', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body) });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error ?? 'Query failed');
    lastData = payload.data; lastEndpoint = payload.endpoint;
    raw.textContent = JSON.stringify(lastData, null, 2);
    endpointEl.textContent = lastEndpoint;
    download.disabled = false;
    render(lastData, mode.value as QueryMode);
    queryStatus.className = 'status ok'; queryStatus.textContent = 'Done.';
  } catch (e) {
    queryStatus.className = 'status error'; queryStatus.textContent = e instanceof Error ? e.message : String(e);
  } finally { run.disabled = !directory || !entityIdForLevel(level.value as Level); }
});

download.addEventListener('click', () => {
  if (lastData == null) return;
  const blob = new Blob([JSON.stringify({ endpoint:lastEndpoint, data:lastData }, null, 2)], {type:'application/json'});
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `ecovolt-${Date.now()}.json`; a.click(); URL.revokeObjectURL(a.href);
});

function fmt(n: number, digits=2) { return Number.isFinite(n) ? n.toLocaleString(undefined,{maximumFractionDigits:digits}) : '—'; }
function setMetric(id: string, value: string) { $(id).textContent = value; }
function metricLabel(id: string, value: string) { $(id).textContent = value; }

function render(data: any, qmode: QueryMode) {
  let labels: string[] = []; let values: number[] = []; let label = ''; let unit = ''; let points = 0;
  let m1='—',m2='—',m3='—'; let k1='Total energy',k2='Cost / average',k3='Tariff / peak';

  if (qmode === 'daily') {
    const rows = Array.isArray(data) ? data : [];
    labels = rows.map((x:any) => x.date); values = rows.map((x:any) => Number(x.totalEnergyUsage ?? 0)); label='Daily energy'; unit='kWh'; points=rows.length;
    m1 = `${fmt(values.reduce((a,b)=>a+b,0))} kWh`;
    const cost = rows.reduce((a:any,x:any)=>a + Number(x.cost ?? 0),0); m2 = `$${fmt(cost)}`; k2='Period cost';
    const rates = rows.map((x:any)=>Number(x.tariffRate)).filter(Number.isFinite); m3 = rates.length ? `${fmt(rates.at(-1)!,4)}` : '—'; k3='Tariff rate';
  } else if (qmode === 'hourly') {
    const rows = Array.isArray(data?.data) ? data.data : [];
    labels = rows.map((x:any) => String(x.hour).padStart(2,'0')+':00'); values=rows.map((x:any)=>Number(x.totalEnergyUsage ?? 0)); label='Hourly energy'; unit='kWh'; points=rows.length;
    m1 = `${fmt(values.reduce((a,b)=>a+b,0))} kWh`; m2 = rows.length ? `${fmt(values.reduce((a,b)=>a+b,0)/rows.length)} kWh` : '—'; k2='Average / bucket';
    m3 = Number.isFinite(Number(data?.currentTariffRate)) ? `${fmt(Number(data.currentTariffRate),4)}` : '—'; k3='Current tariff';
  } else if (qmode === 'realtime') {
    let rows:any[] = [];
    if (Array.isArray(data)) rows = data;
    else if (Array.isArray(data?.series)) {
      const s = data.series.find((x:any)=>x.measurementType==='COMBINED') ?? data.series[0]; rows = s?.data ?? [];
    }
    labels=rows.map((x:any)=>new Date(x.createdAt).toLocaleString()); values=rows.map((x:any)=>Number(x.power ?? 0)); label='Power'; unit='W'; points=rows.length;
    const avg = values.length ? values.reduce((a,b)=>a+b,0)/values.length : NaN; const peak=values.length?Math.max(...values):NaN;
    m1='—'; k1='Energy (not integrated)'; m2=Number.isFinite(avg)?`${fmt(avg)} W`:'—'; k2='Average power'; m3=Number.isFinite(peak)?`${fmt(peak)} W`:'—'; k3='Peak power';
  } else {
    const rows = Array.isArray(data) ? data : [];
    const field = envMetric.value; labels=rows.map((x:any)=>new Date(x.createdAt ?? x.actualDate).toLocaleString());
    values=rows.map((x:any)=>field==='motionDetected' ? (x[field]?1:0) : Number(x[field])).map((n:number)=>Number.isFinite(n)?n:NaN);
    const unitMap:Record<string,string>={temperature:'°C',humidity:'%',carbonDioxide:'ppm',lux:'lx',soundLevel:'dB',pm2_5:'µg/m³',totalVolatileOrganicCompounds:'ppb',motionDetected:''};
    unit=unitMap[field]??''; label=envMetric.options[envMetric.selectedIndex].text; points=rows.length;
    const clean=values.filter(Number.isFinite); const avg=clean.length?clean.reduce((a,b)=>a+b,0)/clean.length:NaN; const peak=clean.length?Math.max(...clean):NaN;
    m1=Number.isFinite(avg)?`${fmt(avg)} ${unit}`:'—'; k1='Average'; m2=Number.isFinite(peak)?`${fmt(peak)} ${unit}`:'—'; k2='Maximum'; m3=clean.length?`${fmt(Math.min(...clean))} ${unit}`:'—'; k3='Minimum';
  }

  setMetric('mPoints', String(points)); setMetric('m1',m1); setMetric('m2',m2); setMetric('m3',m3);
  metricLabel('m1k',k1); metricLabel('m2k',k2); metricLabel('m3k',k3);

  chart?.destroy();
  chart = new Chart($('chart') as HTMLCanvasElement, {
    type: qmode === 'daily' || qmode === 'hourly' ? 'bar' : 'line',
    data: { labels, datasets:[{ label: unit ? `${label} (${unit})` : label, data: values, borderWidth:2, pointRadius: values.length > 150 ? 0 : 2, tension:.12 }] },
    options: {
      responsive:true, maintainAspectRatio:false,
      scales:{ x:{ ticks:{color:'#90a49d', maxTicksLimit:12}, grid:{color:'rgba(144,164,157,.08)'} }, y:{ ticks:{color:'#90a49d'}, grid:{color:'rgba(144,164,157,.10)'} } },
      plugins:{ legend:{labels:{color:'#d9e9e1'}}, tooltip:{mode:'index',intersect:false} }
    }
  });
}

updateLevelControls();
