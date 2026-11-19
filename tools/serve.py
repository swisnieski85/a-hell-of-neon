"""Serve the game locally.

Usage: python tools/serve.py [port]   (default port: 8000)

Serves the project root no matter which directory you run it from.
"""
import functools
import http.server
import os
import sys

port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=root)

with http.server.ThreadingHTTPServer(("", port), handler) as httpd:
    print(f"Open http://localhost:{port}  (Ctrl+C to stop)", flush=True)
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped.")
