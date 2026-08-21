/*
 * SECURITY NOTE (hackathon demo only):
 * Exposing an Electricity Maps API key in client-side JavaScript is acceptable
 * for a short-lived stage demo, but it is not safe for a real public deployment.
 * For production, call Electricity Maps from a small server-side proxy.
 */

const ELECTRICITY_MAPS_API_KEY = "YOUR_KEY_HERE";
const ZONE = "IN-KA";
const CITY_ZONE_MAP = {
  Bengaluru: "IN-KA",
  Mumbai: "IN-MH",
  Delhi: "IN-DL",
  Chennai: "IN-TN",
  Hyderabad: "IN-TG",
  Kolkata: "IN-WB",
  Pune: "IN-MH",
  Ahmedabad: "IN-GJ",
  Jaipur: "IN-RJ",
  Lucknow: "IN-UP",
  Kochi: "IN-KL",
  Singapore: "SG",
  Tokyo: "JP-TK",
  London: "GB",
  "New York": "US-NYISO",
  Sydney: "AU-NSW",
  Berlin: "DE",
  Paris: "FR",
  Dubai: "AE-DU",
};

const API_BASE = "https://api.electricitymap.org";
const FETCH_TIMEOUT_MS = 8000;
const LIVE_REFRESH_MS = 60_000;
const BASE_TICK_MS = 1200;
const STORAGE_KEY = "gridPulseState:v1";

const APPLIANCES = [
  { id: "washer", name: "Washing machine", windowHours: 8, loadKwh: 1.2, slot: 0 },
  { id: "ev", name: "EV charger", windowHours: 12, loadKwh: 9.0, slot: 1 },
  { id: "dishwasher", name: "Dishwasher", windowHours: 6, loadKwh: 1.5, slot: 2 },
];

const CHART = { left: 48, right: 976, top: 20, bottom: 240 };
const SPEEDS = [0.5, 1, 2, 4];

let hourlyData = [];
let isLive = false;
let clockHour = 0;
let tickTimer = null;
let liveTimer = null;
let co2Saved = 0;
let applianceState = {};
let persistedTriggered = {};
let isPlaying = true;
let speed = 1;
let reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
let cordPaths = {};
let currentZone = ZONE;
let soundEnabled = false;
let audioContext = null;

const els = {
  badge: document.getElementById("dataBadge"),
  zone: document.getElementById("zoneDisplay"),
  liveIntensity: document.getElementById("liveIntensity"),
  intensityHint: document.getElementById("intensityHint"),
  co2Saved: document.getElementById("co2Saved"),
  clockReadout: document.getElementById("clockReadout"),
  cleanBand: document.getElementById("cleanBand"),
  thresholdLine: document.getElementById("thresholdLine"),
  areaPath: document.getElementById("areaPath"),
  linePath: document.getElementById("linePath"),
  chartGrid: document.getElementById("chartGrid"),
  axisLabels: document.getElementById("axisLabels"),
  clockLine: document.getElementById("clockLine"),
  clockMarker: document.getElementById("clockMarker"),
  pulseLayer: document.getElementById("pulseLayer"),
  toastStack: document.getElementById("toastStack"),
  footerSource: document.getElementById("footerSource"),
  gridEnergyCard: document.getElementById("gridEnergyCard"),
  gridClock: document.getElementById("gridClock"),
  hubStage: document.getElementById("hubStage"),
  cordsLayer: document.getElementById("cordsLayer"),
  socketBoard: document.getElementById("socketBoard"),
  playToggles: Array.from(document.querySelectorAll("[data-play-toggle]")),
  speedButtons: Array.from(document.querySelectorAll("[data-speed]")),
  soundToggle: document.querySelector("[data-sound-toggle]"),
  chartSection: document.getElementById("chartSection"),
  chartLoadingState: document.getElementById("chartLoadingState"),
  cityInput: document.getElementById("cityInput"),
  cityZoneList: document.getElementById("cityZoneList"),
};

function setZoneDisplay() {
  const labels = document.querySelectorAll("#zoneDisplay");
  labels.forEach((node) => {
    node.textContent = currentZone;
  });
}

