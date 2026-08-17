#!/usr/bin/env python3
"""Stage B rehearsal FinMind provider mock (loopback only).

Modes are flipped by writing a single word into <state_file>:
  reject  -> HTTP 200 body {"status":400,"msg":"Your level is register, ..."}  (terminal)
  reject4 -> HTTP 400 with the same msg                                        (terminal)
  rate    -> HTTP 429                                                          (retryable)
  fail5   -> HTTP 503                                                          (retryable)
  net     -> connection closed with no response                               (network)
  unknown -> HTTP 200 with an unparseable/foreign body                        (unknown)
  ok      -> HTTP 200 with one BSR row                                         (success)

Every request is appended to <log_file> as JSON (path + query only, no headers)
so the harness can prove "0 provider calls while blocked".
"""
import json
import sys
from http.server import BaseHTTPRequestHandler, HTTPServer
from urllib.parse import urlparse, parse_qs

STATE = sys.argv[2]
LOGF = sys.argv[3]
PORT = int(sys.argv[1])

REJECT_MSG = "Your level is register, please upgrade your level."


def mode():
    try:
        with open(STATE) as f:
            return f.read().strip() or "reject"
    except OSError:
        return "reject"


class H(BaseHTTPRequestHandler):
    def log_message(self, *a):  # silence stderr spam
        pass

    def do_GET(self):
        u = urlparse(self.path)
        q = parse_qs(u.query)
        m = mode()
        with open(LOGF, "a") as f:
            f.write(json.dumps({
                "path": u.path,
                "dataset": (q.get("dataset") or [""])[0],
                "data_id": (q.get("data_id") or [""])[0],
                "start_date": (q.get("start_date") or [""])[0],
                "mode": m,
            }) + "\n")

        if m == "net":
            try:
                self.close_connection = True
                self.wfile.close()
            except Exception:
                pass
            return
        if m == "unknown":
            raw = b"<html>upstream weirdness</html>"
            self.send_response(200)
            self.send_header("Content-Type", "text/html")
            self.send_header("Content-Length", str(len(raw)))
            self.end_headers()
            self.wfile.write(raw)
            return

        if m == "reject":
            body, code = {"status": 400, "msg": REJECT_MSG}, 200
        elif m == "reject4":
            body, code = {"status": 400, "msg": REJECT_MSG}, 400
        elif m == "rate":
            body, code = {"msg": "rate limit"}, 429
        elif m == "fail5":
            body, code = {"msg": "upstream"}, 503
        else:
            body, code = {"status": 200, "data": [{
                "date": (q.get("start_date") or ["2026-08-14"])[0],
                "stock_id": (q.get("data_id") or ["2330"])[0],
                "securities_trader": "MockBroker",
                "securities_trader_id": "9999",
                "price": 100.0, "buy": 1000, "sell": 0,
            }]}, 200

        raw = json.dumps(body).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)


if __name__ == "__main__":
    HTTPServer(("127.0.0.1", PORT), H).serve_forever()
