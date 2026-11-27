const STORAGE_TOPIC = "hq.topic";
const STORAGE_THEME = "hq.theme";
const INSTALL_HINT_KEY = "hq.install-hint";
const TOPIC_RE = /^[A-Za-z0-9_-]{1,64}$/;

const TEAMS = [
  { id: "study", label: "Study", bots: ["Moodle Bot", "Remnote Bot", "Obsidian Bot"] },
  { id: "planning", label: "Planning", bots: ["Kalender Bot", "Slack Bot"] },
  { id: "shopping", label: "Shopping", bots: ["Deal Hunter"] },
  { id: "ops", label: "Ops", bots: ["Grok Bot"] },
  { id: "other", label: "Other", bots: [] },
];

const TEAM_COLORS = {
  study: "#3d6bff",
  planning: "#0f8f78",
  shopping: "#e0a100",
  ops: "#6a5cff",
  other: "#8b93a7",
};

const STATUS = {
  working: "Arbeitet",
  done: "Fertig",
  idle: "Leerlauf",
  waiting_user: "Braucht dich",
  error: "Fehler",
  unknown: "Keine Meldung",
};

const STATUS_ALIAS = {
  working: "working",
  arbeiten: "working",
  arbeitet: "working",
  busy: "working",
  done: "done",
  fertig: "done",
  idle: "idle",
  leerlauf: "idle",
  waiting_user: "waiting_user",
  waiting: "waiting_user",
  needs_user: "waiting_user",
  error: "error",
  fehler: "error",
};

const DEFAULT_LOOKS = {
  "Grok Bot": { shape: "sphere", color: "#1E86FC", accessory: "antenna" },
  "Moodle Bot": { shape: "rounded_square", color: "#FD690F", accessory: "glasses" },
  "Remnote Bot": { shape: "bubble", color: "#8F59F9", accessory: "none" },
  "Obsidian Bot": { shape: "hexagon", color: "#000000", accessory: "none" },
  "Kalender Bot": { shape: "pill", color: "#14C16F", accessory: "none" },
  "Slack Bot": { shape: "clover", color: "#F93498", accessory: "none" },
  "Deal Hunter": { shape: "star6", color: "#F59312", accessory: "bow" },
};

const SVG_NS = "http://www.w3.org/2000/svg";
let mascotSeq = 0;

const CONNECTION_LABEL = {
  empty: "Bereit",
  demo: "Demo",
  connecting: "Verbinden…",
  live: "Live",
  reconnecting: "Neu verbinden…",
  error: "Getrennt",
};

const ui = {
  subtitle: document.querySelector("#subtitle"),
  connection: document.querySelector("#connection"),
  reload: document.querySelector("#reload"),
  install: document.querySelector("#install"),
  installHint: document.querySelector("#install-hint"),
  installHintAction: document.querySelector("#install-hint-action"),
  installHintDismiss: document.querySelector("#install-hint-dismiss"),
  openSettings: document.querySelector("#open-settings"),
  emptySettings: document.querySelector("#empty-settings"),
  banner: document.querySelector("#banner"),
  counters: document.querySelector("#counters"),
  usage: document.querySelector("#usage"),
  storage: document.querySelector("#storage"),
  attention: document.querySelector("#attention"),
  empty: document.querySelector("#empty"),
  teams: document.querySelector("#teams"),
  dialog: document.querySelector("#settings"),
  form: document.querySelector("#settings-form"),
  topic: document.querySelector("#topic-input"),
  topicToggle: document.querySelector("#toggle-topic"),
  topicError: document.querySelector("#topic-error"),
  closeSettings: document.querySelector("#close-settings"),
  clearTopic: document.querySelector("#clear-topic"),
  themeGroup: document.querySelector(".segment"),
};

const bots = new Map();
let bannerText = "";
let mode = "empty";
let connection = "empty";
let session = 0;
let abortController = null;
let activeStream = null;
let renderSignature = "";
let deferredInstall = null;

let usagePlan = null;
let planTime = 0;
let rosterNames = new Set();
let rosterTime = 0;
let groupOverrides = new Map();
let groupsTime = 0;
let chatLinks = new Map();
let chatTime = 0;
let lookMap = new Map();
let looksTime = 0;
let storageByMachine = new Map();

