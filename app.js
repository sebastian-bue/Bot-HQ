const STORAGE_TOPIC = "hq.topic";
const STORAGE_THEME = "hq.theme";
const TOPIC_RE = /^[A-Za-z0-9_-]{1,64}$/;

const TEAMS = [
  { id: "study", label: "Study", bots: ["Moodle Bot", "Remnote Bot", "Obsidian Bot"] },
  { id: "planning", label: "Planning", bots: ["Kalender Bot", "Slack Bot"] },
  { id: "shopping", label: "Shopping", bots: ["Deal Hunter"] },
  { id: "ops", label: "Ops", bots: ["Grok Bot"] },
  { id: "other", label: "Other", bots: [] },
];

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

const AVATAR = {
  "Moodle Bot": ["#3d5afe", "#9eb0ff"],
  "Remnote Bot": ["#ef6c45", "#ffb199"],
  "Obsidian Bot": ["#6d4aff", "#c4b5ff"],
  "Kalender Bot": ["#0f8f78", "#7ddec8"],
  "Slack Bot": ["#c2185b", "#ff8ab3"],
  "Deal Hunter": ["#c4840a", "#ffd27a"],
  "Grok Bot": ["#1473e6", "#8ec5ff"],
};

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
  openSettings: document.querySelector("#open-settings"),
  emptySettings: document.querySelector("#empty-settings"),
  banner: document.querySelector("#banner"),
  counters: document.querySelector("#counters"),
  attention: document.querySelector("#attention"),
  notes: document.querySelector("#notes"),
  empty: document.querySelector("#empty"),
  teams: document.querySelector("#teams"),
  dialog: document.querySelector("#settings"),
  form: document.querySelector("#settings-form"),
  topic: document.querySelector("#topic-input"),
  topicError: document.querySelector("#topic-error"),
  closeSettings: document.querySelector("#close-settings"),
  clearTopic: document.querySelector("#clear-topic"),
  themeGroup: document.querySelector(".segment"),
};

const bots = new Map();
let notes = [];
let bannerText = "";
let mode = "empty";
let connection = "empty";
let activeTopic = "";
let session = 0;
let abortController = null;
let activeStream = null;
let renderSignature = "";
let deferredInstall = null;

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
    /* Private mode can block storage; the hash still works for this visit. */
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
  if (meta) meta.setAttribute("content", themeIsDark(theme) ? "#07090d" : "#e7edf5");
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

function canonicalName(name) {
  const clean = String(name).trim().replace(/\s+/g, " ");
  for (const team of TEAMS) {
    for (const bot of team.bots) {
      if (bot.toLowerCase() === clean.toLowerCase()) return bot;
    }
  }
  return clean;
}

function teamFor(name) {
  const team = TEAMS.find((item) => item.bots.includes(name));
  return team ? team.id : "other";
}

function hashHue(name) {
  let hash = 0;
  for (const char of name) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return hash % 360;
}

function avatarBackground(name) {
  const preset = AVATAR[name];
  if (preset) return `linear-gradient(145deg, ${preset[0]}, ${preset[1]})`;
  const hue = hashHue(name);
  return `linear-gradient(145deg, hsl(${hue} 70% 42%), hsl(${(hue + 26) % 360} 78% 62%))`;
}

function initials(name) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
}

function avatar(name, small) {
  return el("span", { class: small ? "avatar sm" : "avatar", style: `background:${avatarBackground(name)}`, "aria-hidden": "true" }, [
    initials(name),
  ]);
}

function formatRelative(unix) {
  if (!unix) return "";
  const delta = Math.max(0, Date.now() / 1000 - unix);
  if (delta < 45) return "gerade eben";
  if (delta < 3600) return `vor ${Math.max(1, Math.round(delta / 60))} Min.`;
  if (delta < 86400) return `vor ${Math.max(1, Math.round(delta / 3600))} Std.`;
  return new Intl.DateTimeFormat("de-DE", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(unix * 1000));
}

function formatNumber(value) {
  return typeof value === "number" ? new Intl.NumberFormat("de-DE").format(value) : String(value);
}

