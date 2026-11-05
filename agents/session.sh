#!/bin/sh
# Headless nested GNOME Shell for automated testing.
#
#   agents/session.sh start    start a session (stops a previous one first)
#   agents/session.sh stop     stop it
#   agents/session.sh status   print whether it is running
#
# The shell runs headless (no window on the host) with a 1280x800 virtual
# monitor, in unsafe mode (enables org.gnome.Shell.Eval and Screenshot), on its
# own private D-Bus, and with an empty XDG_CACHE_HOME so the clipboard history
# starts empty and the real ~/.cache/clipboard-indicator@tudmotu.com is never
# touched. It loads the extension from
# ~/.local/share/gnome-shell/extensions/clipboard-indicator@tudmotu.com, so that
# should be a symlink to this repository.
#
# State lives in $CI_AGENT_DIR (default: $XDG_RUNTIME_DIR/clipboard-indicator-agent):
#   bus.txt     private bus address (read by agents/ns.sh)
#   pid         gnome-shell pid
#   shell.log   gnome-shell output, including the extension's console.log
#   cache/      the session's XDG_CACHE_HOME
#   shots/      screenshots taken with `shot`

DIR="${CI_AGENT_DIR:-${XDG_RUNTIME_DIR:-/tmp}/clipboard-indicator-agent}"

running() { [ -f "$DIR/pid" ] && kill -0 "$(cat "$DIR/pid")" 2>/dev/null; }

stop() {
    if running; then
        kill "$(cat "$DIR/pid")"
        for _ in $(seq 50); do running || break; sleep 0.1; done
    fi
    rm -f "$DIR/pid" "$DIR/bus.txt"
}

case "$1" in
start)
    stop
    rm -rf "$DIR/cache" "$DIR/shell.log"
    mkdir -p "$DIR/cache" "$DIR/shots"
    # The inner script runs inside dbus-run-session, so its bus is private.
    # WAYLAND_DISPLAY/DISPLAY are unset so it cannot attach to the host session.
    setsid dbus-run-session -- sh -c '
        echo "$DBUS_SESSION_BUS_ADDRESS" > "$1/bus.txt"
        export XDG_CACHE_HOME="$1/cache"
        unset WAYLAND_DISPLAY DISPLAY
        gnome-shell --headless --virtual-monitor 1280x800 --unsafe-mode > "$1/shell.log" 2>&1 &
        echo $! > "$1/pid"
        wait
    ' sh "$DIR" < /dev/null > /dev/null 2>&1 &
    for _ in $(seq 120); do
        grep -q 'GNOME Shell started' "$DIR/shell.log" 2>/dev/null && break
        sleep 0.5
    done
    if ! grep -q 'GNOME Shell started' "$DIR/shell.log" 2>/dev/null; then
        echo "gnome-shell did not start, see $DIR/shell.log" >&2
        exit 1
    fi
    # Report whether the extension loaded.
    state=$(DBUS_SESSION_BUS_ADDRESS="$(cat "$DIR/bus.txt")" timeout 10 gdbus call --session \
        -d org.gnome.Shell -o /org/gnome/Shell -m org.gnome.Shell.Eval \
        "Main.panel.statusArea.clipboardIndicator ? 'extension loaded' : 'extension NOT loaded'")
    echo "session started: $DIR ($state)"
    ;;
stop)
    stop
    echo "session stopped"
    ;;
status)
    if running; then echo "running: $DIR"; else echo "not running"; exit 1; fi
    ;;
*)
    echo "usage: $0 start|stop|status" >&2
    exit 2
    ;;
esac