function storageGet(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function storageSet(key, value) {
  try {
    if (value == null || value === "") localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    /* Private mode can block storage. The value stays in memory for this visit. */
  }
}

function currentHash() {
  const raw = location.hash.replace(/^#/, "");
  if (!raw) return "";
  try {
    return decodeURIComponent(raw).trim();
  } catch {
    return raw.trim();
  }
}

function clearHash() {
  if (!location.hash) return;
  history.replaceState(null, "", `${location.pathname}${location.search}`);
}

function currentTheme() {
  const stored = storageGet(STORAGE_THEME);
  return stored === "light" || stored === "dark" || stored === "system" ? stored : "system";
}

function prefersDark() {
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

function themeIsDark(theme = currentTheme()) {
  if (theme === "dark") return true;
  if (theme === "light") return false;
  return prefersDark();
}

function applyTheme(theme = currentTheme()) {
  document.documentElement.dataset.theme = theme;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", themeIsDark(theme) ? "#0e0e10" : "#f3f3f5");
  for (const button of ui.themeGroup.querySelectorAll("[data-theme-choice]")) {
    const selected = button.dataset.themeChoice === theme;
    button.setAttribute("aria-checked", selected ? "true" : "false");
    button.tabIndex = selected ? 0 : -1;
  }
}

function el(tag, props, kids) {
  const node = document.createElement(tag);
  if (props) {
    for (const [key, value] of Object.entries(props)) {
      if (value == null || value === false) continue;
      if (key === "class") node.className = value;
      else if (key === "dataset") Object.assign(node.dataset, value);
      else node.setAttribute(key, value === true ? "" : String(value));
    }
  }
  for (const kid of kids || []) {
    if (kid == null || kid === false) continue;
    node.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  }
  return node;
}

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function canonicalName(name) {
  const clean = String(name).trim().replace(/\s+/g, " ");
  if (!clean) return "";
  for (const team of TEAMS) {
    for (const bot of team.bots) {
      if (bot.toLowerCase() === clean.toLowerCase()) return bot;
    }
  }
  return clean;
}

function canonicalTeam(label) {
  const clean = String(label || "").trim().replace(/\s+/g, " ");
  if (!clean) return "";
  const known = TEAMS.find((team) => team.label.toLowerCase() === clean.toLowerCase() || team.id === clean.toLowerCase());
  return known ? known.label : clean;
}

function teamIdFor(label) {
  const known = TEAMS.find((team) => team.label === label);
  return known ? known.id : "custom";
}

function hashHue(name) {
  let hash = 0;
  for (const char of name) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return hash % 360;
}

function teamLabelFor(name) {
  const canonical = canonicalName(name);
  if (groupOverrides.has(canonical)) return groupOverrides.get(canonical);
  const team = TEAMS.find((item) => item.bots.includes(canonical));
  return team ? team.label : "Other";
}

function isDefaultBot(name) {
  return TEAMS.some((team) => team.bots.includes(name));
}

function dotColor(label) {
  const id = teamIdFor(label);
  if (TEAM_COLORS[id]) return TEAM_COLORS[id];
  return `hsl(${hashHue(label)} 62% 48%)`;
}

function safeColor(value) {
  if (typeof value !== "string") return "";
  const color = value.trim();
  if (/^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(color)) return color;
  if (/^(?:rgb|hsl)a?\(\s*[\d.%\s,/]+\)$/i.test(color)) return color;
  if (/^[a-z]{3,20}$/i.test(color)) return color;
  return "";
}

function safeChatUrl(url) {
  if (typeof url !== "string") return "";
  const trimmed = url.trim();
  if (!/^(?:https?:\/\/|grokbot:)/i.test(trimmed)) return "";
  if (/[\s<>"']/.test(trimmed)) return "";
  return trimmed;
}

function normalizeShape(value) {
  const shape = String(value || "").trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (["sphere", "circle"].includes(shape)) return "sphere";
  if (["rounded_square", "rounded", "squircle", "square"].includes(shape)) return "rounded_square";
  if (["bubble", "blob"].includes(shape)) return "bubble";
  if (["hexagon", "hex"].includes(shape)) return "hexagon";
  if (["pill", "capsule"].includes(shape)) return "pill";
  if (shape === "clover") return "clover";
  if (["star6", "star"].includes(shape)) return "star6";
  return "";
}

function normalizeAccessory(value) {
  const name = String(value || "").trim().toLowerCase();
  if (["antenna", "glasses", "bow", "none"].includes(name)) return name;
  return "";
}

function hashColor(name) {
  const hue = hashHue(name);
  const sat = 58;
  const light = 52;
  const c = (1 - Math.abs((2 * light) / 100 - 1)) * (sat / 100);
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = light / 100 - c / 2;
  let r = 0;
  let g = 0;
  let b = 0;
  if (hue < 60) [r, g, b] = [c, x, 0];
  else if (hue < 120) [r, g, b] = [x, c, 0];
  else if (hue < 180) [r, g, b] = [0, c, x];
  else if (hue < 240) [r, g, b] = [0, x, c];
  else if (hue < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  const hex = [r, g, b]
    .map((channel) => Math.round((channel + m) * 255).toString(16).padStart(2, "0"))
    .join("");
  return `#${hex}`;
}

function colorChannels(color) {
  const hex = String(color || "").trim();
  const match = hex.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (!match) return null;
  let body = match[1];
  if (body.length === 3) body = body.split("").map((part) => part + part).join("");
  const value = Number.parseInt(body, 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

function isVeryDark(color) {
  const rgb = colorChannels(color);
  if (!rgb) return false;
  return (0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]) / 255 < 0.22;
}

function resolveLook(name) {
  const base = DEFAULT_LOOKS[name] || { shape: "sphere", color: hashColor(name), accessory: "none" };
  const feed = lookMap.get(name);
  if (!feed) return { ...base };
  const shape = normalizeShape(feed.shape);
  const color = safeColor(feed.color);
  const accessory = normalizeAccessory(feed.accessory);
  return {
    shape: shape || base.shape,
    color: color || base.color,
    accessory: feed.accessory != null && String(feed.accessory).trim() !== "" ? accessory || "none" : base.accessory,
  };
}

function svgEl(tag, attrs) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attrs || {})) {
    if (value != null) node.setAttribute(key, String(value));
  }
  return node;
}

function starPoints(cx, cy, outer, inner, points) {
  const pts = [];
  const count = points * 2;
  for (let i = 0; i < count; i += 1) {
    const radius = i % 2 === 0 ? outer : inner;
    const angle = -Math.PI / 2 + (i * 2 * Math.PI) / count;
    pts.push([cx + Math.cos(angle) * radius, cy + Math.sin(angle) * radius]);
  }
  return pts;
}

function roundedPath(points) {
  const mids = points.map((point, index) => {
    const next = points[(index + 1) % points.length];
    return [(point[0] + next[0]) / 2, (point[1] + next[1]) / 2];
  });
  let path = `M ${mids[0][0].toFixed(2)} ${mids[0][1].toFixed(2)}`;
  for (let i = 0; i < points.length; i += 1) {
    const control = points[(i + 1) % points.length];
    const end = mids[(i + 1) % points.length];
    path += ` Q ${control[0].toFixed(2)} ${control[1].toFixed(2)} ${end[0].toFixed(2)} ${end[1].toFixed(2)}`;
  }
  return `${path} Z`;
}

function bodyNodes(shape, color) {
  const stroke = isVeryDark(color) ? "rgba(255,255,255,0.86)" : "none";
  const width = stroke === "none" ? null : "2.4";
  const nodes = [];
  const add = (tag, attrs) => {
    const node = svgEl(tag, { fill: color, stroke, "stroke-width": width, ...attrs });
    nodes.push(node);
    return node;
  };
  if (shape === "rounded_square") add("rect", { x: "12", y: "14", width: "40", height: "40", rx: "12" });
  else if (shape === "bubble") {
    add("path", {
      d: "M16 28c0-10 8-18 18-18 9 0 18 6 18 16 0 9-6 15-14 16l-1 10-8-10c-8-1-13-6-13-14z",
    });
  } else if (shape === "hexagon") {
    add("polygon", { points: "32,8 54,20 54,44 32,56 10,44 10,20" });
  } else if (shape === "pill") add("rect", { x: "4", y: "20", width: "56", height: "24", rx: "12" });
  else if (shape === "clover") {
    add("circle", { cx: "32", cy: "18", r: "13" });
    add("circle", { cx: "18", cy: "34", r: "13" });
    add("circle", { cx: "46", cy: "34", r: "13" });
    add("circle", { cx: "32", cy: "48", r: "13" });
  } else if (shape === "star6") {
    add("path", { d: roundedPath(starPoints(32, 34, 24, 12, 6)) });
  } else add("circle", { cx: "32", cy: "34", r: "18" });
  return nodes;
}

function faceAnchor(shape) {
  if (shape === "bubble") return { top: 10, eyeY: 30, spread: 7 };
  if (shape === "pill") return { top: 20, eyeY: 32, spread: 9 };
  if (shape === "clover") return { top: 6, eyeY: 33, spread: 6 };
  if (shape === "hexagon") return { top: 8, eyeY: 34, spread: 7.2 };
  if (shape === "star6") return { top: 12, eyeY: 35, spread: 6 };
  if (shape === "rounded_square") return { top: 14, eyeY: 35, spread: 7.2 };
  return { top: 16, eyeY: 35, spread: 7 };
}

function avatar(name, small, status) {
  const look = resolveLook(name);
  const anchor = faceAnchor(look.shape);
  const id = `m${(mascotSeq += 1)}`;
  const svg = svgEl("svg", { class: "mascot", viewBox: "0 0 64 64", "aria-hidden": "true" });
  const defs = svgEl("defs");
  const gradient = svgEl("linearGradient", { id: `${id}-shine`, x1: "0", y1: "0", x2: "0", y2: "1" });
  gradient.append(
    svgEl("stop", { offset: "0", "stop-color": "white", "stop-opacity": "0.72" }),
    svgEl("stop", { offset: "0.42", "stop-color": "white", "stop-opacity": "0.08" }),
    svgEl("stop", { offset: "1", "stop-color": "white", "stop-opacity": "0" }),
  );
  defs.append(gradient);
  svg.append(defs);
  for (const node of bodyNodes(look.shape, look.color)) svg.append(node);
  const shine = svgEl("ellipse", {
    cx: "32",
    cy: String(anchor.top + 8),
    rx: look.shape === "pill" ? "16" : "12",
    ry: "7",
    fill: `url(#${id}-shine)`,
  });
  svg.append(shine);
  const left = 32 - anchor.spread;
  const right = 32 + anchor.spread;
  const eyes = svgEl("g", { class: "eyes" });
  for (const cx of [left, right]) {
    eyes.append(svgEl("ellipse", { cx: String(cx), cy: String(anchor.eyeY), rx: "4.6", ry: "5.4", fill: "#fff" }));
    eyes.append(
      svgEl("ellipse", {
        cx: String(cx + 0.7),
        cy: String(anchor.eyeY + 0.8),
        rx: "1.7",
        ry: "2.1",
        fill: "#1a1a1d",
      }),
    );
  }
  svg.append(eyes);
  const frame = isVeryDark(look.color) ? "rgba(255,255,255,0.92)" : "#1a1a1d";
  if (look.accessory === "antenna") {
    svg.append(
      svgEl("line", {
        x1: "32",
        y1: String(anchor.top + 1),
        x2: "32",
        y2: "5",
        stroke: look.color,
        "stroke-width": "2.2",
        "stroke-linecap": "round",
      }),
      svgEl("circle", { cx: "32", cy: "4.5", r: "3.1", fill: look.color, stroke: isVeryDark(look.color) ? "rgba(255,255,255,0.8)" : "none", "stroke-width": "1.2" }),
    );
  } else if (look.accessory === "glasses") {
    const glasses = svgEl("g", { fill: "none", stroke: frame, "stroke-width": "1.6" });
    glasses.append(
      svgEl("circle", { cx: String(left), cy: String(anchor.eyeY), r: "6.3" }),
      svgEl("circle", { cx: String(right), cy: String(anchor.eyeY), r: "6.3" }),
      svgEl("path", { d: `M ${left + 6.3} ${anchor.eyeY} H ${right - 6.3}` }),
    );
    svg.append(glasses);
  } else if (look.accessory === "bow") {
    const bow = svgEl("g", { transform: `translate(32 ${Math.max(6, anchor.top - 1)})` });
    bow.append(
      svgEl("ellipse", { cx: "-5", cy: "0", rx: "5", ry: "3.1", fill: "#fff", transform: "rotate(-28)" }),
      svgEl("ellipse", { cx: "5", cy: "0", rx: "5", ry: "3.1", fill: "#fff", transform: "rotate(28)" }),
      svgEl("circle", { r: "2.1", fill: look.color, stroke: "#fff", "stroke-width": "0.6" }),
    );
    svg.append(bow);
  }
  const wrap = el("span", { class: small ? "mascot-wrap sm" : "mascot-wrap", "data-status": status || "idle", "aria-hidden": "true" }, [svg]);
  if (status === "working") {
    wrap.append(el("span", { class: "think" }, [el("i"), el("i"), el("i")]));
  }
  return wrap;
}

function formatRelative(unix) {
  if (!unix) return "";
  const delta = Math.max(0, Date.now() / 1000 - unix);
  if (delta < 45) return "gerade eben";
  if (delta < 3600) return `vor ${Math.max(1, Math.round(delta / 60))} Min.`;
  if (delta < 86400) return `vor ${Math.max(1, Math.round(delta / 3600))} Std.`;
  return new Intl.DateTimeFormat("de-DE", {
    timeZone: "Europe/Berlin",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(unix * 1000));
}

function formatReset(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const formatted = new Intl.DateTimeFormat("de-DE", {
    timeZone: "Europe/Berlin",
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
  return `Setzt zurück ${formatted}`;
}

function formatPct(value) {
  return `${new Intl.NumberFormat("de-DE", { maximumFractionDigits: 1 }).format(value)} %`;
}

function formatGb(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "";
  const formatted = new Intl.NumberFormat("de-DE", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 1,
  }).format(number);
  return `${formatted} GB`;
}

function formatTotal(value) {
  const text = formatGb(value);
  if (!text || Number(value) < 1024) return text;
  const tb = new Intl.NumberFormat("de-DE", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(Number(value) / 1024);
  return `${text} (${tb} TB)`;
}

function formatStamp(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("de-DE", {
    timeZone: "Europe/Berlin",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function storageLevel(pct) {
  if (pct >= 90) return "crit";
  if (pct >= 75) return "warn";
  return "ok";
}

function clampPct(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  return Math.min(100, Math.max(0, number));
}

function normalizeStatus(value) {
  if (typeof value !== "string") return "";
  const key = value.trim().toLowerCase().replace(/[\s-]+/g, "_");
  return STATUS_ALIAS[key] || "";
}

function pickString(data, keys) {
  for (const key of keys) {
    if (typeof data[key] === "string") return data[key].trim();
  }
  return null;
}

function readShares(source) {
  if (!isRecord(source)) return [];
  const shares = [];
  for (const [name, value] of Object.entries(source)) {
    const bot = canonicalName(name);
    const pct = clampPct(value);
    if (!bot || pct == null) continue;
    shares.push({ name: bot, pct });
  }
  shares.sort((a, b) => b.pct - a.pct || a.name.localeCompare(b.name, "de"));
  return shares;
}

function finiteGb(value) {
  if (value == null || value === "" || typeof value === "boolean") return null;
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) return null;
  return number;
}

function optionalPct(value) {
  if (value == null || value === "") return null;
  return clampPct(value);
}

function readDrive(entry) {
  if (!isRecord(entry)) return null;
  const drive = typeof entry.drive === "string" ? entry.drive.trim() : "";
  if (!drive) return null;
  const label = typeof entry.label === "string" ? entry.label.trim().replace(/\s+/g, " ") : "";
  let usedGb = finiteGb(entry.used_gb);
  let freeGb = finiteGb(entry.free_gb);
  let totalGb = finiteGb(entry.total_gb);
  let usedPct = optionalPct(entry.used_pct);
  if (totalGb == null && usedGb != null && freeGb != null) totalGb = usedGb + freeGb;
  if (usedGb == null && totalGb != null && freeGb != null) usedGb = Math.max(0, totalGb - freeGb);
  if (freeGb == null && totalGb != null && usedGb != null) freeGb = Math.max(0, totalGb - usedGb);
  if (usedPct == null && totalGb > 0 && usedGb != null) usedPct = clampPct((usedGb / totalGb) * 100);
  if (usedPct == null) return null;
  return { drive, label, usedGb, freeGb, totalGb, usedPct };
}

function readStorage(data) {
  const type = typeof data.type === "string" ? data.type.trim().toLowerCase() : "";
  if (type !== "storage") return null;
  const machine = typeof data.machine === "string" ? data.machine.trim().replace(/\s+/g, " ") : "";
  if (!machine || !Array.isArray(data.drives)) return null;
  const drives = [];
  for (const entry of data.drives) {
    const drive = readDrive(entry);
    if (drive) drives.push(drive);
  }
  if (!drives.length) return null;
  return {
    machine,
    updatedAt: typeof data.updated_at === "string" ? data.updated_at.trim() : "",
    drives,
  };
}

function readPlan(data) {
  const candidates = [];
  if (isRecord(data.usage)) candidates.push(data.usage);
  candidates.push(data);
  for (const source of candidates) {
    const hasPct = source.total_used_pct != null && source.total_used_pct !== "";
    const hasReset = typeof source.resets_at === "string" && source.resets_at.trim();
    const hasBots = isRecord(source.bots);
    if (!hasPct && !hasReset && !hasBots) continue;
    const total = hasPct ? clampPct(source.total_used_pct) : null;
    if (hasPct && total == null && !hasReset && !hasBots) continue;
    return {
      total,
      resetsAt: hasReset ? source.resets_at.trim() : "",
      shares: hasBots ? readShares(source.bots) : [],
    };
  }
  return null;
}

function interpretObject(data) {
  if (!isRecord(data)) return { kind: "ignore" };
  const parts = [];
  const plan = readPlan(data);
  if (plan) parts.push({ kind: "plan", plan });
  const storage = readStorage(data);
  if (storage) parts.push({ kind: "storage", storage });
  if (Array.isArray(data.roster)) {
    parts.push({
      kind: "roster",
      names: data.roster.filter((item) => typeof item === "string" && item.trim()),
    });
  }
  if (isRecord(data.groups)) parts.push({ kind: "groups", map: data.groups });
  if (isRecord(data.chat)) parts.push({ kind: "chat", map: data.chat });
  if (isRecord(data.looks)) parts.push({ kind: "looks", map: data.looks });

  const name = pickString(data, ["bot", "name"]);
  const bot = name ? canonicalName(name) : "";
  const hadStatus = data.status != null || data.state != null;
  const status = normalizeStatus(data.status ?? data.state);
  const step = pickString(data, ["step", "label", "detail"]);
  if (bot && hadStatus && status) parts.push({ kind: "status", bot, status, step });
  else if (bot && step != null && !hadStatus) parts.push({ kind: "status", bot, status: "", step });
  if (!parts.length) return { kind: "ignore" };
  return { kind: "parts", parts };
}

function parsePayload(message) {
  if (message == null) return { kind: "empty" };
  if (typeof message === "object") return interpretObject(message);
  if (typeof message !== "string") return { kind: "ignore" };
  const text = message.trim();
  if (!text) return { kind: "empty" };
  try {
    const data = JSON.parse(text);
    if (data && typeof data === "object") return interpretObject(data);
  } catch {
    /* Plain lines that are not JSON are ignored. */
  }
  return { kind: "ignore" };
}

function newer(time, previous) {
  return !(previous && time && time < previous);
}

function ensureBot(name) {
  const canonical = canonicalName(name);
  if (!canonical) return null;
  if (!bots.has(canonical)) {
    bots.set(canonical, { name: canonical, status: "idle", step: "", time: 0, seen: false });
  }
  return bots.get(canonical);
}

function resetBots() {
  bots.clear();
  for (const team of TEAMS) {
    for (const name of team.bots) ensureBot(name);
  }
}

function resetMeta() {
  usagePlan = null;
  planTime = 0;
  rosterNames = new Set();
  rosterTime = 0;
  groupOverrides = new Map();
  groupsTime = 0;
  chatLinks = new Map();
  chatTime = 0;
  lookMap = new Map();
  looksTime = 0;
  storageByMachine = new Map();
}

function applyRoster(names, time) {
  if (!newer(time, rosterTime)) return;
  rosterTime = time || rosterTime;
  const next = new Set(names.map((name) => canonicalName(name)).filter(Boolean));
  for (const [name, bot] of bots) {
    const fromOlderRoster = rosterNames.has(name) && !next.has(name);
    if (fromOlderRoster && !bot.seen && !isDefaultBot(name) && !groupOverrides.has(name)) bots.delete(name);
  }
  rosterNames = next;
  for (const name of next) ensureBot(name);
}

function applyGroups(map, time) {
  if (!newer(time, groupsTime)) return;
  groupsTime = time || groupsTime;
  groupOverrides = new Map();
  for (const [name, label] of Object.entries(map)) {
    const bot = canonicalName(name);
    const team = canonicalTeam(label);
    if (!bot || !team) continue;
    groupOverrides.set(bot, team);
    ensureBot(bot);
  }
}

function applyChat(map, time) {
  if (!newer(time, chatTime)) return;
  chatTime = time || chatTime;
  chatLinks = new Map();
  for (const [name, url] of Object.entries(map)) {
    const bot = canonicalName(name);
    const href = safeChatUrl(url);
    if (!bot || !href) continue;
    chatLinks.set(bot, href);
    ensureBot(bot);
  }
}

function applyLooks(map, time) {
  if (!newer(time, looksTime)) return;
  looksTime = time || looksTime;
  lookMap = new Map();
  for (const [name, look] of Object.entries(map)) {
    if (!isRecord(look)) continue;
    const bot = canonicalName(name);
    if (!bot) continue;
    lookMap.set(bot, {
      shape: typeof look.shape === "string" ? look.shape : "",
      color: typeof look.color === "string" ? look.color : "",
      accessory: typeof look.accessory === "string" ? look.accessory : "",
    });
    ensureBot(bot);
  }
}

function applyPlan(plan, time) {
  if (!newer(time, planTime)) return;
  planTime = time || planTime;
  usagePlan = plan;
}

function storageInstant(iso, envelopeTime) {
  if (typeof iso === "string" && iso) {
    const ms = Date.parse(iso);
    if (Number.isFinite(ms)) return ms;
  }
  const sec = Number(envelopeTime) || 0;
  return sec > 0 ? sec * 1000 : 0;
}

function applyStorage(storage, time) {
  const updatedMs = storageInstant(storage.updatedAt, time);
  const prev = storageByMachine.get(storage.machine);
  if (prev && updatedMs < prev.updatedMs) return;
  const dated = storage.updatedAt && Number.isFinite(Date.parse(storage.updatedAt));
  storageByMachine.set(storage.machine, {
    machine: storage.machine,
    updatedAt: dated ? storage.updatedAt : updatedMs ? new Date(updatedMs).toISOString() : "",
    updatedMs,
    drives: storage.drives,
  });
}

function applyStatus(part, time) {
  const bot = ensureBot(part.bot);
  if (!bot) return;
  if (bot.time && time && time < bot.time) return;
  if (part.status) bot.status = part.status;
  if (part.step != null) bot.step = part.step;
  bot.seen = true;
  if (time) bot.time = time;
}

function applyParsed(parsed, time) {
  if (!parsed || parsed.kind === "ignore" || parsed.kind === "empty" || parsed.kind !== "parts") return;
  for (const part of parsed.parts) {
    if (part.kind === "plan") applyPlan(part.plan, time);
    else if (part.kind === "roster") applyRoster(part.names, time);
    else if (part.kind === "groups") applyGroups(part.map, time);
    else if (part.kind === "chat") applyChat(part.map, time);
    else if (part.kind === "looks") applyLooks(part.map, time);
    else if (part.kind === "storage") applyStorage(part.storage, time);
    else if (part.kind === "status") applyStatus(part, time);
  }
}

function ingest(envelope) {
  try {
    if (!envelope || typeof envelope !== "object") return;
    if (envelope.event && envelope.event !== "message") return;
    const time = Number(envelope.time) || 0;
    if (typeof envelope.message === "string" || isRecord(envelope.message)) {
      applyParsed(parsePayload(envelope.message), time);
      return;
    }
    if (envelope.bot || envelope.status || envelope.name || envelope.usage || envelope.roster || envelope.groups || envelope.chat || envelope.looks || envelope.total_used_pct != null || envelope.type === "storage" || Array.isArray(envelope.drives)) {
      applyParsed(parsePayload(envelope), time);
    }
  } catch {
    /* Unreadable lines stay off the board. */
  }
}

function closeNet() {
  if (abortController) abortController.abort();
  abortController = null;
  if (activeStream) {
    activeStream.close();
    activeStream = null;
  }
}

function showEmpty(message) {
  session += 1;
  closeNet();
  bots.clear();
  resetMeta();
  mode = "empty";
  connection = "empty";
  bannerText = message || "";
  render();
}

function showDemo() {
  session += 1;
  closeNet();
  resetMeta();
  resetBots();
  bannerText = "";
  mode = "demo";
  connection = "demo";
  const now = Math.floor(Date.now() / 1000);
  const resetAt = new Date(now * 1000 + 3 * 24 * 60 * 60 * 1000).toISOString();
  const line = (offset, body) => ({
    time: now - offset,
    event: "message",
    message: typeof body === "string" ? body : JSON.stringify(body),
  });
  for (const item of [
    line(600, { bot: "Moodle Bot", status: "working", step: "Forum prüfen" }),
    line(540, { bot: "Remnote Bot", status: "done", step: "Karten exportiert" }),
    line(480, { bot: "Obsidian Bot", status: "idle", step: "Wartet auf Notiz" }),
    line(420, { bot: "Kalender Bot", status: "waiting_user", step: "Termin bestätigen" }),
    line(360, { bot: "Slack Bot", status: "working", step: "Kanal zusammenfassen" }),
    line(300, { bot: "Deal Hunter", status: "error", step: "Shop nicht erreichbar" }),
    line(240, { bot: "Grok Bot", status: "working", step: "Antwort formulieren" }),
    line(200, { total_used_pct: 12, resets_at: resetAt, bots: { "Grok Bot": 100 } }),
    line(180, { bot: "Notiz Bot", status: "idle", step: "Wartet auf Eingang" }),
    line(120, "{ this is not json"),
    line(90, {
      usage: {
        total_used_pct: 64,
        resets_at: resetAt,
        bots: {
          "Grok Bot": 38,
          "Moodle Bot": 22,
          "Slack Bot": 16,
          "Kalender Bot": 12,
          "Deal Hunter": 7,
          "Remnote Bot": 5,
        },
      },
    }),
    line(80, { roster: ["Archiv Bot"] }),
    line(70, { groups: { "Archiv Bot": "Archive" } }),
    line(60, { chat: { "Grok Bot": "grokbot://open" } }),
    line(50, {
      looks: {
        "Grok Bot": { shape: "sphere", color: "#1E86FC", accessory: "antenna" },
        "Moodle Bot": { shape: "rounded_square", color: "#FD690F", accessory: "glasses" },
        "Remnote Bot": { shape: "bubble", color: "#8F59F9", accessory: "none" },
        "Obsidian Bot": { shape: "hexagon", color: "#000000", accessory: "none" },
        "Kalender Bot": { shape: "pill", color: "#14C16F", accessory: "none" },
        "Slack Bot": { shape: "clover", color: "#F93498", accessory: "none" },
        "Deal Hunter": { shape: "star6", color: "#F59312", accessory: "bow" },
      },
    }),
    line(40, {
      type: "storage",
      machine: "DrunkCarlsen",
      updated_at: new Date((now - 4 * 60) * 1000).toISOString(),
      drives: [
        { drive: "C:", label: "System", used_gb: 826.4, free_gb: 1035.6, total_gb: 1862, used_pct: 44.4 },
        { drive: "G:", label: "Data", used_gb: 141.7, free_gb: 258.3, total_gb: 400, used_pct: 35.4 },
      ],
    }),
  ]) {
    ingest(item);
  }
  render();
}

async function connect(topic) {
  const id = ++session;
  closeNet();
  resetMeta();
  resetBots();
  bannerText = "";
  mode = "live";
  connection = "connecting";
  render();

  const controller = new AbortController();
  abortController = controller;
  try {
    const response = await fetch(`https://ntfy.sh/${encodeURIComponent(topic)}/json?poll=1&since=12h`, {
      signal: controller.signal,
      headers: { Accept: "application/x-ndjson, application/json" },
    });
    if (id !== session) return;
    if (!response.ok) throw new Error("history");
    const text = await response.text();
    if (id !== session) return;
    const items = [];
    for (const line of text.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        items.push(JSON.parse(trimmed));
      } catch {
        /* Skip a broken history line. */
      }
    }
    items.sort((a, b) => (Number(a.time) || 0) - (Number(b.time) || 0));
    for (const item of items) ingest(item);
  } catch (error) {
    if (error.name === "AbortError" || id !== session) return;
    bannerText = "Verlauf nicht geladen. Neue Meldungen kommen trotzdem, sobald die Verbindung steht.";
  }
  if (id !== session) return;

  let stream;
  try {
    stream = new EventSource(`https://ntfy.sh/${encodeURIComponent(topic)}/sse`);
  } catch {
    connection = "error";
    bannerText = bannerText || "ntfy ist gerade nicht erreichbar.";
    render();
    return;
  }
  activeStream = stream;
  stream.addEventListener("message", (event) => {
    if (id !== session) return;
    try {
      ingest(JSON.parse(event.data));
    } catch {
      /* Ignore a live line that is not JSON. */
    }
    connection = "live";
    render();
  });
  stream.addEventListener("open", () => {
    if (id !== session) return;
    connection = "live";
    render();
  });
  stream.onerror = () => {
    if (id !== session) return;
    connection = stream.readyState === EventSource.CLOSED ? "error" : "reconnecting";
    render();
  };
  render();
}

function validateTopic(value) {
  if (!value) return "Bitte ein Thema eintragen.";
  if (value.toLowerCase() === "demo") return "„demo“ zeigt die Beispieldaten und ist kein Thema.";
  if (!TOPIC_RE.test(value)) return "Nur Buchstaben, Zahlen, Bindestrich und Unterstrich, höchstens 64 Zeichen.";
  return "";
}

function showTopicError(message) {
  ui.topicError.hidden = !message;
  ui.topicError.textContent = message || "";
  if (message) ui.topic.setAttribute("aria-invalid", "true");
  else ui.topic.removeAttribute("aria-invalid");
}

function applyRoute() {
  const hash = currentHash();
  if (hash.toLowerCase() === "demo") {
    showDemo();
    return;
  }
  if (hash) {
    clearHash();
    if (!TOPIC_RE.test(hash)) {
      showEmpty("Dieses URL-Fragment ist kein gültiges ntfy-Thema.");
      return;
    }
    storageSet(STORAGE_TOPIC, hash);
    connect(hash);
    return;
  }
  const stored = storageGet(STORAGE_TOPIC) || "";
  if (stored && TOPIC_RE.test(stored) && stored.toLowerCase() !== "demo") {
    connect(stored);
    return;
  }
  if (stored) storageSet(STORAGE_TOPIC, null);
  showEmpty("");
}

function linkProps(url) {
  if (!url) return null;
  const props = { href: url };
  if (/^https?:/i.test(url)) {
    props.target = "_blank";
    props.rel = "noopener noreferrer";
  }
  return props;
}

function botsInTeam(label) {
  const known = TEAMS.find((team) => team.label === label);
  const ordered = [];
  if (known) {
    for (const name of known.bots) {
      const bot = bots.get(name);
      if (bot && teamLabelFor(name) === label) ordered.push(bot);
    }
  }
  const extras = [...bots.values()]
    .filter((bot) => teamLabelFor(bot.name) === label && !ordered.includes(bot))
    .sort((a, b) => a.name.localeCompare(b.name, "de"));
  return ordered.concat(extras);
}

function teamSections() {
  const labels = TEAMS.filter((team) => team.id !== "other").map((team) => team.label);
  const custom = new Set();
  for (const bot of bots.values()) {
    const label = teamLabelFor(bot.name);
    if (!labels.includes(label) && label !== "Other") custom.add(label);
  }
  return [...labels, ...[...custom].sort((a, b) => a.localeCompare(b, "de")), "Other"]
    .map((label) => ({ label, id: teamIdFor(label), bots: botsInTeam(label) }))
    .filter((section) => section.bots.length);
}

function renderUsage() {
  if (!usagePlan) {
    ui.usage.hidden = true;
    ui.usage.replaceChildren();
    ui.usage.className = "";
    return;
  }
  const total = usagePlan.total;
  const reset = usagePlan.resetsAt ? formatReset(usagePlan.resetsAt) : "";
  ui.usage.hidden = false;
  ui.usage.className = "usage-card glass";
  ui.usage.replaceChildren(
    el("div", { class: "section-head" }, [el("h2", null, ["Nutzung"])]),
    el("div", { class: "usage-layout" }, [
      el(
        "div",
        {
          class: "ring",
          style: `--pct:${total == null ? 0 : total}`,
          role: "img",
          "aria-label": total == null ? "Wochenplan" : `${formatPct(total)} des Wochenplans`,
        },
        [el("strong", null, [total == null ? "–" : formatPct(total)])],
      ),
      el("div", null, [
        reset ? el("p", { class: "reset-time" }, [reset]) : null,
        el(
          "ul",
          { class: "shares" },
          usagePlan.shares.map((share) =>
            el("li", { class: "share" }, [
              el("span", { class: "share-name" }, [share.name]),
              el("span", { class: "share-pct" }, [formatPct(share.pct)]),
              el("span", { class: "bar", "aria-hidden": "true" }, [el("span", { style: `width:${share.pct}%` })]),
            ]),
          ),
        ),
      ]),
    ]),
  );
}

function renderDrive(drive) {
  const level = storageLevel(drive.usedPct);
  const pct = formatPct(drive.usedPct);
  const name = drive.label ? `${drive.drive} ${drive.label}` : drive.drive;
  const metaParts = [
    drive.usedGb != null ? `${formatGb(drive.usedGb)} belegt` : "",
    drive.freeGb != null ? `${formatGb(drive.freeGb)} frei` : "",
    drive.totalGb != null ? `${formatTotal(drive.totalGb)} gesamt` : "",
  ].filter(Boolean);
  const metaKids = [];
  metaParts.forEach((part, index) => {
    if (index) metaKids.push(" · ");
    metaKids.push(el("span", null, [part]));
  });
  const width = Math.min(100, Math.max(0, drive.usedPct));
  return el("li", { class: "drive" }, [
    el("div", { class: "drive-top" }, [
      el("span", { class: "drive-name" }, [
        drive.drive,
        drive.label ? el("span", { class: "drive-label" }, [drive.label]) : null,
      ]),
      el("span", { class: "drive-pct", "data-level": level }, [pct]),
    ]),
    el(
      "span",
      {
        class: "drive-track",
        "data-level": level,
        role: "meter",
        "aria-valuemin": "0",
        "aria-valuemax": "100",
        "aria-valuenow": String(Math.round(drive.usedPct * 10) / 10),
        "aria-label": `${name}, ${pct} belegt`,
      },
      [el("span", { style: `width:${width}%`, "aria-hidden": "true" })],
    ),
    metaKids.length ? el("p", { class: "drive-meta" }, metaKids) : null,
  ]);
}

function renderMachine(machine) {
  const stamp = machine.updatedAt ? formatStamp(machine.updatedAt) : "";
  const unix = machine.updatedMs ? Math.floor(machine.updatedMs / 1000) : 0;
  const when = unix
    ? el("p", { class: "storage-when" }, [
        "Aktualisiert ",
        el(
          "time",
          {
            datetime: machine.updatedAt || new Date(machine.updatedMs).toISOString(),
            "data-unix": String(unix),
          },
          [formatRelative(unix)],
        ),
        stamp ? ` · ${stamp}` : null,
      ])
    : stamp
      ? el("p", { class: "storage-when" }, [`Aktualisiert ${stamp}`])
      : null;
  return el("article", { class: "machine" }, [
    el("div", { class: "machine-head" }, [el("h3", null, [machine.machine]), when]),
    el("ul", { class: "drives" }, machine.drives.map(renderDrive)),
  ]);
}

function renderStorage() {
  const machines = [...storageByMachine.values()].sort((a, b) => a.machine.localeCompare(b.machine, "de"));
  ui.storage.hidden = false;
  ui.storage.className = "storage-card glass";
  ui.storage.replaceChildren(
    el("div", { class: "section-head" }, [
      el("h2", null, ["Speicherplatz"]),
      machines.length ? el("span", { class: "team-count" }, [String(machines.length)]) : null,
    ]),
    machines.length
      ? el("div", { class: "storage-list" }, machines.map(renderMachine))
      : el("p", { class: "calm" }, ["Noch keine Speicher-Meldung."]),
  );
}

function renderBoard() {
  const counts = { working: 0, done: 0, idle: 0, waiting_user: 0, error: 0 };
  for (const bot of bots.values()) {
    if (bot.seen && counts[bot.status] != null) counts[bot.status] += 1;
  }
  ui.counters.hidden = false;
  ui.counters.replaceChildren(
    ...["working", "done", "idle", "waiting_user", "error"].map((key) =>
      el("article", { class: "counter glass" }, [el("strong", null, [String(counts[key])]), el("span", null, [STATUS[key]])]),
    ),
  );

  renderUsage();
  renderStorage();

  const attention = [...bots.values()]
    .filter((bot) => bot.seen && (bot.status === "waiting_user" || bot.status === "error"))
    .sort((a, b) => {
      const rank = { waiting_user: 0, error: 1 };
      return rank[a.status] - rank[b.status] || a.name.localeCompare(b.name, "de");
    });
  ui.attention.hidden = false;
  ui.attention.replaceChildren(
    el("div", { class: "section-head" }, [el("h2", null, ["Braucht dich"]), el("span", { class: "team-count" }, [String(attention.length)])]),
    attention.length
      ? el(
          "div",
          { class: "chips" },
          attention.map((bot) => {
            const href = chatLinks.get(bot.name) || "";
            return el(href ? "a" : "article", { class: href ? "chip" : "chip", "data-status": bot.status, ...linkProps(href) }, [
              avatar(bot.name, true, bot.status),
              el("span", null, [el("strong", null, [bot.name]), el("span", null, [bot.step || STATUS[bot.status]])]),
            ]);
          }),
        )
      : el("p", { class: "calm" }, ["Gerade braucht dich niemand."]),
  );

  const groups = teamSections();
  ui.teams.hidden = false;
  ui.teams.replaceChildren(
    ...groups.map((group, index) => {
      const card = el("section", { class: "team glass", "data-team": group.id }, [
        el("div", { class: "team-head" }, [
          el("h2", { class: "team-name" }, [
            el("span", { class: "dot", style: `background:${dotColor(group.label)}`, "aria-hidden": "true" }),
            group.label,
          ]),
          el("span", { class: "team-count" }, [String(group.bots.length)]),
        ]),
        ...group.bots.map((bot) => renderBot(bot)),
      ]);
      card.style.animationDelay = `${index * 40}ms`;
      return card;
    }),
  );
}

function renderBot(bot) {
  const shown = bot.seen ? bot.status : "unknown";
  const href = chatLinks.get(bot.name) || "";
  return el(href ? "a" : "article", { class: "bot", "data-bot": bot.name, "data-status": shown, ...linkProps(href) }, [
    avatar(bot.name, false, shown === "unknown" ? "idle" : shown),
    el("div", null, [
      el("h3", null, [bot.name]),
      el("p", { class: "step" }, [bot.seen ? bot.step || "Kein Schritt genannt" : "Noch keine Meldung"]),
    ]),
    el("div", { class: "bot-meta" }, [
      el("span", { class: "status", "data-status": shown }, [STATUS[shown]]),
      bot.time
        ? el("time", { datetime: new Date(bot.time * 1000).toISOString(), "data-unix": String(bot.time) }, [formatRelative(bot.time)])
        : null,
    ]),
  ]);
}

function snapshot() {
  return JSON.stringify({
    mode,
    bannerText,
    usagePlan,
    roster: [...rosterNames],
    groups: [...groupOverrides],
    chat: [...chatLinks],
    looks: [...lookMap],
    storage: [...storageByMachine.values()],
    bots: [...bots.values()],
  });
}

function render() {
  ui.subtitle.textContent = mode === "demo" ? "Demo" : mode === "empty" ? "Bot-Status" : "Verbunden";
  ui.connection.textContent = CONNECTION_LABEL[connection] || connection;
  ui.connection.dataset.state = connection;
  ui.banner.hidden = !bannerText;
  ui.banner.textContent = bannerText;
  ui.reload.hidden = mode === "empty";
  const board = mode !== "empty";
  ui.empty.hidden = board;
  const signature = board ? snapshot() : `empty:${bannerText}`;
  if (signature === renderSignature) return;
  renderSignature = signature;
  if (!board) {
    ui.counters.hidden = true;
    ui.usage.hidden = true;
    ui.storage.hidden = true;
    ui.attention.hidden = true;
    ui.teams.hidden = true;
    ui.counters.replaceChildren();
    ui.usage.replaceChildren();
    ui.usage.className = "";
    ui.storage.replaceChildren();
    ui.storage.className = "";
    ui.attention.replaceChildren();
    ui.teams.replaceChildren();
    return;
  }
  renderBoard();
}

function tickTimes() {
  for (const node of document.querySelectorAll("time[data-unix]")) {
    node.textContent = formatRelative(Number(node.dataset.unix));
  }
}

function openSettings() {
  ui.topic.value = storageGet(STORAGE_TOPIC) || "";
  ui.topic.type = "password";
  ui.topicToggle.textContent = "Anzeigen";
  ui.topicToggle.setAttribute("aria-pressed", "false");
  ui.topicToggle.setAttribute("aria-label", "Thema anzeigen");
  showTopicError("");
  applyTheme(currentTheme());
  ui.dialog.showModal();
  ui.topic.focus();
}

function chooseTheme(theme) {
  storageSet(STORAGE_THEME, theme);
  applyTheme(theme);
}

function bind() {
  ui.openSettings.addEventListener("click", openSettings);
  ui.emptySettings.addEventListener("click", openSettings);
  ui.closeSettings.addEventListener("click", () => ui.dialog.close());
  ui.reload.addEventListener("click", () => applyRoute());
  ui.topicToggle.addEventListener("click", () => {
    const visible = ui.topic.type === "password";
    ui.topic.type = visible ? "text" : "password";
    ui.topicToggle.textContent = visible ? "Verbergen" : "Anzeigen";
    ui.topicToggle.setAttribute("aria-pressed", visible ? "true" : "false");
    ui.topicToggle.setAttribute("aria-label", visible ? "Thema verbergen" : "Thema anzeigen");
  });
  ui.dialog.addEventListener("click", (event) => {
    if (event.target === ui.dialog) ui.dialog.close();
  });
  ui.form.addEventListener("submit", (event) => {
    event.preventDefault();
    const value = ui.topic.value.trim();
    const error = validateTopic(value);
    if (error) {
      showTopicError(error);
      ui.topic.focus();
      return;
    }
    showTopicError("");
    storageSet(STORAGE_TOPIC, value);
    ui.dialog.close();
    clearHash();
    connect(value);
  });
  ui.clearTopic.addEventListener("click", () => {
    storageSet(STORAGE_TOPIC, null);
    ui.topic.value = "";
    showTopicError("");
    ui.dialog.close();
    if (currentHash().toLowerCase() === "demo") applyRoute();
    else {
      clearHash();
      showEmpty("");
    }
  });
  for (const link of ui.dialog.querySelectorAll('a[href="#demo"]')) {
    link.addEventListener("click", () => ui.dialog.close());
  }
  ui.themeGroup.addEventListener("click", (event) => {
    const button = event.target.closest("[data-theme-choice]");
    if (button) chooseTheme(button.dataset.themeChoice);
  });
  ui.themeGroup.addEventListener("keydown", (event) => {
    if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
    const buttons = [...ui.themeGroup.querySelectorAll("[data-theme-choice]")];
    const index = buttons.indexOf(document.activeElement);
    if (index < 0) return;
    event.preventDefault();
    const next = buttons[(index + (event.key === "ArrowRight" ? 1 : -1) + buttons.length) % buttons.length];
    next.focus();
    chooseTheme(next.dataset.themeChoice);
  });
  window.addEventListener("hashchange", () => {
    if (ui.dialog.open) ui.dialog.close();
    applyRoute();
  });
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
    if (currentTheme() === "system") applyTheme("system");
  });
  ui.installHintAction.addEventListener("click", async () => {
    if (!deferredInstall) return;
    deferredInstall.prompt();
    const choice = await deferredInstall.userChoice;
    deferredInstall = null;
    if (choice && choice.outcome === "accepted") ui.installHint.hidden = true;
  });
  ui.installHintDismiss.addEventListener("click", () => {
    storageSet(INSTALL_HINT_KEY, "off");
    ui.installHint.hidden = true;
  });
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    deferredInstall = event;
    syncInstallHint();
  });
  window.addEventListener("appinstalled", () => {
    deferredInstall = null;
    ui.install.hidden = true;
    ui.installHint.hidden = true;
  });
  for (const query of ["(display-mode: browser)", "(display-mode: standalone)", "(display-mode: window-controls-overlay)"]) {
    window.matchMedia(query).addEventListener("change", syncInstallHint);
  }
}

function syncInstallHint() {
  const inBrowser = window.matchMedia("(display-mode: browser)").matches;
  ui.installHint.hidden = !inBrowser || storageGet(INSTALL_HINT_KEY) === "off";
}

function registerWorker() {
  if (!("serviceWorker" in navigator)) return;
  navigator.serviceWorker.register("./sw.js", { scope: "./", updateViaCache: "none" }).catch(() => {
    /* The page still works; installation waits until the worker can be fetched. */
  });
}

applyTheme(currentTheme());
bind();
syncInstallHint();
applyRoute();
registerWorker();
setInterval(tickTimes, 30000);
