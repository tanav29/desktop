FROM debian:stable-slim

ENV DEBIAN_FRONTEND=noninteractive \
    DISPLAY=:99 \
    RESOLUTION=1600x900 \
    LANG=C.UTF-8

# deb.debian.org / security.debian.org can be blocked on some networks; use mirrors.
# kernel.org is an official Debian mirror (main); Berkeley OCF mirrors the -security suite.
RUN sed -i -e 's|http://deb.debian.org/debian-security|http://mirrors.ocf.berkeley.edu/debian-security|g' \
           -e 's|http://deb.debian.org/debian|http://mirrors.edge.kernel.org/debian|g' \
           /etc/apt/sources.list.d/debian.sources

# Minimal base: X server, VNC, native tools (installed in one layer, docs purged)
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        xvfb \
        x11vnc \
        x11-utils \
        xdotool \
        dbus-x11 \
        xfce4-session \
        xfce4-panel \
        xfce4-whiskermenu-plugin \
        xfconf \
        xfdesktop4 \
        xfwm4 \
        xfce4-terminal \
        thunar \
        mousepad \
        x11-xserver-utils \
        fonts-dejavu-core \
        git \
        curl \
        ripgrep \
        nano \
        python3 \
        build-essential \
        imagemagick \
        ca-certificates \
        unzip \
        libnspr4 \
        libnss3 \
        libasound2t64 \
        libatk-bridge2.0-0 \
        libatk1.0-0t64 \
        libcups2t64 \
        libdrm2 \
        libgbm1 \
        libgtk-3-0t64 \
        libpango-1.0-0 \
        libxcomposite1 \
        libxdamage1 \
        libxfixes3 \
        libxkbcommon0 \
        libxrandr2 \
        libxtst6 \
        libxss1 \
    && apt-get autoremove -y \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/* /var/cache/apt/archives/* \
    && rm -rf /usr/share/doc /usr/share/man

# noVNC lite (RFB core) + websockify from npm/PyPI — GitHub tarballs are
# IP-rate-limited; apt websockify would drag in numpy (these run stdlib-only)
RUN curl -fsSL https://registry.npmjs.org/@novnc/novnc/-/novnc-1.5.0.tgz -o /tmp/novnc.tgz \
 && mkdir -p /tmp/novncpkg \
 && tar -xzf /tmp/novnc.tgz -C /tmp/novncpkg \
 && mv /tmp/novncpkg/package/lib /opt/novnc \
 && curl -fsSL https://pypi.org/packages/py3/w/websockify/websockify-0.12.0-py3-none-any.whl -o /tmp/ws.whl \
 && mkdir -p /opt/websockify \
 && unzip -q /tmp/ws.whl -d /opt/websockify \
 && rm -rf /tmp/novnc.tgz /tmp/novncpkg /tmp/ws.whl

# Chromium (real build from Chrome for Testing; the Ubuntu package is a snap stub that does not work in Docker)
RUN curl -fsSL https://googlechromelabs.github.io/chrome-for-testing/last-known-good-versions-with-downloads.json -o /tmp/cft.json \
 && python3 -c "import json;d=json.load(open('/tmp/cft.json'));print([x['url'] for x in d['channels']['Stable']['downloads']['chrome'] if x['platform']=='linux64'][0])" > /tmp/chrome_url \
 && curl -fsSL "$(cat /tmp/chrome_url)" -o /tmp/chrome.zip \
 && unzip -q /tmp/chrome.zip -d /opt \
 && mv /opt/chrome-linux64 /opt/chrome \
 && rm -f /opt/chrome/chrome_sandbox \
 && ln -s /opt/chrome/chrome /usr/local/bin/chromium \
 && apt-get purge -y unzip \
 && rm -rf /tmp/*

RUN printf '[Desktop Entry]\nType=Application\nName=Chromium\nComment=Web browser\nExec=/opt/chrome/chrome --no-sandbox --disable-dev-shm-usage --no-first-run %%U\nIcon=applications-internet\nTerminal=false\nCategories=Network;WebBrowser;\nMimeType=text/html;text/xml;application/xhtml+xml;\n' > /usr/share/applications/chromium.desktop \
 && chmod 644 /usr/share/applications/chromium.desktop \
 && mkdir -p /workspace \
 && chmod 777 /workspace

WORKDIR /workspace

COPY entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

COPY vnc_lite.html /opt/novnc/vnc_lite.html
COPY daemon/daemon.py /opt/daemon.py

EXPOSE 6080 8095

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
