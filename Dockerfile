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
# Stage 1: XFCE desktop with Debian's standard Chromium package.
# ---------------------------------------------------------------------------
FROM debian:stable-slim

ENV DEBIAN_FRONTEND=noninteractive \
    DISPLAY=:99 \
    RESOLUTION=1600x900 \
    LANG=C.UTF-8

RUN sed -i -e 's|http://deb.debian.org/debian-security|http://mirrors.ocf.berkeley.edu/debian-security|g' \
           -e 's|http://deb.debian.org/debian|http://mirrors.edge.kernel.org/debian|g' \
    /etc/apt/sources.list.d/debian.sources

# XFCE desktop + VNC + agent tooling + Chromium.
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
        chromium \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/* /var/cache/apt/archives/* \
    && rm -rf /usr/share/doc /usr/share/man \
    # keep Adwaita/hicolor icons and mime db for XFCE — previous trim broke gtk icon loading
    && (find /usr/lib/python3.13 -type d -name __pycache__ -exec rm -rf {} + 2>/dev/null || true) \
    && (gdk-pixbuf-query-loaders --update-cache 2>/dev/null || true) \
    && (update-mime-database /usr/share/mime 2>/dev/null || true) \
    && (update-icon-caches /usr/share/icons/* 2>/dev/null || true)

# noVNC + websockify (stdlib wheel — avoids numpy/BLAS)
RUN curl -fsSL https://github.com/novnc/noVNC/archive/refs/tags/v1.5.0.tar.gz -o /tmp/novnc.tgz \
 && tar -xzf /tmp/novnc.tgz -C /opt \
 && mv /opt/noVNC-1.5.0 /opt/novnc \
 && rm -rf /opt/novnc/tests /opt/novnc/docs /opt/novnc/utils \
 && curl -fsSL https://pypi.org/packages/py3/w/websockify/websockify-0.12.0-py3-none-any.whl -o /tmp/ws.whl \
 && python3 -c "import zipfile;zipfile.ZipFile('/tmp/ws.whl').extractall('/opt/websockify')" \
 && rm -rf /tmp/novnc.tgz /tmp/ws.whl

# Chromium runs as root in this container, so its sandbox must be disabled.
# Keep Debian's complete browser and dependencies, including software rendering.
ENV BROWSER=/usr/local/bin/chromium
RUN printf '#!/bin/sh\nexec /usr/bin/chromium --no-sandbox --disable-dev-shm-usage --no-first-run "$@"\n' > /usr/local/bin/chromium \
 && chmod +x /usr/local/bin/chromium \
 && ln -s /usr/local/bin/chromium /usr/local/bin/browser \
 && printf '[Desktop Entry]\nType=Application\nName=Chromium\nComment=Web browser\nExec=/usr/local/bin/chromium %%U\nIcon=chromium\nTerminal=false\nCategories=Network;WebBrowser;\nMimeType=text/html;text/xml;application/xhtml+xml;\n' > /usr/share/applications/chromium.desktop \
 && printf '[Desktop Entry]\nType=Application\nName=File Manager\nComment=Browse files\nExec=pcmanfm\nIcon=system-file-manager\nTerminal=false\nCategories=System;FileManager;\n' > /usr/share/applications/pcmanfm.desktop \
 && mkdir -p /etc/xdg \
 && printf '[Default Applications]\nx-scheme-handler/http=chromium.desktop;\nx-scheme-handler/https=chromium.desktop;\ntext/html=chromium.desktop;\napplication/xhtml+xml=chromium.desktop;\n' > /etc/xdg/mimeapps.list \
 && rm -f /usr/share/applications/debian-uxterm.desktop /usr/share/applications/uxterm.desktop /usr/bin/uxterm \
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
