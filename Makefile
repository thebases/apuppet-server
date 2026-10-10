# aPuppet server on top of an existing native Janus install (no Docker, no Ansible).
# Janus is fronted on the local network by the nginx site `janus-server` (plain HTTP):
#   http://<ip>:8080/janus   ws://<ip>:8080/ws   http://localhost:8080/admin (local only)
# `make nginx-install` publishes web-admin and makes nginx `location /` serve it on :8080.
# `make serve` is an alternative static server on WEB_PORT (default 8075).
# See REVIEW-JANUS-NATIVE.md for background.
#
#   make install          patch Janus configs, restart Janus, build web-admin, write settings.js
#   make nginx-install    publish web-admin to nginx (http://<ip>:8080/) and reload nginx
#   make serve            alternative: serve the web UI on http://<ip>:8075/ (LAN)
#   make status           show the effective setup
#
# Overrides (make VAR=value ...):
#   JANUS_ETC, JANUS_SERVICE, JANUS_HTTP_PORT (Janus itself, 8088), NGINX_PORT (8080),
#   RTP_PORT_RANGE, WEB_PORT, WEB_BIND,
#   API_SECRET (default: generated once, kept in dist/.api_secret),
#   ADMIN_SECRET (default: untouched),
#   JANUS_URL (default: http://<browser host>:NGINX_PORT/janus)
#
# CORS is added by nginx, so Janus' own `cors` setting is left untouched.

JANUS_ETC       ?= /opt/janus/etc/janus
JANUS_SERVICE   ?= janus
JANUS_HTTP_PORT ?= 8088
RTP_PORT_RANGE  ?= 10000-10500
NGINX_PORT      ?= 8080
NGINX_SITE      ?= janus-server
WEB_ROOT        ?= /var/www/apuppet-web-admin
WEB_PORT        ?= 8075
WEB_BIND        ?= 0.0.0.0
ADMIN_SECRET    ?=
JANUS_URL       ?=
SUDO            ?= $(shell [ $$(id -u) -eq 0 ] || echo sudo)

DIST      := dist
WEB_OUT   := $(DIST)/web-admin
SECRET_F  := $(DIST)/.api_secret
BACKUP_EXT := apuppet.orig
API_SECRET := $(shell [ -s $(SECRET_F) ] && cat $(SECRET_F) || openssl rand -hex 8)

define STREAMING_CFG
general: {
	rtp_port_range = "$(RTP_PORT_RANGE)"
	string_ids = true
}
endef

define TEXTROOM_CFG
general: {
	json = "indented"
	string_ids = true
}
endef

define SETTINGS_JS
var opaqueId = Janus.randomString(12);
var streamingOpaqueId = "streaming-" + opaqueId;
var textroomOpaqueId = "textroom-" + opaqueId;
var apiSecret = "$(API_SECRET)";
var janusDebugLevel = ['warn', 'error'];
toastr.options = { "progressBar": true, "positionClass": "toast-top-right", "preventDuplicates": true, "timeOut": 5000 };
var janusServers = [ $(if $(JANUS_URL),"$(JANUS_URL)",`http://$${window.location.hostname}:$(NGINX_PORT)/janus`) ];
endef

export STREAMING_CFG TEXTROOM_CFG SETTINGS_JS

.PHONY: nginx-install install check janus-config janus-restart web web-deps web-settings serve verify status uninstall-config clean

install: check janus-config janus-restart web verify
	@echo
	@echo "aPuppet installed."
	@echo "  API secret : $(API_SECRET)   (put it in the Android app)"
	@echo "  Web UI     : make serve  ->  http://<this-host-ip>:$(WEB_PORT)/"
	@echo "  Android app: server http://<this-host-ip>:$(NGINX_PORT) (nginx janus-server)"

check: $(SECRET_F)
	@test -d $(JANUS_ETC) || { echo "Janus config dir not found: $(JANUS_ETC)"; exit 1; }
	@command -v openssl >/dev/null || { echo "openssl is required"; exit 1; }
	@command -v curl >/dev/null || { echo "curl is required"; exit 1; }

# Created on first use; later runs reuse it so Janus and settings.js keep the same secret.
$(SECRET_F):
	@mkdir -p $(DIST)
	@echo "$(API_SECRET)" > $@
	@chmod 600 $@
	@echo "Generated $@"

# --- Janus ---------------------------------------------------------------

janus-config: check
	@for f in janus.jcfg janus.plugin.streaming.jcfg janus.plugin.textroom.jcfg; do \
	  [ -e $(JANUS_ETC)/$$f.$(BACKUP_EXT) ] || $(SUDO) cp -p $(JANUS_ETC)/$$f $(JANUS_ETC)/$$f.$(BACKUP_EXT); \
	done
	@# core: api_secret (+ optional admin_secret)
	@sed -E 's|^[[:space:]]*#?[[:space:]]*api_secret[[:space:]]*=.*|\tapi_secret = "$(API_SECRET)"|' \
	  $(JANUS_ETC)/janus.jcfg.$(BACKUP_EXT) \
	  $(if $(ADMIN_SECRET),| sed -E 's|^([[:space:]]*)admin_secret[[:space:]]*=[^#]*|\1admin_secret = "$(ADMIN_SECRET)"\t|') \
	  | $(SUDO) tee $(JANUS_ETC)/janus.jcfg >/dev/null
	@# plugins: only the aPuppet-relevant settings, sample mountpoints removed
	@printf '%s\n' "$$STREAMING_CFG" | $(SUDO) tee $(JANUS_ETC)/janus.plugin.streaming.jcfg >/dev/null
	@printf '%s\n' "$$TEXTROOM_CFG"  | $(SUDO) tee $(JANUS_ETC)/janus.plugin.textroom.jcfg  >/dev/null
	@echo "Janus configs updated (originals saved as *.$(BACKUP_EXT))"

