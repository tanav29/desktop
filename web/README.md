### Named desktops

Set a unique `DESKTOP_NAME` when starting each container. For example, in
PowerShell, from the repository root:

```powershell
$env:DESKTOP_NAME="research"
$env:DESKTOP_API_PORT="8095"
$env:DESKTOP_VNC_PORT="6080"
$env:DESKTOP_WORKSPACE="./workspace-research"
docker compose -p research up -d --build

$env:DESKTOP_NAME="coding"
$env:DESKTOP_API_PORT="8096"
$env:DESKTOP_VNC_PORT="6081"
$env:DESKTOP_WORKSPACE="./workspace-coding"
docker compose -p coding up -d
```

Tell the agent which desktop name to use. It discovers names on localhost ports
8095?8099. For other ports, set `COMPUTER_DISCOVERY_PORTS` in the web app
environment to a comma-separated list, then restart the web app. Names must be
unique; ambiguous names are rejected. The web viewer, recording and share tools
still use the default desktop and do not follow this selection. Each desktop
needs a distinct API port, viewer port, Compose project, and workspace path.
