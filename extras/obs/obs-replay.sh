#!/bin/sh
# Starts OBS in the "snip-clip Replay" profile with the replay buffer running (Linux).
# Create the profile first with obs-setup.py. Uses the native OBS, else the Flatpak.
set -- --profile "snip-clip Replay" --collection "snip-clip Replay" --startreplaybuffer --disable-shutdown-check
if command -v obs >/dev/null 2>&1; then
    exec obs "$@"
elif command -v flatpak >/dev/null 2>&1 && flatpak info com.obsproject.Studio >/dev/null 2>&1; then
    exec flatpak run com.obsproject.Studio "$@"
fi
echo "OBS not found. Install it from your distribution or from Flathub (com.obsproject.Studio)." >&2
exit 1