if (els.zone) els.zone.textContent = currentZone;

function currentTickMs() {
  return Math.round(BASE_TICK_MS / speed);
}

function safeStorageRead() {
  try {
    return JSON.parse(sessionStorage.getItem(STORAGE_KEY) || "{}");
  } catch {
    return {};
  }
}

function saveState() {
  const triggered = {};
  for (const app of APPLIANCES) {
    triggered[app.id] = Boolean(applianceState[app.id]?.triggered);
  }

  sessionStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      hourlyData,
      isLive,
      clockHour,
      isPlaying,
      speed,
      co2Saved,
      selectedZone: currentZone,
      triggered,
      savedAt: Date.now(),
    })
  );
}

function hydrateState() {
  const saved = safeStorageRead();
  if (Array.isArray(saved.hourlyData) && saved.hourlyData.length === 24) {
    hourlyData = saved.hourlyData.map(Number);
    isLive = Boolean(saved.isLive);
  }
  if (Number.isInteger(saved.clockHour)) clockHour = Math.max(0, Math.min(23, saved.clockHour));
  if (typeof saved.isPlaying === "boolean") isPlaying = saved.isPlaying;
  if (SPEEDS.includes(Number(saved.speed))) speed = Number(saved.speed);
  if (Number.isFinite(Number(saved.co2Saved))) co2Saved = Number(saved.co2Saved);
  if (typeof saved.selectedZone === "string" && saved.selectedZone) currentZone = saved.selectedZone;
  if (saved.triggered && typeof saved.triggered === "object") persistedTriggered = saved.triggered;
  setZoneDisplay();
}

function setPausedClass() {
  document.body.classList.toggle("is-paused", !isPlaying);
}

function syncControls() {
  for (const button of els.playToggles) {
    button.textContent = isPlaying ? "Pause" : "Play";
    button.setAttribute("aria-pressed", String(isPlaying));
  }
  for (const button of els.speedButtons) {
    const active = Number(button.dataset.speed) === speed;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  }
  document.documentElement.style.setProperty("--tick-ms", `${currentTickMs()}ms`);
  setPausedClass();
}

function fetchWithTimeout(url, options = {}, ms = FETCH_TIMEOUT_MS) {
  const ctrl = new AbortController();
  const id = setTimeout(() => ctrl.abort(), ms);
  return fetch(url, { ...options, signal: ctrl.signal }).finally(() => clearTimeout(id));
}

function apiHeaders() {
  return { "auth-token": ELECTRICITY_MAPS_API_KEY, Accept: "application/json" };
}

function keyLooksValid() {
  const key = (ELECTRICITY_MAPS_API_KEY || "").trim();
  return key.length > 0 && key !== "YOUR_KEY_HERE";
}

function normalizeTo24Hours(historyEntries) {
  const buckets = Array.from({ length: 24 }, () => []);
  for (const entry of historyEntries) {
    const raw = entry.carbonIntensity ?? entry.carbonIntensityForecast;
    if (raw == null || Number.isNaN(Number(raw))) continue;
    const dt = entry.datetime || entry.timestamp;
    if (!dt) continue;
    const hour = new Date(dt).getHours();
    if (hour >= 0 && hour < 24) buckets[hour].push(Number(raw));
  }
  const result = [];
  let last = 430;
  for (let h = 0; h < 24; h += 1) {
    if (buckets[h].length) {
      const avg = buckets[h].reduce((a, b) => a + b, 0) / buckets[h].length;
      result.push(Math.round(avg));
      last = avg;
    } else {
      result.push(Math.round(last));
    }
  }
  if (buckets.filter((bucket) => bucket.length).length < 6) {
    throw new Error("Insufficient history samples");
  }
  return result;
}

function generateSimulatedCurve() {
  const out = [];
  for (let h = 0; h < 24; h += 1) {
    const t = h + 0.5;
    let v = 430;
    v += 55 * Math.exp(-Math.pow((t - 0.5) / 3.5, 2));
    v -= 75 * Math.exp(-Math.pow((t - 5.5) / 1.6, 2));
    v -= 155 * Math.exp(-Math.pow((t - 13) / 3.0, 2));
    v += 170 * Math.exp(-Math.pow((t - 19.5) / 1.7, 2));
    v += 45 * Math.exp(-Math.pow((t - 8.5) / 1.8, 2));
    out.push(Math.round(Math.max(180, Math.min(620, v))));
  }
  return out;
}

