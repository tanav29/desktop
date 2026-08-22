#!/usr/bin/env bash
set -e

export DISPLAY="${DISPLAY:-:99}"
export RESOLUTION="${RESOLUTION:-1600x900}"

mkdir -p /workspace

# Xvfb refuses to start if a previous run left its lock behind ("Server is
# already active for display N"). A plain `docker restart` reuses the container
# filesystem, so /tmp/.X<n>-lock and the socket survive and every restart came
# up with a dead desktop behind a healthy-looking daemon. Clear them first —
# nothing else is using this display inside our own container.
DISPLAY_NUM="${DISPLAY#:}"
DISPLAY_NUM="${DISPLAY_NUM%%.*}"
if [ -n "${DISPLAY_NUM}" ]; then
    if [ -e "/tmp/.X${DISPLAY_NUM}-lock" ] || [ -e "/tmp/.X11-unix/X${DISPLAY_NUM}" ]; then
        echo "[entrypoint] Clearing stale X locks for display ${DISPLAY}"
        rm -f "/tmp/.X${DISPLAY_NUM}-lock" "/tmp/.X11-unix/X${DISPLAY_NUM}"
    fi
fi

echo "[entrypoint] Starting Xvfb on ${DISPLAY} (${RESOLUTION})"
Xvfb "${DISPLAY}" -screen 0 "${RESOLUTION}x24" -nolisten tcp &
XVFB_PID=$!

# Wait for the display to actually answer. Failing loudly here beats booting
# the rest of the stack against a display that will never exist.
for _ in $(seq 1 30); do
    if xdpyinfo -display "${DISPLAY}" >/dev/null 2>&1; then
        break
    fi
    if ! kill -0 "${XVFB_PID}" 2>/dev/null; then
        echo "[entrypoint] FATAL: Xvfb exited while starting up on ${DISPLAY}" >&2
        exit 1
    fi
    sleep 1
done

if ! xdpyinfo -display "${DISPLAY}" >/dev/null 2>&1; then
    echo "[entrypoint] FATAL: ${DISPLAY} never came up after 30s" >&2
    exit 1
fi

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

echo "[entrypoint] Ready at http://localhost:6080/vnc.html"

# Supervise the stack. If any piece dies the desktop is useless, so exit and
# let Docker's restart policy bring up a clean container instead of lingering
# in a half-dead state that still answers on 6080.
while :; do
    for entry in "Xvfb:${XVFB_PID}" "xfce4-session:${SESSION_PID}" \
                 "x11vnc:${X11VNC_PID}" "noVNC:${WEBSOCKIFY_PID}" "api:${API_PID}"; do
        if ! kill -0 "${entry#*:}" 2>/dev/null; then
            echo "[entrypoint] ${entry%%:*} exited — shutting down for a clean restart" >&2
            exit 1
        fi
    done
    sleep 5
done
