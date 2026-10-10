# aPuppet server – review & guide to run it on the existing Janus

Written for: the server owner who already has Janus installed and wants to run aPuppet on it instead of the bundled Docker stack.

## 1. What this repo is

aPuppet server = a **thin deployment wrapper** around Janus plus a **static web app**. There is no custom backend code.

| Piece | Where | Role |
|---|---|---|
| `web-admin/` | static HTML/JS (jQuery, Bootstrap, `janus.js`, gulp build) | Operator UI. Talks directly to Janus from the browser |
| `deploy/` | Ansible playbooks + Jinja templates + Dockerfiles | Installs Docker, builds/pulls Janus 0.10.7, nginx, certbot; renders configs |
| `config.yaml` | `hostname`, `email` | Only required user input |
| `deploy/config.defaults.yaml` | ports, RTP range, flags | Defaults |

### Runtime flow (from `web-admin/js/remote-admin.js`, `remote-video.js`, `remote-chat.js`)

1. Browser opens a Janus session (`apisecret` taken from `settings.js`).
2. Attaches **two plugins**: `janus.plugin.textroom` (data channel: gestures, back/home/recents, chat) and `janus.plugin.streaming` (screen video).
3. Operator enters the device's `Session ID` + `Password`.
   - Streaming: `{"request":"watch","id":<sessionId>,"pin":<password>}`
   - TextRoom: `join` room `<sessionId>` with `pin`.
4. The **Android app** creates the mountpoint and room itself (via the Janus API using the shared API secret), so no mountpoints/rooms are pre-defined in config.

Only the **streaming** and **textroom** plugins are needed. Everything else in the Janus install is unused.

## 2. State of this server (verified)

- Janus **1.4.1** at `/opt/janus` (binary `/opt/janus/bin/janus`), running as user `janus` (PID 297).
- Listening: HTTP **8088**, WebSocket **8188**. No HTTPS/WSS, no admin API.
- `GET http://localhost:8088/janus/info` works. Plugins present: streaming, textroom, videoroom, audiobridge, etc.
- **No `api_secret` set** (`"api_secret": false`); `admin_secret = "janusoverlord"` (default).
- Streaming config is still the **stock sample** (`id = 1,2,3,123`, `secret = "adminpwd"`); no `string_ids`, no `rtp_port_range`.
- nginx now fronts Janus for the local network (see §5.6, site `janus-server`, port 8080). No Docker check done. Config dir `/opt/janus/etc/janus` is `root:janus`, and I have no passwordless sudo, so **I changed nothing** on the system.

## 3. Gaps between the repo's assumptions and this server

| # | Repo expects | This server | Action |
|---|---|---|---|
| 1 | Janus **0.10.7** | **1.4.1** | Config syntax compatible; see risks in §6 |
| 2 | `string_ids = true` in streaming **and** textroom | not set (numeric ids) | **Must set** – app/web-admin use string ids (`pin`, session ids) |
| 3 | `api_secret` shared with the app | none | Set a secret; put the same one in `settings.js` and the Android app |
| 4 | `rtp_port_range = 10000-10500` | default | Set, and open UDP 10000-10500 |
| 5 | Config path `/usr/local/etc/janus` | `/opt/janus/etc/janus` | Edit the real paths, not the template's |
| 6 | HTTPS/WSS via Let's Encrypt, host `hostname` | plain HTTP/WS on the local network only | Fine for `http://` pages on the LAN; TLS only needed for https pages (§5.7) |
| 7 | nginx serves `/web-admin/` and proxies `/janus` | nginx `janus-server` site serves web-admin on `/` and proxies `/janus`, `/ws`, `/admin` on :8080 | `make nginx-install` (§5.6) |
| 8 | CORS `allow_origin` = site origin | same origin (page and API on :8080), no CORS needed | Leave Janus `cors` unset; nginx hides Janus' CORS headers |
| 9 | Static plugin ports for sample mountpoints | samples enabled | Remove sample mountpoints (they bind UDP 5002–5106 and use a known secret) |

## 4. What to skip from the repo

Do **not** run `install.sh`. It installs Ansible, Docker and docker-compose, requires Ubuntu 16.04/18.04/20.04, requires a public DNS name resolving to this host, and starts its **own** Janus 0.10.7 container on host networking (ports 8088/8089/8989), which would collide with your Janus. Use only `web-admin/` and the config templates as reference.