async function fetchHistory(zone = currentZone) {
  if (!keyLooksValid()) throw new Error("API key placeholder");
  const url = `${API_BASE}/v3/carbon-intensity/history?zone=${encodeURIComponent(zone)}`;
  const res = await fetchWithTimeout(url, { headers: apiHeaders() });
  if (!res.ok) throw new Error(`History HTTP ${res.status}`);
  const json = await res.json();
  const history = json.history || json.data || json;
  if (!Array.isArray(history) || !history.length) throw new Error("Empty history");
  return normalizeTo24Hours(history);
}

async function fetchLatest(zone = currentZone) {
  if (!keyLooksValid()) throw new Error("API key placeholder");
  const url = `${API_BASE}/v3/carbon-intensity/latest?zone=${encodeURIComponent(zone)}`;
  const res = await fetchWithTimeout(url, { headers: apiHeaders() });
  if (!res.ok) throw new Error(`Latest HTTP ${res.status}`);
  const json = await res.json();
  const ci = json.carbonIntensity ?? json.data?.carbonIntensity ?? json.carbonIntensity?.carbonIntensity;
  if (ci == null) throw new Error("No intensity in latest");
  return Number(ci);
}

function relPoint(el, stageRect) {
  const r = el.getBoundingClientRect();
  return {
    x: r.left + r.width / 2 - stageRect.left,
    y: r.top + r.height / 2 - stageRect.top,
  };
}

function curvedPath(from, to, id) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  let cx1;
  let cy1;
  let cx2;
  let cy2;
  if (id === "washer") {
    cx1 = from.x + dx * 0.35;
    cy1 = from.y + Math.abs(dy) * 0.55 + 40;
    cx2 = to.x - 30;
    cy2 = to.y + 10;
  } else if (id === "ev") {
    cx1 = from.x + dx * 0.35;
    cy1 = from.y + Math.abs(dy) * 0.55 + 40;
    cx2 = to.x + 30;
    cy2 = to.y + 10;
  } else {
    cx1 = from.x + dx * 0.2;
    cy1 = from.y - 50;
    cx2 = to.x;
    cy2 = to.y + 40;
  }
  return `M ${from.x.toFixed(1)} ${from.y.toFixed(1)} C ${cx1.toFixed(1)} ${cy1.toFixed(1)}, ${cx2.toFixed(1)} ${cy2.toFixed(1)}, ${to.x.toFixed(1)} ${to.y.toFixed(1)}`;
}

function layoutCords() {
  if (!els.hubStage || !els.cordsLayer || !els.socketBoard) return;
  const stageRect = els.hubStage.getBoundingClientRect();
  els.cordsLayer.setAttribute("viewBox", `0 0 ${stageRect.width} ${stageRect.height}`);
  els.cordsLayer.setAttribute("width", stageRect.width);
  els.cordsLayer.setAttribute("height", stageRect.height);

  for (const app of APPLIANCES) {
    const outEl = els.hubStage.querySelector(`[data-anchor="${app.id}"].cord-anchor-out`);
    const slotEl = els.socketBoard.querySelector(`.slot-anchor[data-anchor="${app.id}"]`);
    if (!outEl || !slotEl) continue;

    const d = curvedPath(relPoint(outEl, stageRect), relPoint(slotEl, stageRect), app.id);
    cordPaths[app.id] = d;

    const pathEl = document.getElementById(`cord-${app.id}`);
    const plugEl = document.getElementById(`plug-${app.id}`);
    if (pathEl) pathEl.setAttribute("d", d);
    if (plugEl) {
      plugEl.style.offsetPath = `path('${d}')`;
      plugEl.style.offsetDistance = plugEl.classList.contains("active") ? "100%" : "88%";
    }
  }
}

