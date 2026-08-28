# syntax=docker/dockerfile:1

# ---------------------------------------------------------------------------
# Stage 0: perl-free git (avoids 100 MB of perl).
# ---------------------------------------------------------------------------
FROM debian:stable-slim AS git-builder
ENV DEBIAN_FRONTEND=noninteractive
RUN sed -i -e 's|http://deb.debian.org/debian-security|http://mirrors.ocf.berkeley.edu/debian-security|g' \
           -e 's|http://deb.debian.org/debian|http://mirrors.edge.kernel.org/debian|g' \
    /etc/apt/sources.list.d/debian.sources
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
        build-essential ca-certificates curl \
        libcurl4-openssl-dev zlib1g-dev libexpat1-dev cargo \
 && rm -rf /var/lib/apt/lists/* /var/cache/apt/archives/*
RUN curl -fsSL https://github.com/git/git/archive/refs/tags/v2.55.0.tar.gz -o /tmp/git.tgz \
 && mkdir /src && tar -xzf /tmp/git.tgz -C /src --strip-components=1 && rm /tmp/git.tgz
RUN make -C /src -j"$(nproc)" prefix=/usr NO_PERL=1 NO_TCLTK=1 NO_GETTEXT=1 all
RUN make -C /src prefix=/usr NO_PERL=1 NO_TCLTK=1 NO_GETTEXT=1 NO_INSTALL_HARDLINKS=1 DESTDIR=/out install
RUN find /out -type f -name 'git*' -exec strip --strip-unneeded {} + 2>/dev/null; \
    rm -rf /out/usr/share/gitweb /out/usr/libexec/git-core/bin-wrappers \
           /out/usr/lib/systemd /out/usr/share/locale

# ---------------------------------------------------------------------------
# Stage 1: XFCE + Chromium + tiny browsers — full app list with minimal bloat.
#
# XFCE gives the top panel + Whisker menu (all apps list) that openbox+tint2
# lacks. Chromium (Chrome for Testing) is needed for modern web; tiny browsers
# (dillo/netsurf/links2) stay as <10 MB fallback. No ffmpeg (~170 MB saved),
# perl-free git (~80 MB saved), Mesa/LLVM stripped (~215 MB), docs/mime trimmed.
# ---------------------------------------------------------------------------
FROM debian:stable-slim

ENV DEBIAN_FRONTEND=noninteractive \
    DISPLAY=:99 \
    RESOLUTION=1600x900 \
    LANG=C.UTF-8

RUN sed -i -e 's|http://deb.debian.org/debian-security|http://mirrors.ocf.berkeley.edu/debian-security|g' \
           -e 's|http://deb.debian.org/debian|http://mirrors.edge.kernel.org/debian|g' \
    /etc/apt/sources.list.d/debian.sources

# XFCE desktop + VNC + agent tooling + Chromium deps.
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
        pcmanfm \
        xterm \
        x11-xserver-utils \
        fonts-dejavu-core \
        curl \
        ripgrep \
        nano \
        python3-minimal \
        imagemagick \
        xclip \
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
        libexpat1 \
        dillo \
        netsurf-gtk \
        links2 \
    && apt-get purge -y perl-modules-5.40 libperl5.40 2>/dev/null || true \
    && apt-get autoremove -y \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/* /var/cache/apt/archives/* \
    && rm -rf /usr/share/doc /usr/share/man /usr/share/perl \
    && rm -rf /usr/libexec/gcc \
    && rm -f /usr/bin/cpp /usr/bin/cpp-* /usr/bin/*-cpp* \
    && rm -rf /usr/lib/x86_64-linux-gnu/perl-base/unicore \
    && rm -f /usr/lib/x86_64-linux-gnu/libisl*.so* \
             /usr/lib/x86_64-linux-gnu/libmpc*.so* \
             /usr/lib/x86_64-linux-gnu/libmpfr*.so* \
             /usr/lib/x86_64-linux-gnu/libdb-5.3* \
    && rm -rf /usr/lib/x86_64-linux-gnu/dri \
    && rm -f /usr/lib/x86_64-linux-gnu/libgallium-*.so \
             /usr/lib/x86_64-linux-gnu/libLLVM*.so* \
             /usr/lib/x86_64-linux-gnu/libz3.so* \
             /usr/lib/x86_64-linux-gnu/libGLX_mesa* \
             /usr/lib/x86_64-linux-gnu/libGLX_indirect* \
    # keep Adwaita/hicolor icons and mime db for XFCE — previous trim broke gtk icon loading
    && find /usr/lib/python3.13 -type d -name __pycache__ -exec rm -rf {} + 2>/dev/null || true \
    && gdk-pixbuf-query-loaders --update-cache 2>/dev/null || true \
    && update-mime-database /usr/share/mime 2>/dev/null || true \
    && update-icon-caches /usr/share/icons/* 2>/dev/null || true

# noVNC + websockify (stdlib wheel — avoids numpy/BLAS)
RUN curl -fsSL https://github.com/novnc/noVNC/archive/refs/tags/v1.5.0.tar.gz -o /tmp/novnc.tgz \
 && tar -xzf /tmp/novnc.tgz -C /opt \
 && mv /opt/noVNC-1.5.0 /opt/novnc \
 && rm -rf /opt/novnc/tests /opt/novnc/docs /opt/novnc/utils \
 && curl -fsSL https://pypi.org/packages/py3/w/websockify/websockify-0.12.0-py3-none-any.whl -o /tmp/ws.whl \
 && python3 -c "import zipfile;zipfile.ZipFile('/tmp/ws.whl').extractall('/opt/websockify')" \
 && rm -rf /tmp/novnc.tgz /tmp/ws.whl

# Chromium (real build from Chrome for Testing — Ubuntu package is a snap stub).
RUN curl -fsSL https://googlechromelabs.github.io/chrome-for-testing/last-known-good-versions-with-downloads.json -o /tmp/cft.json \
 && python3 -c "import json;d=json.load(open('/tmp/cft.json'));print([x['url'] for x in d['channels']['Stable']['downloads']['chrome'] if x['platform']=='linux64'][0])" > /tmp/chrome_url \
 && curl -fsSL "$(cat /tmp/chrome_url)" -o /tmp/chrome.zip \
 && python3 -c "import zipfile;zipfile.ZipFile('/tmp/chrome.zip').extractall('/opt')" \
 && mv /opt/chrome-linux64 /opt/chrome \
 && rm -f /opt/chrome/chrome_sandbox \
 && chmod +x /opt/chrome/chrome /opt/chrome/chrome_crashpad_handler /opt/chrome/chrome-wrapper \
 && printf '#!/bin/sh\nexec /opt/chrome/chrome --no-sandbox --disable-dev-shm-usage --no-first-run "$@"\n' > /usr/local/bin/chromium \
 && chmod +x /usr/local/bin/chromium \
 && rm -rf /opt/chrome/WidevineCdm /opt/chrome/hyphen-data \
 && cd /opt/chrome/locales \
 && for f in *.pak; do [ "$f" = "en-US.pak" ] || rm -f "$f"; done \
 && rm -rf /tmp/*

# Tiny browser shims — `browser` tries Chrome -> netsurf -> dillo -> links2
RUN printf '#!/bin/sh\nif command -v chromium >/dev/null 2>&1; then exec chromium "$@"; fi\nif command -v netsurf-gtk >/dev/null 2>&1; then exec netsurf-gtk "$@"; fi\nif command -v dillo >/dev/null 2>&1; then exec dillo "$@"; fi\nif command -v links2 >/dev/null 2>&1; then exec links2 -g "$@"; fi\necho "no browser found" >&2; exit 1\n' > /usr/local/bin/browser \
 && chmod +x /usr/local/bin/browser \
 && printf '[Desktop Entry]\nType=Application\nName=Chromium\nComment=Web browser\nExec=/opt/chrome/chrome --no-sandbox --disable-dev-shm-usage --no-first-run %%U\nIcon=applications-internet\nTerminal=false\nCategories=Network;WebBrowser;\nMimeType=text/html;text/xml;application/xhtml+xml;\n' > /usr/share/applications/chromium.desktop \
 && printf '[Desktop Entry]\nType=Application\nName=Netsurf\nComment=Lightweight web browser\nExec=netsurf-gtk %%U\nIcon=applications-internet\nTerminal=false\nCategories=Network;WebBrowser;\n' > /usr/share/applications/netsurf.desktop \
 && printf '[Desktop Entry]\nType=Application\nName=Dillo\nComment=Ultra-light web browser\nExec=dillo %%U\nIcon=applications-internet\nTerminal=false\nCategories=Network;WebBrowser;\n' > /usr/share/applications/dillo.desktop \
 && printf '[Desktop Entry]\nType=Application\nName=File Manager\nComment=Browse files\nExec=pcmanfm\nIcon=system-file-manager\nTerminal=false\nCategories=System;FileManager;\n' > /usr/share/applications/pcmanfm.desktop \
 && chmod 644 /usr/share/applications/chromium.desktop /usr/share/applications/netsurf.desktop /usr/share/applications/dillo.desktop /usr/share/applications/pcmanfm.desktop \
 && mkdir -p /workspace && chmod 777 /workspace

# xterm tuning + XFCE panel not needed — whisker menu already lists all apps
RUN mkdir -p /etc/X11/app-defaults \
 && printf '*faceName: DejaVu Sans Mono\n*faceSize: 11\n*saveLines: 4096\n*scrollBar: true\n*metaSendsEscape: true\n*background: #10121a\n*foreground: #d8dee9\n*cursorColor: #ffb454\n*color0: #10121a\n*color1: #e06c75\n*color2: #98c379\n*color3: #ffb454\n*color4: #61afef\n*color5: #c678dd\n*color6: #56b6c2\n*color7: #d8dee9\n' > /etc/X11/app-defaults/XTerm \
 && printf '[Desktop Entry]\nType=Application\nName=Xterm\nComment=Terminal\nExec=xterm\nIcon=xterm-color_48x48\nTerminal=false\nCategories=System;TerminalEmulator;\n' > /usr/share/applications/debian-xterm.desktop \
 && chmod 644 /usr/share/applications/debian-xterm.desktop /etc/X11/app-defaults/XTerm

WORKDIR /workspace

COPY entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

COPY daemon/daemon.py /opt/daemon.py
COPY novnc/desktop.html /opt/novnc/desktop.html

COPY --from=git-builder /out/usr/ /usr/
RUN printf '[init]\n\tdefaultBranch = main\n[safe]\n\tdirectory = *\n' > /etc/gitconfig \
 && git clone -q --depth 1 https://github.com/octocat/Hello-World /tmp/git-smoke \
 && rm -rf /tmp/git-smoke

EXPOSE 6080 8095

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