## 5. Step-by-step: run aPuppet on the existing Janus

Pick a secret first: `API_SECRET=$(openssl rand -hex 8)` (the repo uses 8 alphanumeric chars).

### 5.1 Janus core – `/opt/janus/etc/janus/janus.jcfg`
```
general: {
    api_secret = "<API_SECRET>"
    admin_secret = "<change from janusoverlord>"
}
```
Keep `ice_ignore_list`, and if the server is behind NAT/cloud add `nat: { nat_1_1_mapping = "<public IP>" }`.

### 5.2 Streaming – `janus.plugin.streaming.jcfg`
Replace the sample mountpoints with:
```
general: {
    rtp_port_range = "10000-10500"
    string_ids = true
}
```
(Delete `rtp-sample`, `multistream-test`, `file-live-sample`, `file-ondemand-sample`, etc.)

### 5.3 TextRoom – `janus.plugin.textroom.jcfg`
```
general: {
    json = "indented"
    string_ids = true
}
```
(Template also keeps whatever `admin_key`/`room` defaults you don't use – none are required.)

### 5.4 HTTP / WebSocket transports
`janus.transport.http.jcfg` – keep `http = true`, `port = 8088`, `base_path = "/janus"`. Do **not** set `cors` here: the page and API share one origin via nginx (§5.6).
`janus.transport.websockets.jcfg` – `ws = true`, `ws_port = 8188` is already fine.
Admin API (optional): in `janus.transport.http.jcfg` set `admin_http = true`, `admin_port = 7088`; nginx exposes it on `/admin` for localhost only.

Restart (as root): `sudo systemctl restart janus` (check the unit name; or kill and restart `/opt/janus/bin/janus` as user `janus`).
Verify: `curl -s localhost:8088/janus/info | grep -E 'api_secret|string'` – `api_secret` should now be `true`.

### 5.4b Open ports
**TCP 8080** (nginx: web-admin + Janus HTTP/WS API for LAN clients), **UDP 10000–10500** (RTP). 8088/8188/7088 only need to be reachable from nginx on 127.0.0.1; do not open them to the LAN. On WSL2 the host must also forward these (WSL2 uses NAT; mirrored networking mode or `netsh portproxy` is required for devices outside this machine).

### 5.5 Build the web-admin
Needs Node (repo uses 15.2 in Docker; any modern LTS should work):
```bash
cd web-admin
npm init --yes
npm install --save-dev gulp gulp-clean gulp-size gulp-concat gulp-clean-css gulp-terser
mkdir -p dist && npx gulp
```
This produces `web-admin/dist/{css,js}`. Then create `dist/js/settings.js` (rendered from `deploy/templates/web-admin/settings.js.j2`). Minimal plain-HTTP version:
```js
var opaqueId = Janus.randomString(12);
var streamingOpaqueId = "streaming-" + opaqueId;
var textroomOpaqueId = "textroom-" + opaqueId;
var apiSecret = "<API_SECRET>";
var janusDebugLevel = ['warn','error'];
toastr.options = { "progressBar": true, "positionClass": "toast-top-right", "timeOut": 5000 };
var janusServers = [ `http://${window.location.hostname}:8080/janus` ];
// WebSocket alternative: `ws://${window.location.hostname}:8080/ws`
```
Check `index.html` for the exact script/style paths it loads from `dist/` and mirror the layout the Ansible task produces (`dist/web-admin/` = `index.html`, `static/`, `dist/`).

### 5.6 nginx: web-admin + Janus on one origin (local network)
The repo ships the site as `nginx/janus-server.conf`; `make nginx-install` builds web-admin, copies it to `/var/www/apuppet-web-admin` (nginx's `www-data` cannot read under `/home`), installs the site as `/etc/nginx/sites-available/janus-server`, enables it, runs `nginx -t` and reloads. Plain HTTP, local network only.

| URL | Serves / proxies to | Notes |
|---|---|---|
| `http://<laptop-ip>:8080/` | static `web-admin` (`/var/www/apuppet-web-admin`) | `location /`, `index.html` |
| `http://<laptop-ip>:8080/janus` | `127.0.0.1:8088` | REST + long-polling, buffering off, 120 s read timeout |
| `ws://<laptop-ip>:8080/ws` | `127.0.0.1:8188` | WebSocket upgrade, 3600 s timeouts |
| `http://localhost:8080/admin` | `127.0.0.1:7088` | `allow 127.0.0.1, ::1; deny all` |

The page and the API share the origin `:8080`, so **no CORS headers are needed**. Janus' own `Access-Control-Allow-Origin` etc. are hidden with `proxy_hide_header` in `location /janus`; otherwise a browser would see a duplicated header (nginx `add_header` + Janus) and fail with `Error connecting to any of the provided Janus servers: Is the server down?`. Do not re-add `add_header Access-Control-*` there. Names differ from the repo's `janus.nginx.conf`, so both sites can be enabled together.

`settings.js` (written by `make web`) points `janusServers` at `http://<host>:8080/janus`, i.e. the nginx port; the Android app's server URL is `http://<laptop-ip>:8080`.

Verify: `curl -s http://localhost:8080/janus/info` returns the Janus info JSON, `curl -sI http://localhost:8080/` returns 200 (HTML), and
`curl -si -X POST -d '{"janus":"create","transaction":"t"}' localhost:8080/janus | grep -ci allow-origin` prints `1` or `0`, never `2`.

After rebuilding web-admin, run `make nginx-install` again to republish. `make serve` (port 8075) remains as a standalone alternative; in that case `settings.js` still calls nginx on :8080 cross-origin, which needs CORS headers, so prefer the nginx-served page.

### 5.7 HTTPS (recommended)
Browsers block `http://` Janus calls from an `https://` page, and Android screen-share signalling from the public app expects TLS. Options: add a TLS `server` block (certbot) in front of the existing `janus-server` locations (`/janus`, `/ws`); the current site is HTTP-only on 8080. Alternatively enable `https`/`wss` in the Janus transports with a certificate (`cert_pem`, `cert_key`) as the repo templates do (ports 8089/8989).

### 5.8 Android agent
Install the aPuppet app from https://github.com/h-mdm/apuppet-android (or build your own), set **server URL** to your site and **secret** to `<API_SECRET>`, grant the accessibility + overlay permissions, then enter the shown Session ID/Password in the web UI.

## 6. Risks and things I could not verify

1. **Janus 1.4.1 vs 0.10.7** – the app was written against 0.10.x. 1.x changed the Streaming plugin API (multistream, `watch` → `start` offer/answer flow, `jsep` handling in `janus.js`) and the bundled `web-admin/js/janus.js` is an old version. Most likely points of failure: the Android app creating mountpoints with 0.10-style parameters, and the web client's `watch` handling. **If it fails, the safest path is running the repo's pinned Janus 0.10.7 (Docker image `headwindmdm/janus-gateway:0.10.7`) on different ports.** I did not test the real flow end to end (no device).
2. **Textroom `setup` request / data channel** – relies on textroom plugin 0.0.2; present here, but behaviour not tested.
3. **Plain HTTP only** right now – secrets (`apisecret`, PINs) travel in clear text. Do not expose publicly without TLS.
4. **API secret is a weak 8-char shared value** embedded in client-side JS; anyone who can load the web UI can read it and create sessions. Put the web UI behind auth (nginx basic auth/VPN) if exposing it. The nginx site's `Access-Control-Allow-Origin: *` is acceptable on a trusted LAN only; restrict it before any wider exposure.
5. `deploy/templates/janus/janus.jcfg.j2` sets `dtls_accept_selfsigned = true`, and Docker build uses BoringSSL with `--enable-dtls-settimeout`; the distro OpenSSL build here (3.0.x) lacks that tweak – DTLS handshake retries may be slower on lossy networks.
6. Repo hygiene: upstream README references `cd remote-control` (wrong dir name), says Ansible 2.9 only, Ubuntu ≤20.04 only; nginx runs as `user root`, resolver hard-coded to 8.8.8.8. Not relevant if you don't use the installer.
7. I did not modify any files on the system or in the repo other than creating this document.

## 7. Recommended order

1. Apply §5.1–5.4, restart Janus, check `/janus/info`.
2. Build web-admin (§5.5) and serve it (§5.6); confirm the page shows "streaming/textroom ready" with no attach errors in the browser console.
3. Pair a real Android device. If the Streaming/TextRoom handshake fails, fall back to Janus 0.10.7 as noted in risk 1.
4. Add TLS and restrict access (§5.7, risk 4).