function spawnSparkAtSlot(id) {
  if (reducedMotion || !els.hubStage || !els.socketBoard) return;
  const slotEl = els.socketBoard.querySelector(`.slot-anchor[data-anchor="${id}"]`);
  if (!slotEl) return;
  const stageRect = els.hubStage.getBoundingClientRect();
  const pt = relPoint(slotEl, stageRect);
  const spark = document.createElement("span");
  spark.className = "spark";
  spark.style.left = `${pt.x}px`;
  spark.style.top = `${pt.y}px`;
  els.hubStage.appendChild(spark);
  spark.addEventListener("animationend", () => spark.remove());
  setTimeout(() => spark.remove(), 600);
}

function xAtHour(h) {
  return CHART.left + (h / 23) * (CHART.right - CHART.left);
}

function yAtValue(v, minV, maxV) {
  const span = Math.max(maxV - minV, 1);
  return CHART.bottom - ((v - minV) / span) * (CHART.bottom - CHART.top);
}

function buildSmoothPath(points, closeArea) {
  if (!points.length) return "";
  let d = `M ${points[0].x.toFixed(1)} ${points[0].y.toFixed(1)}`;
  for (let i = 1; i < points.length; i += 1) {
    const prev = points[i - 1];
    const cur = points[i];
    const cpx = (prev.x + cur.x) / 2;
    d += ` C ${cpx.toFixed(1)} ${prev.y.toFixed(1)}, ${cpx.toFixed(1)} ${cur.y.toFixed(1)}, ${cur.x.toFixed(1)} ${cur.y.toFixed(1)}`;
  }
  if (closeArea) {
    d += ` L ${points[points.length - 1].x.toFixed(1)} ${CHART.bottom}`;
    d += ` L ${points[0].x.toFixed(1)} ${CHART.bottom} Z`;
  }
  return d;
}

function renderChart(data) {
  if (!els.linePath || !els.areaPath || !els.chartGrid || !els.axisLabels) return;
  const minV = Math.min(...data);
  const maxV = Math.max(...data);
  const range = maxV - minV || 1;
  const cleanThreshold = minV + range * 0.3;
  const points = data.map((v, h) => ({ x: xAtHour(h), y: yAtValue(v, minV, maxV) }));

  els.linePath.setAttribute("d", buildSmoothPath(points, false));
  els.areaPath.setAttribute("d", buildSmoothPath(points, true));

  const threshY = yAtValue(cleanThreshold, minV, maxV);
  if (els.thresholdLine) {
    els.thresholdLine.setAttribute("y1", threshY);
    els.thresholdLine.setAttribute("y2", threshY);
  }
  if (els.cleanBand) {
    els.cleanBand.setAttribute("y", threshY);
    els.cleanBand.setAttribute("height", Math.max(0, CHART.bottom - threshY));
  }

  els.chartGrid.innerHTML = "";
  els.axisLabels.innerHTML = "";
  for (let i = 0; i <= 4; i += 1) {
    const frac = i / 4;
    const val = minV + range * (1 - frac);
    const y = CHART.top + frac * (CHART.bottom - CHART.top);
    const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
    line.setAttribute("class", "grid-line");
    line.setAttribute("x1", CHART.left);
    line.setAttribute("x2", CHART.right);
    line.setAttribute("y1", y);
    line.setAttribute("y2", y);
    els.chartGrid.appendChild(line);

    const label = document.createElementNS("http://www.w3.org/2000/svg", "text");
    label.setAttribute("class", "axis-label");
    label.setAttribute("x", 40);
    label.setAttribute("y", y + 3);
    label.setAttribute("text-anchor", "end");
    label.textContent = Math.round(val);
    els.axisLabels.appendChild(label);
  }

  for (let h = 0; h < 24; h += 3) {
    const label = document.createElementNS("http://www.w3.org/2000/svg", "text");
    label.setAttribute("class", "axis-label");
    label.setAttribute("x", xAtHour(h));
    label.setAttribute("y", CHART.bottom + 18);
    label.setAttribute("text-anchor", "middle");
    label.textContent = formatHour(h);
    els.axisLabels.appendChild(label);
  }

  renderChart._minV = minV;
  renderChart._maxV = maxV;
}

