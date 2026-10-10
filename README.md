# aPuppet - the open source remote control software for Android

## Summary

aPuppet is the open source engine providing remote access to Android-based devices for the purpose of technical support and maintenance. Devices are controlled from a web-based application.

The software consists of:

- [Janus](https://janus.conf.meetecho.com/). Media server for screen sharing and gesture delivery
- [nginx](https://nginx.org/). Web server for hosting the web application
- web-admin. Web application for the remote control of mobile devices (gulp build)
- app. BaseUI (Owl) web app served from `app/`, with web-admin mounted on `/admin/`
- `app-server.py`. Small Python static server for `app/` that also proxies `/janus` to nginx
- `deploy.sh`. Packages `dist/` and deploys it to the production host

This project is the server module. The source code of the mobile agent is available at https://github.com/h-mdm/apuppet-android and also on [Google Play](https://play.google.com/store/apps/details?id=com.hmdm.control).

### Repository status

The Ansible/Docker deploy stack has been removed; installation is driven by the `Makefile` on top of a native Janus install.

| Component | Path | Status |
| --- | --- | --- |
| Makefile install/serve tooling | `Makefile` | Active (targets listed below) |
| web-admin | `web-admin/` | Active, built to `dist/web-admin` |
| BaseUI app | `app/` | Active, built to `dist/app`, served by `app-server.py` |
| Release deploy | `deploy.sh` | Active, ships `dist/` to `base_150:/opt/services/sites/webrtc.thebase.vn/current` |
| nginx site template | `nginx/janus-server.conf` | **Missing from the repo**: `make nginx-install` fails until it is restored |
| `REVIEW-JANUS-NATIVE.md` | - | Referenced by the Makefile but not present in the repo |
| certbot / Docker / Ansible | - | Removed; HTTPS is handled outside this repo |

### Platform requirements

It is recommended to use a cloud instance or a dedicated server for the aPuppet hosting, so the software or port conflicts are avoided.

Minimal software requirements:

- 1xCPU
- 2GB RAM
- 5GB HDD

Other requirements:

- CPU architecture `x84_64` / `amd64`
- Ubuntu Linux, available options are:
    - Ubuntu Focal `20.04 LTS`
	- Ubuntu Bionic `18.04 LTS` 
	- Ubuntu Xenial `16.04 LTS`
- `bash` command interpreter

The software has been tested on the DigitalOcean hosting (minimal $5 Droplet). The following Ubuntu versions have been tested:

- Ubuntu Focal 20.04 LTS x64
- Ubuntu Bionic 18.04.3 LTS x64
- Ubuntu Xenial 16.04.6 LTS x64

The web application for remote control (web-admin) has been tested and found to be fully functional in the following browsers:
- Chrome 86+
- Firefox 83+
- Opera 72+


## Deployment

### Platform setup

Update the system installation packages:

    sudo apt update

Install git in case it's not installed yet:

    sudo apt install -y git

Install Janus from the Ubuntu repository (version `1.1.2`):

    sudo apt install -y janus
    janus --version        # expect 1.1.2
    sudo systemctl enable --now janus

The package keeps its configuration in `/etc/janus` (not the Makefile default `/opt/janus/etc/janus`), so pass `JANUS_ETC=/etc/janus` to every `make` command below, for example `make install JANUS_ETC=/etc/janus`. Confirm the path with `dpkg -L janus | grep janus.jcfg`.

### aPuppet setup

#### Get the source code

Clone this repository (upstream: https://github.com/h-mdm/apuppet-server) to the server:

    git clone https://github.com/h-mdm/apuppet-server.git

Notice: to get the source code of the premium version, contact the sales at https://apuppet.org.

#### Installation

Once Janus is installed natively (default config dir `/opt/janus/etc/janus`; `/etc/janus` for the apt package) and fronted by the nginx site `janus-server` on port 8080, use the `Makefile`. Requirements: `make`, `openssl`, `curl`, `python3`, `nginx`, and `node`/`npm` (installed automatically if missing). `sudo` is used automatically when not running as root.

    make install          # patch Janus configs, restart Janus, build web-admin, write settings.js
    make nginx-install    # publish web-admin to nginx: http://<ip>:8080/ (Janus API on /janus, WebSocket on /ws)

Targets:

| Target | Description |
| --- | --- |
| `make install` | Runs `check`, `janus-config`, `janus-restart`, `web`, `verify`. Prints the API secret to enter in the Android app |
| `make nginx-install` | Builds web-admin, copies it to `WEB_ROOT`, installs `nginx/janus-server.conf` as the `janus-server` site, tests and reloads nginx |
| `make app` | Builds the BaseUI app from `app/` into `dist/app` and serves it on `http://<ip>:8075/`, with web-admin on `/admin/`. `/janus` is forwarded to nginx, so no CORS setup is needed |
| `make serve` | Alternative static server for web-admin only, on `WEB_PORT` (default 8075) |
| `make web` | Builds web-admin (gulp) into `dist/web-admin` and writes its `settings.js` |
| `make verify` | Checks via the Janus API that `api_secret` and the streaming/textroom plugins are enabled |
| `make status` | Shows the effective setup: Janus config dir, nginx API check, API secret, web build state |
| `make uninstall-config` | Restores the original Janus configs (`*.apuppet.orig`) and restarts Janus |
| `make clean` | Removes `dist/web-admin`, `dist/app`, `web-admin/dist` and `web-admin/node_modules` |

Step targets used by the targets above, which can also be run individually:

| Target | Description |
| --- | --- |
| `make check` | Verifies the Janus config dir, `openssl` and `curl`; generates `dist/.api_secret` on first use |
| `make janus-config` | Backs up `janus.jcfg`, `janus.plugin.streaming.jcfg`, `janus.plugin.textroom.jcfg` as `*.apuppet.orig`, then writes `api_secret` (and optional `admin_secret`) and the streaming/textroom settings |
| `make janus-restart` | Restarts the Janus service and waits up to 10 s for `/janus/info` |
| `make web-deps` | Installs node/npm if missing, installs gulp, builds web-admin and copies it to `dist/web-admin` |
| `make web-settings` | Writes `dist/web-admin/dist/js/settings.js` |
| `make app-build` | Copies `app/` to `dist/app` and writes its `settings.js` |
| `make app-admin` | Builds web-admin (and its settings) only if `dist/web-admin` is missing |

`deploy.sh` is separate from the Makefile: it tars `dist/`, uploads it with `scp`, and replaces the `current` release on the remote host over `ssh`.

Overrides are passed as `make VAR=value ...`:

| Variable | Default | Meaning |
| --- | --- | --- |
| `JANUS_ETC` | `/opt/janus/etc/janus` | Janus configuration directory |
| `JANUS_SERVICE` | `janus` | systemd service name of Janus |
| `JANUS_HTTP_PORT` | `8088` | Janus HTTP port |
| `NGINX_PORT` | `8080` | nginx port serving web-admin and proxying Janus |
| `NGINX_SITE` | `janus-server` | nginx site name |
| `WEB_ROOT` | `/var/www/apuppet-web-admin` | Where `nginx-install` publishes web-admin |
| `WEB_PORT` / `WEB_BIND` | `8075` / `0.0.0.0` | Port and bind address for `make serve` / `make app` |
| `API_SECRET` | generated once, kept in `dist/.api_secret` | Janus API secret (same value goes to Janus and `settings.js`) |
| `ADMIN_SECRET` | untouched | Janus admin secret, set only if provided |
| `JANUS_URL` | `https://webrtc.thebase.vn/janus` | Janus URL written to `settings.js` |

Notes:

- `RTP_PORT_RANGE` is fixed to `20000-40000`; open this UDP range in the firewall.
- Original Janus configs are backed up once as `*.apuppet.orig` before being modified.
- CORS is added by nginx, so Janus' own `cors` setting is left untouched.
- `REVIEW-JANUS-NATIVE.md` is referenced by the Makefile for background but is not in the repo.

## Usage

To control the mobile device remotely, you need to install the  [aPuppet](https://play.google.com/store/apps/details?id=com.hmdm.control) application available on Google Play.

Notice: you can also get the mobile app source code at [github](https://github.com/h-mdm/apuppet-android) and build your own version.

At first start, grant the required permissions.

- to simulate the user's gestures:

![Permission 1](./docs/images/perm1-apuppet.jpg)
![Permission 1](./docs/images/perm1-settings.jpg)

- to draw over other apps (so the mobile app could display a sharing indicator):

![Permission 2](./docs/images/perm2-apuppet.jpg)
![Permission 2](./docs/images/perm2-settings.jpg)

The app on Google play points to the public aPuppet server (srv.apuppet.org) by default. You can change the server URL and secret in the app settings:

![Settings Screen](./docs/images/settings.jpg)

If you build the mobile app from the source code, you can change the default server URL and secret to your own values in `build.gradle`.

On the main screen of the application, you can see the server connection status and the remote access credentials: `Session ID` and `Password`:

![Main Screen](./docs/images/main.jpg)

Enter these credentials in the `web-admin` application or just open the link provided by the mobile app. The mobile device will ask for the screen sharing permission. Grant this permission to start a remote support session:

![Sharing - request permission](./docs/images/sharing-request-permission.jpg)
![Sharing](./docs/images/sharing.jpg)

## Custom SSL certificate

To setup the HTTPS connection, aPuppet uses free certificates provided by LetsEncrypt. These certificates are supported by most OS and browsers.

Note that LetsEncrypt certifies only the domain name ownership and authenticity. It doesn't certify the data about your company. This fact may make LetsEncrypt not appropriate for work with sensitive data, for example in financial or medical areas.

In the Premium version, you can use any HTTPS certificate. Please fill in the contact form at https://apuppet.org for details and how to purchase a premium license.

## Updates

Update the source code (`git pull`) and re-run `make install` and `make nginx-install`. Changes to the `web-admin/` or `app/` sources are applied by re-running `make nginx-install` (or `make app`).

## Operation

Janus and nginx run as regular system services:

    sudo systemctl status janus nginx
    sudo systemctl restart janus
    sudo journalctl -u janus -f

Use `make status` to see the effective setup.

## web-admin

This is a web application for the remote access to the mobile device through a web browser. The app is written in HTML, CSS, and Javascript (WebRTC library is used for displaying the screencast and transferring gestures to a mobile device).

The source code is stored in the folder `web-admin/`. `make web` compiles it with gulp (CSS and JS are minified and concatenated) into `dist/web-admin`, together with a generated `settings.js` containing the aPuppet settings (Janus URL, API secret).
