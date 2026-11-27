# HQ

Installierbare Status-Tafel für Bots. Statische PWA, kein Build. Die Oberfläche ist Deutsch, die Optik angelehnt an Apples Liquid Glass.

Live-Ziel: <https://sebastian-bue.github.io/Bot-HQ/>

## Nutzen

1. Seite öffnen.
2. In den Einstellungen ein ntfy-Thema eintragen **oder** es einmalig als Fragment an die Adresse hängen. Danach wird das Fragment entfernt.
3. `#demo` zeigt Beispieldaten und kontaktiert ntfy nicht.

Das Thema liegt nur in `localStorage` dieses Browsers. Es wird nicht angezeigt, steht nicht im Quellcode und wird nicht mitgeliefert. Es muss ohne Zugangsschlüssel lesbar sein.

Jede Statuszeile ist JSON:

```json
{"bot":"Grok Bot","status":"working","step":"kurze Bezeichnung"}
```

`status` ist einer von `working`, `done`, `idle`, `waiting_user`, `error`. Weitere Zeilen: `usage` (Wochenplan mit `total_used_pct`, `resets_at`, `bots`), `roster`, `groups`, `chat`, `looks` und `storage` (Speicherplatz je Rechner: `machine`, `updated_at`, `drives` mit belegtem, freiem und gesamtem Platz in GB). Pro Rechner gilt der neueste Stand nach `updated_at`. Unbekannte Zeilen werden still ignoriert.

- Verlauf: `https://ntfy.sh/<THEMA>/json?poll=1&since=12h`
- Live: `https://ntfy.sh/<THEMA>/sse`

Gruppen: Study (Moodle Bot, Remnote Bot, Obsidian Bot), Planning (Kalender Bot, Slack Bot), Shopping (Deal Hunter), Ops (Grok Bot). Unbekannte Bots erscheinen unter Other.

## Installieren

Chrome und Edge unter Windows bieten „Installieren“, sobald der Service Worker aktiv ist. Auf dem iPad: Teilen → Zum Home-Bildschirm.

## Veröffentlichen

`.github/workflows/pages.yml` lädt das Repository-Stammverzeichnis ohne Build-Schritt zu GitHub Pages hoch. Quelle dafür ist **GitHub Actions**, nicht ein Branch.

Falls Pages noch nicht so eingestellt ist: Repository → Settings → Pages → Build and deployment → Source: **GitHub Actions**. Danach den Workflow „Deploy GitHub Pages“ erneut starten.

## Lokal

```sh
python3 -m http.server 8080
```

Dann `http://127.0.0.1:8080/#demo` öffnen. Alle Pfade sind relativ, damit die App unter `/Bot-HQ/` funktioniert.