function updateGridEnergyVisual(hour) {
  if (!els.gridEnergyCard || !els.gridClock || !hourlyData.length) return;
  const h = Math.max(0, Math.min(23, hour));
  const carbon = hourlyData[h];
  const state = carbon < 150 ? "clean" : carbon < 350 ? "moderate" : "dirty";

  els.gridEnergyCard.dataset.state = state;
  els.gridEnergyCard.style.setProperty(
    "--wind-speed",
    carbon < 150 ? "0.65s" : carbon < 350 ? "1.25s" : "2.65s"
  );
  els.gridClock.textContent = formatHour(h);
  els.gridEnergyCard.setAttribute(
    "aria-label",
    `Grid energy mix animation at ${formatHour(h)}, ${Math.round(carbon)} grams CO2 per kilowatt hour`
  );
}

function setClockVisual(hour, instant = false) {
  const h = Math.max(0, Math.min(23, hour));
  if (els.clockReadout) els.clockReadout.textContent = formatHour(h);
  updateGridEnergyVisual(h);
  if (!els.clockLine || !els.clockMarker || !hourlyData.length) return;

  const x = xAtHour(h);
  const y = yAtValue(
    hourlyData[h],
    renderChart._minV ?? Math.min(...hourlyData),
    renderChart._maxV ?? Math.max(...hourlyData)
  );
  const apply = (node, props) => {
    if (instant || reducedMotion) {
      node.style.transition = "none";
      Object.entries(props).forEach(([k, v]) => {
        node.style[k] = `${v}px`;
        node.setAttribute(k, v);
      });
      void node.getBoundingClientRect();
      node.style.transition = "";
    } else {
      Object.entries(props).forEach(([k, v]) => {
        node.style[k] = `${v}px`;
        node.setAttribute(k, v);
      });
    }
  };
  apply(els.clockLine, { x1: x, x2: x });
  apply(els.clockMarker, { cx: x, cy: y });
}

function spawnPulseRing(hour) {
  if (reducedMotion || !els.pulseLayer || !hourlyData.length) return;
  const x = xAtHour(hour);
  const y = yAtValue(hourlyData[hour], renderChart._minV, renderChart._maxV);
  const ring = document.createElementNS("http://www.w3.org/2000/svg", "circle");
  ring.setAttribute("class", "pulse-ring");
  ring.setAttribute("cx", x);
  ring.setAttribute("cy", y);
  ring.setAttribute("r", 4);
  els.pulseLayer.appendChild(ring);
  ring.addEventListener("animationend", () => ring.remove());
  setTimeout(() => ring.remove(), 1000);
}

function findOptimalHour(data, windowHours) {
  let bestH = 0;
  let bestV = Infinity;
  const limit = Math.min(windowHours, data.length);
  for (let h = 0; h < limit; h += 1) {
    if (data[h] < bestV) {
      bestV = data[h];
      bestH = h;
    }
  }
  return bestH;
}

function formatHour(h) {
  return String(h).padStart(2, "0") + ":00";
}

function setApplianceVisual(id, active) {
  const state = applianceState[id];
  const device = document.getElementById(`device-${id}`);
  const plug = document.getElementById(`plug-${id}`);
  const cord = document.getElementById(`cord-${id}`);
  const slot = document.getElementById(`slot-${id}`);

  if (device) {
    device.classList.toggle("active", active);
    const status = device.querySelector("[data-status]");
    const optimal = device.querySelector("[data-optimal]");
    if (status) status.textContent = active ? "RUNNING" : "WAITING";
    if (optimal && state) {
      optimal.textContent = `Optimal ${formatHour(state.optimalHour)} - ${hourlyData[state.optimalHour]} gCO2/kWh`;
    }
  }
  if (plug) {
    plug.classList.toggle("active", active);
    plug.style.offsetDistance = active ? "100%" : "88%";
  }
  if (cord) cord.classList.toggle("live", active);
  if (slot) slot.classList.toggle("active", active);
}