janus-restart:
	$(SUDO) systemctl restart $(JANUS_SERVICE)
	@for i in 1 2 3 4 5 6 7 8 9 10; do \
	  curl -sf http://localhost:$(JANUS_HTTP_PORT)/janus/info >/dev/null && exit 0; sleep 1; done; \
	  echo "Janus did not come back on :$(JANUS_HTTP_PORT)"; exit 1

verify:
	@info=$$(curl -sf http://localhost:$(JANUS_HTTP_PORT)/janus/info) || { echo "Janus API unreachable"; exit 1; }; \
	echo "$$info" | grep -q '"api_secret": true' && echo "ok: api_secret enabled" || { echo "FAIL: api_secret not enabled"; exit 1; }; \
	echo "$$info" | grep -q 'janus.plugin.streaming' && echo "ok: streaming plugin" || { echo "FAIL: streaming plugin missing"; exit 1; }; \
	echo "$$info" | grep -q 'janus.plugin.textroom'  && echo "ok: textroom plugin"  || { echo "FAIL: textroom plugin missing"; exit 1; }

# --- web-admin -----------------------------------------------------------

web: web-deps web-settings

web-deps:
	@command -v node >/dev/null && command -v npm >/dev/null || { \
	  echo "Installing nodejs/npm"; $(SUDO) apt-get install -y nodejs npm; }
	cd web-admin && { [ -f package.json ] || npm init --yes >/dev/null; } \
	  && npm install --no-audit --no-fund --save-dev gulp@4 gulp-clean gulp-size@3 gulp-concat gulp-clean-css gulp-terser \
	  && mkdir -p dist && npx gulp
	rm -rf $(WEB_OUT)
	mkdir -p $(WEB_OUT)
	cp -r web-admin/dist web-admin/static web-admin/index.html $(WEB_OUT)/

web-settings: check
	@mkdir -p $(WEB_OUT)/dist/js
	@printf '%s\n' "$$SETTINGS_JS" > $(WEB_OUT)/dist/js/settings.js
	@echo "Wrote $(WEB_OUT)/dist/js/settings.js"

# Static server for web-admin on the local network. Port 8080 belongs to nginx (janus-server).
serve:
	@test -f $(WEB_OUT)/index.html || { echo "Run 'make web' first"; exit 1; }
	@echo "http://<this-host-ip>:$(WEB_PORT)/"
	python3 -m http.server $(WEB_PORT) --bind $(WEB_BIND) --directory $(WEB_OUT)

# Publish web-admin to WEB_ROOT (nginx's www-data cannot read under /home) and install
# nginx/janus-server.conf as the `$(NGINX_SITE)` site, where `location /` serves web-admin.
nginx-install: web
	$(SUDO) rm -rf $(WEB_ROOT)
	$(SUDO) mkdir -p $(WEB_ROOT)
	$(SUDO) cp -r $(WEB_OUT)/. $(WEB_ROOT)/
	sed 's|@WEB_ROOT@|$(WEB_ROOT)|' nginx/janus-server.conf | $(SUDO) tee /etc/nginx/sites-available/$(NGINX_SITE) >/dev/null
	$(SUDO) ln -sf /etc/nginx/sites-available/$(NGINX_SITE) /etc/nginx/sites-enabled/$(NGINX_SITE)
	$(SUDO) nginx -t
	$(SUDO) systemctl reload nginx
	@echo "Web UI: http://<this-host-ip>:$(NGINX_PORT)/   (Janus API on /janus, WebSocket on /ws)"

# --- misc ----------------------------------------------------------------

status:
	@echo "Janus etc : $(JANUS_ETC)"
	@echo "nginx API : $$(curl -s -o /dev/null -w '%{http_code}' http://localhost:$(NGINX_PORT)/janus/info) on :$(NGINX_PORT)/janus/info (expect 200)"
	@echo "API secret: $$(cat $(SECRET_F) 2>/dev/null || echo '<not generated>')"
	@echo "Web build : $$([ -f $(WEB_OUT)/index.html ] && echo $(WEB_OUT) || echo 'not built')"
	@curl -s http://localhost:$(JANUS_HTTP_PORT)/janus/info | grep -E '"(version_string|api_secret)"' || echo "Janus API unreachable"

# Restore the original Janus configs and restart.
uninstall-config:
	@for f in janus.jcfg janus.plugin.streaming.jcfg janus.plugin.textroom.jcfg; do \
	  [ -e $(JANUS_ETC)/$$f.$(BACKUP_EXT) ] && $(SUDO) cp -p $(JANUS_ETC)/$$f.$(BACKUP_EXT) $(JANUS_ETC)/$$f && echo "restored $$f"; done; true
	$(SUDO) systemctl restart $(JANUS_SERVICE)

clean:
	rm -rf $(WEB_OUT) web-admin/dist web-admin/node_modules