function formatUsage(data) {
  if (!data || typeof data !== "object" || Array.isArray(data)) return "";
  const usage = data.usage ?? data.tokens ?? null;
  if (typeof usage === "string") return usage.trim().slice(0, 160);
  if (typeof usage === "number") return `${formatNumber(usage)} Tokens`;
  const source = usage && typeof usage === "object" ? usage : data;
  const hasUsage =
    usage != null ||
    ["input_tokens", "output_tokens", "total_tokens", "prompt_tokens", "completion_tokens", "cost"].some(
      (key) => key in data || (usage && typeof usage === "object" && key in usage),
    );
  const input = source.input ?? source.input_tokens ?? source.prompt_tokens;
  const output = source.output ?? source.output_tokens ?? source.completion_tokens;
  const total = source.total ?? source.total_tokens;
  const cost = source.cost ?? source.usd;
  if (!hasUsage && input == null && output == null && total == null && cost == null) return "";
  const parts = [];
  if (input != null) parts.push(`${formatNumber(input)} in`);
  if (output != null) parts.push(`${formatNumber(output)} out`);
  if (total != null && input == null && output == null) parts.push(`${formatNumber(total)} Tokens`);
  if (cost != null) parts.push(typeof cost === "number" ? `${formatNumber(cost)} Kosten` : String(cost));
  return parts.join(" · ").slice(0, 160);
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

function interpretObject(data) {
  if (!data || typeof data !== "object" || Array.isArray(data)) return { kind: "note", text: "Unlesbare Meldung" };
  const name = pickString(data, ["bot", "name"]);
  const bot = name ? canonicalName(name) : "";
  const hadStatus = data.status != null || data.state != null;
  const status = normalizeStatus(data.status ?? data.state);
  const step = pickString(data, ["step", "label", "detail"]);
  const usage = formatUsage(data);
  if (hadStatus && !status) return { kind: "note", text: `Unbekannter Status${bot ? ` von ${bot}` : ""}` };
  if (!bot && !status && !usage && step == null) return { kind: "note", text: "Unlesbare Meldung" };
  if (!status && usage && step == null) return { kind: "usage", bot, usage };
  if (!bot) return { kind: "note", text: usage || step || "Meldung ohne Bot" };
  return { kind: "status", bot, status, step, usage };
}

function interpretPlain(text) {
  const usageLine = text.match(/^(.{1,48}?)\s+usage\b[:\s-]*(.+)$/i);
  if (usageLine) {
    return { kind: "usage", bot: canonicalName(usageLine[1]), usage: usageLine[2].trim().slice(0, 160) };
  }
  if (/usage|tokens?|kosten|\bcost\b/i.test(text)) return { kind: "note", text: text.slice(0, 180) };
  if (text.startsWith("{") || text.startsWith("[")) return { kind: "note", text: "Unlesbare Meldung" };
  return { kind: "ignore" };
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
    return interpretPlain(String(data));
  } catch {
    return interpretPlain(text);
  }
}

function pushNote(text) {
  const clean = String(text).replace(/\s+/g, " ").trim().slice(0, 180);
  if (!clean || notes.includes(clean)) return;
  notes.push(clean);
  if (notes.length > 4) notes.shift();
}

function resetBots() {
  bots.clear();
  for (const team of TEAMS) {
    for (const name of team.bots) {
      bots.set(name, { name, status: "idle", step: "", usage: "", time: 0, seen: false });
    }
  }
}

function applyParsed(parsed, time) {
  if (!parsed || parsed.kind === "ignore" || parsed.kind === "empty") return;
  if (parsed.kind === "note") {
    pushNote(parsed.text);
    return;
  }
  if (parsed.kind === "usage") {
    const existing = parsed.bot ? bots.get(parsed.bot) : null;
    if (!existing) {
      pushNote(parsed.bot ? `${parsed.bot}: ${parsed.usage}` : parsed.usage);
      return;
    }
    existing.usage = parsed.usage;
    if (time) existing.time = Math.max(existing.time || 0, time);
    return;
  }
  const bot = bots.get(parsed.bot) || {
    name: parsed.bot,
    status: "idle",
    step: "",
    usage: "",
    time: 0,
    seen: false,
  };
  if (bot.time && time && time < bot.time) return;
  bots.set(parsed.bot, bot);
  if (parsed.status) bot.status = parsed.status;
  if (parsed.step != null) bot.step = parsed.step;
  if (parsed.usage) bot.usage = parsed.usage;
  bot.seen = true;
  if (time) bot.time = time;
}

function ingest(envelope) {
  try {
    if (!envelope || typeof envelope !== "object") return;
    if (envelope.event && envelope.event !== "message") return;
    if (typeof envelope.message === "string" || (envelope.message && typeof envelope.message === "object")) {
      applyParsed(parsePayload(envelope.message), Number(envelope.time) || 0);
      return;
    }
    if (envelope.bot || envelope.status || envelope.name) applyParsed(parsePayload(envelope), Number(envelope.time) || 0);
  } catch {
    pushNote("Unlesbare Meldung");
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
  notes = [];
  activeTopic = "";
  mode = "empty";
  connection = "empty";
  bannerText = message || "";
  render();
}

function showDemo() {
  session += 1;
  closeNet();
  resetBots();
  notes = [];
  bannerText = "";
  activeTopic = "";
  mode = "demo";
  connection = "demo";
  const now = Math.floor(Date.now() / 1000);
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
    line(400, "Kalender Bot usage: 2 Anfragen"),
    line(360, { bot: "Slack Bot", status: "working", step: "Kanal zusammenfassen" }),
    line(300, { bot: "Deal Hunter", status: "error", step: "Shop nicht erreichbar" }),
    line(240, { bot: "Grok Bot", status: "working", step: "Antwort formulieren", usage: { input: 1240, output: 380 } }),
    line(180, { bot: "Notiz Bot", status: "idle", step: "Wartet auf Eingang" }),
    line(120, "{ this is not json"),
  ]) {
    ingest(item);
  }
  render();
}