function precomputeSchedule() {
  applianceState = {};
  for (const app of APPLIANCES) {
    const optimalHour = findOptimalHour(hourlyData, app.windowHours);
    applianceState[app.id] = {
      ...app,
      optimalHour,
      triggered: Boolean(persistedTriggered[app.id]),
      savings: Math.max(0, (hourlyData[0] - hourlyData[optimalHour]) * app.loadKwh),
    };
    setApplianceVisual(app.id, applianceState[app.id].triggered);
  }
}

function activateAppliance(id) {
  const state = applianceState[id];
  if (!state || state.triggered) return;
  state.triggered = true;
  setApplianceVisual(id, true);

  const plug = document.getElementById(`plug-${id}`);
  const slot = document.getElementById(`slot-${id}`);
  if (plug && !reducedMotion) {
    if (cordPaths[id]) plug.style.offsetPath = `path('${cordPaths[id]}')`;
    plug.style.offsetDistance = "88%";
    void plug.getBoundingClientRect();
    requestAnimationFrame(() => {
      plug.classList.add("active");
      plug.style.offsetDistance = "100%";
    });
    setTimeout(() => {
      if (slot) slot.classList.add("active");
      spawnSparkAtSlot(id);
      triggerConnectSound();
    }, 780);
  } else {
    spawnSparkAtSlot(id);
    triggerConnectSound();
  }

  spawnPulseRing(state.optimalHour);
  showToast(
    `${state.name} started`,
    `Grid at ${hourlyData[clockHour]} gCO2/kWh - scheduled ${formatHour(state.optimalHour)}`
  );

  co2Saved += state.savings;
  updateSavingsDisplay(true);
  saveState();
}

function updateSavingsDisplay(pop = false) {
  if (!els.co2Saved) return;
  els.co2Saved.textContent = Math.round(co2Saved).toLocaleString();
  updateImpactStats();
  if (pop && !reducedMotion) {
    els.co2Saved.classList.remove("pop");
    void els.co2Saved.offsetWidth;
    els.co2Saved.classList.add("pop");
    setTimeout(() => els.co2Saved?.classList.remove("pop"), 400);
  }
}

function resetCycle() {
  co2Saved = 0;
  persistedTriggered = {};
  clockHour = 0;
  precomputeSchedule();
  updateSavingsDisplay(false);
  setClockVisual(0, true);
  for (const app of APPLIANCES) {
    const st = applianceState[app.id];
    if (st && st.optimalHour === 0) activateAppliance(app.id);
  }
  saveState();
}

function showToast(title, body) {
  if (!els.toastStack) return;
  const el = document.createElement("div");
  el.className = "toast";
  el.innerHTML = `<div class="toast-title">${title}</div><div class="toast-body">${body}</div>`;
  els.toastStack.appendChild(el);
  setTimeout(() => {
    el.classList.add("out");
    setTimeout(() => el.remove(), 400);
  }, 3800);
}

function classifyIntensity(v) {
  if (!hourlyData.length) return "mid";
  const minV = Math.min(...hourlyData);
  const maxV = Math.max(...hourlyData);
  const mid = minV + (maxV - minV) * 0.45;
  if (v <= mid) return "clean";
  if (v >= minV + (maxV - minV) * 0.7) return "dirty";
  return "mid";
}

function setLiveReadout(value, hint) {
  if (els.liveIntensity) {
    els.liveIntensity.textContent = value == null ? "-" : Math.round(value);
    els.liveIntensity.classList.remove("clean", "dirty", "mid");
    els.liveIntensity.classList.add(value != null ? classifyIntensity(value) : "mid");
  }
  if (els.intensityHint && hint) els.intensityHint.textContent = hint;
}

function setDataMode(live) {
  isLive = live;
  if (els.badge) {
    els.badge.textContent = live ? "LIVE" : "SIMULATED";
    els.badge.classList.toggle("live", live);
    els.badge.classList.toggle("simulated", !live);
  }
  if (els.footerSource) {
    els.footerSource.textContent = live ? `live Electricity Maps - zone ${currentZone}` : "simulated fallback";
  }
}

function setChartLoadingState(isLoading) {
  if (els.chartLoadingState) {
    els.chartLoadingState.hidden = !isLoading;
  }
  if (els.chartSection) {
    els.chartSection.classList.toggle("is-loading", isLoading);
  }
}

