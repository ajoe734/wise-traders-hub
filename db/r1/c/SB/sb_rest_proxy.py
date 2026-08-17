#!/usr/bin/env python3
"""Loopback shim in front of the real backends used by the Edge rehearsal.

Usage: sb_rest_proxy.py <listen_port> <postgrest_port> <log_file> [gotrue_port]

  /rest/v1/**  -> real PostgREST      (path prefix stripped)
  /auth/v1/**  -> real GoTrue/supabase-auth (path prefix stripped)
  everything else -> PostgREST

Only the path prefix is rewritten; headers/body/status pass through untouched so
the edge functions exercise the real supabase-js -> real PostgREST / real GoTrue
path. No token is ever logged.
"""
import http.client
import json
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

LISTEN = int(sys.argv[1])
UP = int(sys.argv[2])
LOGF = sys.argv[3]
AUTH_UP = int(sys.argv[4]) if len(sys.argv) > 4 else 0
HOP = {"connection", "keep-alive", "transfer-encoding", "content-length", "host"}


class H(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, *a):
        pass

    def _do(self):
        path = self.path
        target = UP
        upstream = "rest"
        if path.startswith("/auth/v1") or path.startswith("/auth"):
            if AUTH_UP:
                target = AUTH_UP
                upstream = "auth"
                for p in ("/auth/v1", "/auth"):
                    if path.startswith(p):
                        path = path[len(p):] or "/"
                        break
        else:
            for p in ("/rest/v1", "/rest"):
                if path.startswith(p):
                    path = path[len(p):] or "/"
                    break
        n = int(self.headers.get("Content-Length") or 0)
        body = self.rfile.read(n) if n else b""
        with open(LOGF, "a") as f:
            f.write(json.dumps({"method": self.command, "path": path, "upstream": upstream}) + "\n")
        conn = http.client.HTTPConnection("127.0.0.1", target, timeout=30)
        hdrs = {k: v for k, v in self.headers.items() if k.lower() not in HOP}
        conn.request(self.command, path, body=body, headers=hdrs)

        r = conn.getresponse()
        data = r.read()
        self.send_response(r.status)
        for k, v in r.getheaders():
            if k.lower() in HOP:
                continue
            self.send_header(k, v)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)
        conn.close()

    do_GET = do_POST = do_PATCH = do_DELETE = do_PUT = do_HEAD = _do


if __name__ == "__main__":
    ThreadingHTTPServer(("127.0.0.1", LISTEN), H).serve_forever()
