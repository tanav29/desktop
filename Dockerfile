FROM ubuntu:24.04

ENV DEBIAN_FRONTEND=noninteractive \
    DISPLAY=:99 \
    RESOLUTION=1600x900 \
    LANG=C.UTF-8

# archive.ubuntu.com can be blocked on some networks; kernel.org is an official Ubuntu mirror.
RUN sed -i 's|http://archive.ubuntu.com/ubuntu|http://mirrors.edge.kernel.org/ubuntu|g; s|http://security.ubuntu.com/ubuntu|http://mirrors.edge.kernel.org/ubuntu|g' /etc/apt/sources.list.d/ubuntu.sources

# Minimal base: X server, VNC, native tools (installed in one layer, docs purged)
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      xvfb \
      x11vnc \
      x11-utils \
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
      fonts-dejavu-core \
      git \
      curl \
      wget \
      ripgrep \
      nano \
      vim \
      python3 \
      nodejs \
      npm \
      build-essential \
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
 && rm -rf /var/lib/apt/lists/* /var/cache/apt/archives/* \
 && rm -rf /usr/share/doc /usr/share/man

# noVNC + websockify from GitHub (apt websockify would drag in numpy; these run stdlib-only)
RUN curl -fsSL https://github.com/novnc/noVNC/archive/refs/tags/v1.5.0.tar.gz -o /tmp/novnc.tar.gz \
 && tar -xzf /tmp/novnc.tar.gz -C /opt \
 && mv /opt/noVNC-1.5.0 /opt/novnc \
 && curl -fsSL https://github.com/novnc/websockify/archive/refs/tags/v0.12.0.tar.gz -o /tmp/ws.tar.gz \
 && tar -xzf /tmp/ws.tar.gz -C /opt \
 && mv /opt/websockify-0.12.0 /opt/websockify

# Chromium (real build from Chrome for Testing; the Ubuntu package is a snap stub that does not work in Docker)
RUN curl -fsSL https://googlechromelabs.github.io/chrome-for-testing/last-known-good-versions-with-downloads.json -o /tmp/cft.json \
 && python3 -c "import json;d=json.load(open('/tmp/cft.json'));print([x['url'] for x in d['channels']['Stable']['downloads']['chrome'] if x['platform']=='linux64'][0])" > /tmp/chrome_url \
 && curl -fsSL "$(cat /tmp/chrome_url)" -o /tmp/chrome.zip \
 && unzip -q /tmp/chrome.zip -d /opt \
 && mv /opt/chrome-linux64 /opt/chrome \
 && rm -f /opt/chrome/chrome_sandbox \
 && ln -s /opt/chrome/chrome /usr/local/bin/chromium \
 && rm -rf /tmp/*

RUN printf '[Desktop Entry]\nType=Application\nName=Chromium\nComment=Web browser\nExec=/opt/chrome/chrome --no-sandbox --disable-dev-shm-usage --no-first-run --remote-debugging-port=9222 %%U\nIcon=applications-internet\nTerminal=false\nCategories=Network;WebBrowser;\nMimeType=text/html;text/xml;application/xhtml+xml;\n' > /usr/share/applications/chromium.desktop \
 && chmod 644 /usr/share/applications/chromium.desktop \
 && mkdir -p /workspace \
 && chmod 777 /workspace

WORKDIR /workspace

COPY entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

EXPOSE 6080

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]