function getCityForZone(zone) {
  const code = String(zone || ZONE).toUpperCase();
  const match = Object.entries(CITY_ZONE_MAP).find(([, value]) => value.toUpperCase() === code);
  return match ? match[0] : "Bengaluru";
}

function resolveZoneFromInput(value) {
  const trimmed = String(value || "").trim();
  if (!trimmed) return ZONE;
  const normalized = trimmed.toLowerCase();

  const exactZone = Object.entries(CITY_ZONE_MAP).find(
    ([city, zone]) => zone.toLowerCase() === normalized || city.toLowerCase() === normalized
  );
  if (exactZone) return exactZone[1];

  const partial = Object.entries(CITY_ZONE_MAP).find(
    ([city, zone]) => city.toLowerCase().includes(normalized) || normalized.includes(city.toLowerCase()) || zone.toLowerCase().includes(normalized)
  );
  return partial ? partial[1] : ZONE;
}

function syncCityPickerValue() {
  if (!els.cityInput) return;
  const cityValue = getCityForZone(currentZone);
  if (!els.cityInput.value || els.cityInput.value.toLowerCase() === "") {
    els.cityInput.value = cityValue;
  }
  els.cityInput.value = cityValue;
}

function populateCityLookup() {
  if (!els.cityZoneList) return;
  const options = Object.keys(CITY_ZONE_MAP).sort();
  els.cityZoneList.innerHTML = options.map((city) => `<option value="${city}"></option>`).join("");
  syncCityPickerValue();
}

async function refreshLatest(zone = currentZone) {
  try {
    const v = await fetchLatest(zone);
    setLiveReadout(v, "Live from Electricity Maps - refreshes every 60s");
  } catch {
    if (hourlyData.length) {
      setLiveReadout(
        hourlyData[new Date().getHours()],
        isLive ? "Latest fetch failed - showing hour-of-day from history" : "Simulated - mirrors demo curve"
      );
    }
  }
}

function simulationTick() {
  clockHour += 1;
  if (clockHour >= 24) {
    resetCycle();
    return;
  }

  setClockVisual(clockHour);
  for (const app of APPLIANCES) {
    const st = applianceState[app.id];
    if (st && !st.triggered && st.optimalHour === clockHour) {
      activateAppliance(app.id);
    }
  }
  saveState();
}

function startTimer() {
  if (tickTimer) clearInterval(tickTimer);
  tickTimer = null;
  if (!isPlaying) return;
  tickTimer = setInterval(simulationTick, currentTickMs());
}

function pauseSimulation() {
  isPlaying = false;
  if (tickTimer) clearInterval(tickTimer);
  tickTimer = null;
  syncControls();
  saveState();
}

function resumeSimulation() {
  isPlaying = true;
  syncControls();
  startTimer();
  saveState();
}

function setSimulationSpeed(nextSpeed) {
  if (!SPEEDS.includes(Number(nextSpeed))) return;
  speed = Number(nextSpeed);
  syncControls();
  startTimer();
  saveState();
}

function bindControls() {
  for (const button of els.playToggles) {
    button.addEventListener("click", () => {
      if (isPlaying) pauseSimulation();
      else resumeSimulation();
    });
  }
  for (const button of els.speedButtons) {
    button.addEventListener("click", () => setSimulationSpeed(Number(button.dataset.speed)));
  }
  if (els.soundToggle) {
    els.soundToggle.addEventListener("click", () => {
      setSoundToggleState(!soundEnabled);
    });
  }
}

async function ensureData(zone = currentZone) {
  if (hourlyData.length === 24 && zone === currentZone) {
    setDataMode(isLive);
    return;
  }

  setChartLoadingState(true);
  setDataMode(false);
  setLiveReadout(null, "Loading carbon data...");
  try {
    hourlyData = await fetchHistory(zone);
    currentZone = zone;
    setZoneDisplay();
    setDataMode(true);
    setLiveReadout(hourlyData[new Date().getHours()], "History loaded - fetching latest...");
    await refreshLatest(zone);
  } catch (err) {
    console.warn("[Grid Pulse] Falling back to simulated data:", err.message || err);
    hourlyData = generateSimulatedCurve();
    currentZone = zone || ZONE;
    setDataMode(false);
    setLiveReadout(hourlyData[new Date().getHours()], "Using simulated 24-hour curve");
  } finally {
    renderChart(hourlyData);
    setChartLoadingState(false);
    saveState();
  }
}

