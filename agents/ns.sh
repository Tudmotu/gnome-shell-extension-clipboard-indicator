# Helpers for driving the headless session started by agents/session.sh.
# Source this file:  . agents/ns.sh
#
#   E '<js>'        run JS inside the nested shell and print the result
#   shot <name>     save a screenshot to $CI_AGENT_DIR/shots/<name>.png, print the path
#   pause <secs>    sleep (works where a plain `sleep` is not allowed)
#   app <cmd...>    launch a Wayland app into the nested session (backgrounded)
#
# It also installs two JS helpers in the shell (reinstalled on every source):
#   __kb.tap('v'), __kb.type('abc'), __kb.combo(['Control_L', 'v'])
#       virtual keyboard; key names are Clutter KEY_* names without the prefix
#   __ci.ind()                    the extension's indicator
#   __ci.open() / __ci.close()    open or close the menu
#   __ci.item(text)               menu item whose entry text is `text`
#   __ci.focus(wmClass)           give a window focus (new windows don't get it)
#   __ci.state()                  JSON with the history (oldest first), selection and menu state

CI_AGENT_DIR="${CI_AGENT_DIR:-${XDG_RUNTIME_DIR:-/tmp}/clipboard-indicator-agent}"
export DBUS_SESSION_BUS_ADDRESS="$(cat "$CI_AGENT_DIR/bus.txt")"

# Eval returns (true, '<result>'). The 10 s cap keeps a stuck shell from hanging the caller.
E() { timeout 10 gdbus call --session -d org.gnome.Shell -o /org/gnome/Shell -m org.gnome.Shell.Eval "$1"; }
pause() { timeout "$1" tail -f /dev/null; }
shot() {
    timeout 10 gdbus call --session -d org.gnome.Shell.Screenshot -o /org/gnome/Shell/Screenshot \
        -m org.gnome.Shell.Screenshot.Screenshot false false "$CI_AGENT_DIR/shots/$1.png" >/dev/null \
        && echo "$CI_AGENT_DIR/shots/$1.png"
}
app() {
    env WAYLAND_DISPLAY=wayland-1 GDK_BACKEND=wayland "$@" >> "$CI_AGENT_DIR/apps.log" 2>&1 &
}

E "
const C = imports.gi.Clutter;
if (!globalThis.__kb) {
  const seat = global.stage.context.get_backend().get_default_seat();
  const dev = seat.create_virtual_device(C.InputDeviceType.KEYBOARD_DEVICE);
  const t = () => C.get_current_event_time() * 1000 || GLib.get_monotonic_time();
  const sym = n => n.length === 1 ? n.charCodeAt(0) : C['KEY_' + n];
  globalThis.__kb = {
    tap(n) { const k = sym(n); dev.notify_keyval(t(), k, C.KeyState.PRESSED); dev.notify_keyval(t(), k, C.KeyState.RELEASED); },
    type(s) { for (const ch of s) this.tap(ch === ' ' ? 'space' : ch === '-' ? 'minus' : ch); },
    combo(keys) { const ks = keys.map(sym); ks.forEach(k => dev.notify_keyval(t(), k, C.KeyState.PRESSED)); ks.slice().reverse().forEach(k => dev.notify_keyval(t(), k, C.KeyState.RELEASED)); },
  };
}
globalThis.__ci = {
  ind: () => Main.panel.statusArea.clipboardIndicator,
  open() { this.ind().menu.open(); return this.ind().menu.isOpen ? 'open' : 'not open'; },
  close() { this.ind().menu.close(); return this.ind().menu.isOpen ? 'still open' : 'closed'; },
  item(text) { return this.ind().clipItemsRadioGroup.find(m => m.entry.getStringValue() === text); },
  focus(wmClass) {
    Main.overview.hide();
    global.stage.set_key_focus(null);
    const w = global.get_window_actors().map(a => a.meta_window)
      .find(w => (w.get_wm_class() ?? '').toLowerCase() === wmClass.toLowerCase());
    if (!w) return 'no window';
    w.activate(global.get_current_time());
    return global.display.focus_window?.get_wm_class() ?? 'none';
  },
  state() {
    const i = this.ind();
    return JSON.stringify({
      order: i.clipItemsRadioGroup.map(m => m.entry.getStringValue()),
      selected: i._getCurrentlySelectedItem()?.entry.getStringValue() ?? null,
      menuOpen: i.menu.isOpen,
    });
  },
};
'helpers ready'" >/dev/null
