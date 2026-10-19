#!/bin/sh
set -eu
umask 077
Xvfb :99 -screen 0 1280x800x24 -nolisten tcp >/tmp/petpal-xvfb.log 2>&1 &
while [ ! -S /tmp/.X11-unix/X99 ]; do sleep 0.1; done
dbus-run-session -- sh -c 'openbox-session & tint2 & pcmanfm --desktop & wait' >/tmp/petpal-desktop.log 2>&1 &
x11vnc -display :99 -localhost -rfbport 5900 -nopw -forever -shared -quiet >/tmp/petpal-vnc.log 2>&1 &
trap 'kill $(jobs -p) 2>/dev/null || true; exit 0' TERM INT
while :; do sleep 3600 & wait $!; done
