#!/bin/sh
# Fills the clipboard history of a running session by copying each argument in
# turn from gedit (opened if needed, and left open). The last argument ends up
# as the selected entry. Prints the resulting history state.
#
#   agents/seed-history.sh new-entry-bravo old-entry-alpha
#
# Words are typed with the virtual keyboard: lowercase ASCII, digits, '-' and spaces.
[ $# -gt 0 ] || { echo "usage: $0 <text>..." >&2; exit 2; }
. "$(dirname "$0")/ns.sh"

case "$(E "JSON.stringify(global.get_window_actors().map(a => a.meta_window.get_wm_class()))")" in
*gedit*) ;;
*)
    app gedit --new-window
    for _ in $(seq 40); do
        case "$(E "__ci.focus('org.gnome.gedit')")" in *gedit*) break;; esac
        pause 0.5
    done
    pause 0.5
    ;;
esac

E "__ci.focus('org.gnome.gedit')" >/dev/null; pause 0.8
# A freshly created virtual keyboard can drop its first events.
E "__kb.tap('space'); __kb.tap('BackSpace'); 'warmup'" >/dev/null; pause 0.5
for w in "$@"; do
    E "__kb.type('$w'); __kb.combo(['Shift_L','Home']); __kb.combo(['Control_L','c']); __kb.tap('End'); __kb.tap('Return'); 'ok'" >/dev/null
    pause 1
done
E "__ci.state()"