function updateImpactStats() {
  const carKm = co2Saved / 180;
  const phoneCharges = co2Saved / 12;
  const savingsRupees = (co2Saved / 400) * 8.5;

  const carEl = document.getElementById("impactCarKm");
  const phoneEl = document.getElementById("impactPhoneCharges");
  const moneyEl = document.getElementById("impactMoney");

  if (carEl) carEl.textContent = `${Math.max(0, carKm).toLocaleString(undefined, { maximumFractionDigits: 1 })}`;
  if (phoneEl) phoneEl.textContent = `${Math.max(0, phoneCharges).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
  if (moneyEl) moneyEl.textContent = `₹${Math.max(0, savingsRupees).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

function triggerConnectSound() {
  if (!soundEnabled) return;
  const AudioCtor = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtor) return;
  if (!audioContext) audioContext = new AudioCtor();
  if (audioContext.state === "suspended") {
    audioContext.resume();
  }

  const now = audioContext.currentTime;
  const oscillator = audioContext.createOscillator();
  const gainNode = audioContext.createGain();

  oscillator.type = "triangle";
  oscillator.frequency.setValueAtTime(680, now);
  oscillator.frequency.exponentialRampToValueAtTime(1040, now + 0.05);

  gainNode.gain.setValueAtTime(0.0001, now);
  gainNode.gain.exponentialRampToValueAtTime(0.045, now + 0.004);
  gainNode.gain.exponentialRampToValueAtTime(0.0001, now + 0.12);

  oscillator.connect(gainNode);
  gainNode.connect(audioContext.destination);
  oscillator.start(now);
  oscillator.stop(now + 0.12);
}

function setSoundToggleState(nextState) {
  soundEnabled = Boolean(nextState);
  if (els.soundToggle) {
    els.soundToggle.textContent = soundEnabled ? "Sound: On" : "Sound: Off";
    els.soundToggle.setAttribute("aria-pressed", String(soundEnabled));
    els.soundToggle.classList.toggle("active", soundEnabled);
  }
}

function bindZonePicker() {
  if (!els.cityInput) return;
  populateCityLookup();
  syncCityPickerValue();

  els.cityInput.addEventListener("change", async (event) => {
    const selectedValue = event.target.value;
    const zone = resolveZoneFromInput(selectedValue);
    currentZone = zone;
    setZoneDisplay();
    syncCityPickerValue();
    await ensureData(currentZone);
    saveState();
  });
}

async function initGridPulse() {
  hydrateState();
  bindControls();
  bindZonePicker();
  syncControls();
  setSoundToggleState(false);

  currentZone = typeof currentZone === "string" && currentZone ? currentZone : ZONE;
  setZoneDisplay();
  await ensureData(currentZone);
  renderChart(hourlyData);
  precomputeSchedule();
  updateSavingsDisplay(false);
  updateImpactStats();
  setClockVisual(clockHour, true);

  requestAnimationFrame(() => {
    layoutCords();
    startTimer();
  });

  refreshLatest(currentZone);
  if (liveTimer) clearInterval(liveTimer);
  liveTimer = setInterval(() => refreshLatest(currentZone), LIVE_REFRESH_MS);
  saveState();
}

let resizeTimer = null;
window.addEventListener("resize", () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(layoutCords, 120);
});

window.matchMedia("(prefers-reduced-motion: reduce)").addEventListener("change", (e) => {
  reducedMotion = e.matches;
});

if (document.fonts && document.fonts.ready) {
  document.fonts.ready.then(() => layoutCords());
}

window.GridPulse = {
  simulationTick,
  pauseSimulation,
  resumeSimulation,
  setSimulationSpeed,
  getState: () => ({ hourlyData, isLive, clockHour, isPlaying, speed, co2Saved }),
};

initGridPulse();