// History: https://ntfy.sh/<topic>/json?poll=1&since=12h
// Live:    https://ntfy.sh/<topic>/sse
async function connect(topic) {
  const id = ++session;
  closeNet();
  resetBots();
  notes = [];
  bannerText = "";
  activeTopic = topic;
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
        pushNote("Unlesbare Meldung");
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
      pushNote("Unlesbare Meldung");
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

function setHash(value) {
  const next = value ? `#${encodeURIComponent(value)}` : "";
  const target = `${location.pathname}${location.search}${next}`;
  if (`${location.pathname}${location.search}${location.hash}` !== target) history.replaceState(null, "", target);
  applyRoute();
}

function applyRoute() {
  const hash = currentHash();
  if (hash.toLowerCase() === "demo") {
    showDemo();
    return;
  }
  if (hash) {
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

function orderedBots(team) {
  const known = team.bots.map((name) => bots.get(name)).filter(Boolean);
  const extras = [...bots.values()]
    .filter((bot) => teamFor(bot.name) === team.id && !team.bots.includes(bot.name))
    .sort((a, b) => a.name.localeCompare(b.name, "de"));
  return known.concat(extras);
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
          attention.map((bot) =>
            el("article", { class: "chip", "data-status": bot.status }, [
              avatar(bot.name, true),
              el("span", null, [el("strong", null, [bot.name]), el("span", null, [bot.step || STATUS[bot.status]])]),
            ]),
          ),
        )
      : el("p", { class: "calm" }, ["Gerade braucht dich niemand."]),
  );

  ui.notes.hidden = notes.length === 0;
  ui.notes.replaceChildren(el("h2", null, ["Hinweise"]), el("ul", null, notes.map((text) => el("li", null, [text]))));

  const groups = TEAMS.map((team) => ({ team, bots: orderedBots(team) })).filter(
    (group) => group.team.id !== "other" || group.bots.length,
  );
  ui.teams.hidden = false;
  ui.teams.replaceChildren(
    ...groups.map((group, index) => {
      const card = el("section", { class: "team glass", "data-team": group.team.id }, [
        el("div", { class: "team-head" }, [
          el("h2", { class: "team-name" }, [el("span", { class: "dot", "aria-hidden": "true" }), group.team.label]),
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
  return el("article", { class: "bot", "data-bot": bot.name, "data-status": shown }, [
    avatar(bot.name),
    el("div", null, [
      el("h3", null, [bot.name]),
      el("p", { class: "step" }, [bot.seen ? bot.step || "Kein Schritt genannt" : "Noch keine Meldung"]),
      bot.usage ? el("p", { class: "usage" }, [bot.usage]) : null,
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
    notes,
    bots: [...bots.values()],
  });
}

function render() {
  ui.subtitle.textContent = mode === "demo" ? "Demo" : mode === "empty" ? "Bot-Status" : activeTopic;
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
    ui.attention.hidden = true;
    ui.notes.hidden = true;
    ui.teams.hidden = true;
    ui.counters.replaceChildren();
    ui.attention.replaceChildren();
    ui.notes.replaceChildren();
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
  const hash = currentHash();
  const stored = storageGet(STORAGE_TOPIC) || "";
  ui.topic.value = hash && hash.toLowerCase() !== "demo" && TOPIC_RE.test(hash) ? hash : stored;
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
    setHash(value);
  });
  ui.clearTopic.addEventListener("click", () => {
    storageSet(STORAGE_TOPIC, null);
    ui.topic.value = "";
    showTopicError("");
    ui.dialog.close();
    if (currentHash().toLowerCase() === "demo") applyRoute();
    else setHash("");
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
  ui.install.addEventListener("click", async () => {
    if (!deferredInstall) {
      openSettings();
      return;
    }
    deferredInstall.prompt();
    await deferredInstall.userChoice;
    deferredInstall = null;
    ui.install.hidden = true;
  });
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    deferredInstall = event;
    ui.install.hidden = false;
  });
  window.addEventListener("appinstalled", () => {
    deferredInstall = null;
    ui.install.hidden = true;
  });
}

function setupInstallButton() {
  const standalone = window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
  if (!standalone) ui.install.hidden = false;
}

function registerWorker() {
  if (!("serviceWorker" in navigator)) return;
  navigator.serviceWorker.register("./sw.js", { scope: "./", updateViaCache: "none" }).catch(() => {
    /* The page still works; installation waits until the worker can be fetched. */
  });
}

applyTheme(currentTheme());
bind();
setupInstallButton();
applyRoute();
registerWorker();
setInterval(tickTimes, 30000);
