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

# Minimal XFCE desktop + VNC + agent tooling, installed in one layer, docs purged.
# Deliberately absent (packages removed in the slimming pass, docs updated):
#   ffmpeg  - ~170 MB of libav/audio codec stack; nothing in the stack uses it
#   build-essential - ~250 MB gcc/g++/binutils toolchain; nothing compiles in-image
#   gh (GitHub CLI) - gh is a 43 MB binary; use git for push/PRs from the container
#   thunar, mousepad - file manager + editor, ~20 MB; xfce4-terminal stays
#   python3 -> python3-minimal - the daemon + websockify only need the stdlib
# The Xorg GPU driver stack (mesa/LLVM, ~215 MB) is deleted below: Xvfb has no
# GPU, Gtk renders with software Cairo, and Chromium bundles its own ANGLE +
# SwiftShader (libvk_swiftshader.so stays), so nothing needs the DRI drivers.
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
        x11-xserver-utils \
        fonts-dejavu-core \
        git \
        curl \
        ripgrep \
        nano \
        python3-minimal \
        imagemagick \
        ca-certificates \
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
        libudev1 \
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
    && rm -rf /usr/share/doc /usr/share/man \
    && rm -rf /usr/lib/x86_64-linux-gnu/dri \
    && rm -f /usr/lib/x86_64-linux-gnu/libgallium-*.so \
             /usr/lib/x86_64-linux-gnu/libLLVM*.so* \
             /usr/lib/x86_64-linux-gnu/libz3.so* \
             /usr/lib/x86_64-linux-gnu/libGLX_mesa* \
             /usr/lib/x86_64-linux-gnu/libGLX_indirect*

# noVNC (official release incl. built-in vnc.html viewer) + websockify wheel.
# Using the PyPI wheel (stdlib-only) avoids apt's python3-websockify which
# pulls in numpy → BLAS/LAPACK (~40 MB). unzip is gone too (tar/python extract).
RUN curl -fsSL https://github.com/novnc/noVNC/archive/refs/tags/v1.5.0.tar.gz -o /tmp/novnc.tgz \
 && tar -xzf /tmp/novnc.tgz -C /opt \
 && mv /opt/noVNC-1.5.0 /opt/novnc \
 && rm -rf /opt/novnc/tests /opt/novnc/docs /opt/novnc/utils \
 && curl -fsSL https://pypi.org/packages/py3/w/websockify/websockify-0.12.0-py3-none-any.whl -o /tmp/ws.whl \
 && python3 -c "import zipfile;zipfile.ZipFile('/tmp/ws.whl').extractall('/opt/websockify')" \
 && rm -rf /tmp/novnc.tgz /tmp/ws.whl

# Chromium (real build from Chrome for Testing; the Ubuntu package is a snap stub that does not work in Docker).
# Slimmed: only the en-US locale pack stays (~50 MB of locale .pak files removed),
# WidevineCdm is unused in CfT builds, and hyphen-data is text-hyphenation only.
RUN curl -fsSL https://googlechromelabs.github.io/chrome-for-testing/last-known-good-versions-with-downloads.json -o /tmp/cft.json \
 && python3 -c "import json;d=json.load(open('/tmp/cft.json'));print([x['url'] for x in d['channels']['Stable']['downloads']['chrome'] if x['platform']=='linux64'][0])" > /tmp/chrome_url \
 && curl -fsSL "$(cat /tmp/chrome_url)" -o /tmp/chrome.zip \
 && python3 -c "import zipfile;zipfile.ZipFile('/tmp/chrome.zip').extractall('/opt')" \
 && mv /opt/chrome-linux64 /opt/chrome \
 && rm -f /opt/chrome/chrome_sandbox \
 && chmod +x /opt/chrome/chrome /opt/chrome/chrome_crashpad_handler /opt/chrome/chrome-wrapper \
 && ln -s /opt/chrome/chrome /usr/local/bin/chromium \
 && rm -rf /opt/chrome/WidevineCdm /opt/chrome/hyphen-data \
 && cd /opt/chrome/locales \
 && for f in *.pak; do [ "$f" = "en-US.pak" ] || rm -f "$f"; done \
 && rm -rf /tmp/*

RUN printf '[Desktop Entry]\nType=Application\nName=Chromium\nComment=Web browser\nExec=/opt/chrome/chrome --no-sandbox --disable-dev-shm-usage --no-first-run %%U\nIcon=applications-internet\nTerminal=false\nCategories=Network;WebBrowser;\nMimeType=text/html;text/xml;application/xhtml+xml;\n' > /usr/share/applications/chromium.desktop \
 && chmod 644 /usr/share/applications/chromium.desktop \
 && mkdir -p /workspace \
 && chmod 777 /workspace

WORKDIR /workspace

COPY entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

COPY daemon/daemon.py /opt/daemon.py

EXPOSE 6080 8095

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
