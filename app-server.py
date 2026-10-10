#!/usr/bin/env python3
"""Serves the BaseUI app (and extra directories under a prefix, e.g. /admin) and forwards /janus to the Janus HTTP API, so the browser sees one origin (no CORS)."""
import argparse
import http.client
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

HOP_BY_HOP = {"connection", "keep-alive", "transfer-encoding", "te", "trailer", "upgrade", "proxy-authorization", "proxy-authenticate"}


class Handler(SimpleHTTPRequestHandler):
    """Static files for everything, except /janus which goes to the upstream Janus server."""

    upstream = "127.0.0.1:8080"
    mounts = {}  # URL prefix (e.g. "/admin") -> directory

    def is_janus(self):
        """Tells whether this request is for the Janus API."""
        return self.path == "/janus" or self.path.startswith(("/janus/", "/janus?"))

    def mount(self):
        """Returns the (prefix, directory) mounted for this request path, or None."""
        path = self.path.split("?", 1)[0]
        for prefix, directory in self.mounts.items():
            if path == prefix or path.startswith(prefix + "/"):
                return prefix, directory
        return None

    def translate_path(self, path):
        """Maps mounted prefixes to their directory; everything else to the main directory."""
        for prefix, directory in self.mounts.items():
            bare = path.split("?", 1)[0].split("#", 1)[0]
            if bare == prefix or bare.startswith(prefix + "/"):
                saved, self.directory = self.directory, directory
                try:
                    return super().translate_path(bare[len(prefix):] or "/")
                finally:
                    self.directory = saved
        return super().translate_path(path)

    def redirect_mount(self):
        """Redirects /admin to /admin/ so the page's relative links resolve under the prefix."""
        if self.path.split("?", 1)[0] in self.mounts:
            self.send_response(301)
            self.send_header("Location", self.path.split("?", 1)[0] + "/")
            self.send_header("Content-Length", "0")
            self.end_headers()
            return True
        return False

    def proxy(self):
        """Replays the request on the upstream server and sends its answer back unchanged."""
        body = self.rfile.read(int(self.headers.get("Content-Length") or 0))
        headers = {k: v for k, v in self.headers.items() if k.lower() not in HOP_BY_HOP | {"host"}}
        connection = http.client.HTTPConnection(self.upstream, timeout=130)
        try:
            connection.request(self.command, self.path, body, headers)
            response = connection.getresponse()
            data = response.read()
        except OSError as error:
            self.send_error(502, f"Janus upstream {self.upstream} unreachable: {error}")
            return
        finally:
            connection.close()
        self.send_response(response.status)
        for key, value in response.getheaders():
            if key.lower() not in HOP_BY_HOP | {"content-length"}:
                self.send_header(key, value)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        """GET: Janus API or static file."""
        if self.is_janus():
            self.proxy()
        elif not self.redirect_mount():
            super().do_GET()

    def do_POST(self):
        """POST: only the Janus API accepts it."""
        self.proxy() if self.is_janus() else self.send_error(405)

    def do_OPTIONS(self):
        """OPTIONS: preflight for the Janus API."""
        self.proxy() if self.is_janus() else self.send_error(405)


def main():
    """Parses the command line and runs the threaded server (threads keep Janus long-polls from blocking each other)."""
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=8075)
    parser.add_argument("--bind", default="0.0.0.0")
    parser.add_argument("--directory", default=".")
    parser.add_argument("--upstream", default="127.0.0.1:8080", help="host:port that serves /janus")
    parser.add_argument("--mount", action="append", default=[], metavar="/PREFIX=DIR", help="serve DIR under /PREFIX (repeatable)")
    args = parser.parse_args()
    Handler.upstream = args.upstream
    Handler.mounts = {prefix.rstrip("/"): directory for prefix, directory in (m.split("=", 1) for m in args.mount)}
    server = ThreadingHTTPServer((args.bind, args.port), partial(Handler, directory=args.directory))
    print(f"app on http://{args.bind}:{args.port}/  (/janus -> http://{args.upstream}/janus)")
    for prefix, directory in Handler.mounts.items():
        print(f"  {prefix}/ -> {directory}")
    server.serve_forever()


if __name__ == "__main__":
    main()
