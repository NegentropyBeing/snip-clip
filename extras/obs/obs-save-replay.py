"""Saves OBS's replay buffer through its WebSocket server (Linux).

On Wayland, OBS only sees its hotkeys while its window has focus. Bind this script to a
shortcut in your desktop's keyboard settings instead. obs-setup.py turns the server on;
the port and password are read from OBS's own settings.

    python3 obs-save-replay.py
"""
import base64
import hashlib
import json
import os
import shutil
import socket
import struct
import subprocess
import sys

FLATPAK_ID = "com.obsproject.Studio"
OUTPUTS_EVENTS = 1 << 6


def websocket_config():
    native = os.path.join(os.environ.get("XDG_CONFIG_HOME") or os.path.expanduser("~/.config"), "obs-studio")
    flatpak = os.path.expanduser(f"~/.var/app/{FLATPAK_ID}/config/obs-studio")
    for root in (native, flatpak):
        try:
            with open(os.path.join(root, "plugin_config", "obs-websocket", "config.json"), encoding="utf-8") as f:
                return json.load(f)
        except (OSError, ValueError):
            pass
    raise RuntimeError("OBS WebSocket settings not found. Run obs-setup.py first.")


def send(sock, msg):
    data = json.dumps(msg).encode()
    mask = os.urandom(4)
    size = bytes([0x80 | len(data)]) if len(data) < 126 else bytes([0x80 | 126]) + struct.pack(">H", len(data))
    sock.sendall(b"\x81" + size + mask + bytes(b ^ mask[i % 4] for i, b in enumerate(data)))


def receive(sock, f):
    while True:
        head = f.read(2)
        if len(head) < 2:
            raise RuntimeError("OBS closed the connection.")
        opcode, size = head[0] & 0x0F, head[1] & 0x7F
        if size == 126:
            size = struct.unpack(">H", f.read(2))[0]
        elif size == 127:
            size = struct.unpack(">Q", f.read(8))[0]
        data = f.read(size)
        if opcode == 1:
            return json.loads(data)
        if opcode == 8:
            raise RuntimeError(data[2:].decode(errors="replace") or "OBS closed the connection.")
        if opcode == 9:
            sock.sendall(b"\x8a\x80" + os.urandom(4))


def save_replay():
    conf = websocket_config()
    if not conf.get("server_enabled"):
        raise RuntimeError("OBS's WebSocket server is off. Run obs-setup.py again, or turn it on in Tools -> WebSocket Server Settings.")
    port = conf.get("server_port", 4455)
    try:
        sock = socket.create_connection(("127.0.0.1", port), timeout=10)
    except OSError:
        raise RuntimeError("OBS is not running.") from None
    with sock, sock.makefile("rb") as f:
        key = base64.b64encode(os.urandom(16)).decode()
        sock.sendall((f"GET / HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n"
                      f"Sec-WebSocket-Key: {key}\r\nSec-WebSocket-Version: 13\r\n"
                      "Sec-WebSocket-Protocol: obswebsocket.json\r\n\r\n").encode())
        if b" 101 " not in f.readline():
            raise RuntimeError(f"Port {port} is not OBS's WebSocket server.")
        while f.readline() not in (b"\r\n", b""):
            pass

        hello = receive(sock, f)["d"]
        identify = {"rpcVersion": 1, "eventSubscriptions": OUTPUTS_EVENTS}
        if "authentication" in hello:
            auth = hello["authentication"]
            secret = base64.b64encode(hashlib.sha256((conf.get("server_password", "") + auth["salt"]).encode()).digest())
            identify["authentication"] = base64.b64encode(hashlib.sha256(secret + auth["challenge"].encode()).digest()).decode()
        send(sock, {"op": 1, "d": identify})
        while receive(sock, f)["op"] != 2:
            pass

        send(sock, {"op": 6, "d": {"requestType": "SaveReplayBuffer", "requestId": "save"}})
        while True:
            msg = receive(sock, f)
            if msg["op"] == 7 and not msg["d"]["requestStatus"]["result"]:
                raise RuntimeError(msg["d"]["requestStatus"].get("comment", "OBS could not save the replay."))
            if msg["op"] == 5 and msg["d"]["eventType"] == "ReplayBufferSaved":
                return msg["d"]["eventData"]["savedReplayPath"]


def notify(title, body):
    print(f"{title}: {body}", file=sys.stderr if title.endswith("failed") else sys.stdout)
    if shutil.which("notify-send"):
        subprocess.run(["notify-send", "-a", "snip-clip", "-t", "3000", title, body], check=False)


def main():
    try:
        path = save_replay()
    except (RuntimeError, OSError) as e:
        notify("Replay failed", str(e))
        sys.exit(1)
    notify("Replay saved", os.path.basename(path))


if __name__ == "__main__":
    main()
