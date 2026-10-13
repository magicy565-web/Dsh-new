"""Real POSIX PTY bridge for the official Pi TUI; no renderer or fake terminal UI."""
import fcntl
import json
import os
import select
import signal
import struct
import subprocess
import sys
import termios
import time

master, slave = os.openpty()
fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack('HHHH', 42, 120, 0, 0))
child = subprocess.Popen(sys.argv[1:], stdin=slave, stdout=slave, stderr=slave,
                         preexec_fn=os.setsid, close_fds=True)
os.close(slave)
deadline = time.monotonic() + 90
control = b''

def report(kind, **data):
    print(json.dumps({'type': kind, **data}), flush=True)

report('ready', pid=child.pid)
try:
    while True:
        if time.monotonic() > deadline:
            report('timeout')
            break
        readable, _, _ = select.select([master, sys.stdin.fileno()], [], [], .05)
        if master in readable:
            try:
                data = os.read(master, 65536)
                if data:
                    report('output', data=data.decode('utf-8', errors='replace'))
                    # Cursor position / terminal identity replies, not UI data.
                    if b'\x1b[6n' in data: os.write(master, b'\x1b[1;1R')
                    if b'\x1b[?u' in data: os.write(master, b'\x1b[?0u')
            except OSError:
                pass
        if sys.stdin.fileno() in readable:
            data = os.read(sys.stdin.fileno(), 65536)
            if not data: break
            control += data
            while b'\n' in control:
                line, control = control.split(b'\n', 1)
                command = json.loads(line)
                if command.get('type') == 'write': os.write(master, command['text'].encode())
                elif command.get('type') == 'stop': raise KeyboardInterrupt
        if child.poll() is not None:
            # Drain its final official scrollback before returning the exit.
            for _ in range(20):
                if not select.select([master], [], [], .02)[0]: break
                try:
                    data = os.read(master, 65536)
                    if data: report('output', data=data.decode('utf-8', errors='replace'))
                except OSError: break
            report('exit', code=child.returncode)
            sys.exit(child.returncode)
except KeyboardInterrupt:
    pass
finally:
    if child.poll() is None:
        os.killpg(child.pid, signal.SIGTERM)
        try: child.wait(timeout=3)
        except subprocess.TimeoutExpired:
            os.killpg(child.pid, signal.SIGKILL)
            child.wait(timeout=3)
    os.close(master)
