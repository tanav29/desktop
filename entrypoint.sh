#!/usr/bin/env bash
set -e

export DISPLAY="${DISPLAY:-:99}"
export RESOLUTION="${RESOLUTION:-1600x900}"

mkdir -p /workspace

echo "[entrypoint] Starting Xvfb on ${DISPLAY} (${RESOLUTION})"
Xvfb "${DISPLAY}" -screen 0 "${RESOLUTION}x24" -nolisten tcp &
XVFB_PID=$!

for i in $(seq 1 30); do
    if xdpyinfo -display "${DISPLAY}" >/dev/null 2>&1; then
        break
    fi
    sleep 1
done

eval "$(dbus-launch --sh-syntax)"

echo "[entrypoint] Starting XFCE session"
xfce4-session &
SESSION_PID=$!

sleep 2

echo "[entrypoint] Starting x11vnc on 5900"
x11vnc -forever -shared -nopw -display "${DISPLAY}" >/var/log/x11vnc.log 2>&1 &
X11VNC_PID=$!

echo "[entrypoint] Starting noVNC on 6080"
(cd /opt/websockify && python3 -m websockify --web /opt/novnc 6080 localhost:5900) &
WEBSOCKIFY_PID=$!

echo "[entrypoint] Starting HTTP API on 8095"
python3 /opt/daemon.py &
API_PID=$!

cleanup() {
    kill "${API_PID}" "${WEBSOCKIFY_PID}" "${X11VNC_PID}" "${SESSION_PID}" "${XVFB_PID}" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

echo "[entrypoint] Ready at http://localhost:6080/vnc_lite.html"
wait