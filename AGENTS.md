# AGENTS.md

Notes for AI coding agents working on Clipboard Indicator, a GNOME Shell extension.

## Project layout

- `extension.js`: the panel indicator, the menu, clipboard tracking and pasting
- `registry.js`: history storage (`~/.cache/clipboard-indicator@tudmotu.com/registry.txt`) and the `ClipboardEntry` class
- `prefs.js`: the preferences window. It runs in a separate GTK process, not in GNOME Shell
- `keyboard.js`: the virtual keyboard used to send the paste keys
- `compat.js`: helpers for API differences between supported GNOME versions
- `confirmDialog.js`, `constants.js`
- `schemas/`: GSettings schema. `locale/`: translations
- `make`: compiles the schema and the translations. Run it after changing either
- `metadata.json`: lists the supported GNOME Shell versions, and the README's "GNOME Version Support" section mirrors it. Update both together

`make bundle` and `make install` only package the files listed in `MODULES` in the `Makefile`, so `agents/` and this file are never shipped.

## Testing changes: headless nested GNOME Shell

The default way to verify a change is to run it in a headless nested GNOME Shell and drive it over D-Bus. Use the scripts in `agents/`:

- `agents/session.sh start|stop|status`: runs a nested shell with no window on the host, on its own private D-Bus, with an empty history
- `agents/ns.sh`: source it for helpers: `E` (run JS in the shell), `shot` (screenshot), `pause`, `app` (launch a Wayland app into the session), and in-shell `__kb` (virtual keyboard) and `__ci` (extension helpers). It documents them at the top
- `agents/seed-history.sh <text>...`: fills the history by copying each word from gedit

Do not use `make nested-session` for automated testing. It opens a devkit window on the host, and that window stalls whenever it is hidden. It is meant for humans testing by hand.

### Requirements

- Developed against GNOME Shell 51. The scripts use `--headless`, `--virtual-monitor` and `--unsafe-mode`
- `gdbus` (glib2). `gedit`, for `seed-history.sh`
- `~/.local/share/gnome-shell/extensions/clipboard-indicator@tudmotu.com` must be a symlink to this repository, and the extension must be enabled in the user's GNOME settings. The nested shell loads whatever is checked out

### Workflow

```sh
agents/session.sh start                     # prints "extension loaded" when it worked
agents/seed-history.sh first-entry second-entry
. agents/ns.sh
E "__ci.focus('org.gnome.gedit')"           # focus the app first: a menu paste goes to the window that had focus
E "__ci.open()"; pause 0.5; shot menu-open  # prints the screenshot path
E "__ci.item('first-entry').actor.grab_key_focus(); __kb.tap('v')"
pause 0.5                                   # let the paste and the clipboard restore finish
E "__ci.state()"                            # history, selection, menu state
agents/session.sh stop
```

- `E`, `pause`, `shot` and `app` are shell functions. If your shell starts fresh for every command, source `agents/ns.sh` again in each one. Re-sourcing is safe
- GNOME Shell cannot reload an extension. After editing the code or switching branches, restart the session: `agents/session.sh start` stops the old one first
- `agents/session.sh status` exits 1 when no session is running
- State, logs and screenshots live in `$CI_AGENT_DIR`, by default `$XDG_RUNTIME_DIR/clipboard-indicator-agent`
- `shell.log` there holds GNOME Shell's output, including the extension's `console.log` and `JS ERROR` lines. Check it after every test. The extension normally logs nothing. "Could not load extension" lines for other folders, such as backup copies named `clipboard-indicator@tudmotu.com~`, come from the user's extensions directory and can be ignored
- Stop the session when you are done

### Screenshots

Always take screenshots of the states a test exercised, such as the menu, a dialog, or the app after a paste, and show them to the user with the results. A screenshot covers the whole 1280x800 monitor. Crop it when the detail is small.

### Rules

- Never touch the user's real `~/.cache/clipboard-indicator@tudmotu.com`. The session gets its own `XDG_CACHE_HOME`, so leave that in place
- The nested shell shares the user's dconf settings with their real session. Do not run `gsettings set`, `dconf write`, or `gnome-extensions enable/disable` while testing
- To disable and re-enable the extension inside the session, use `E "Main.extensionManager.lookup('clipboard-indicator@tudmotu.com').stateObj.disable()"`, and `.enable()` to turn it back on. This bypasses the extension manager, so `lookup(...).state` still reports enabled. Check `Main.panel.statusArea.clipboardIndicator` instead, which is undefined while disabled. Wait about 1.5 s after `enable()` before using the indicator
- The extension's own settings object writes to that same dconf. If a test needs a setting changed, ask the user first, and restore the old value afterwards

### Gotchas

- `E` prints the gdbus result, such as `(true, '"text"')`. Strings come back JSON-encoded, so return `JSON.stringify(...)` for structured values. Code that returns nothing gives `(true, '')`, and a JS exception gives `(false, '...')`
- Eval code has `Main`, `Meta`, `GLib` and `global` in scope. Get other libraries with `imports.gi.St`, `imports.gi.Clutter` and so on. There is no top-level `await`, but if the code returns a promise, Eval waits for it
- New windows don't get focus by themselves, and after `Main.overview.hide()` the hidden overview can keep the keyboard focus, which swallows key presses. `__ci.focus(wmClass)` handles both. Call it before typing into an app
- A freshly created virtual keyboard can drop its first key events. Send a throwaway key first, as `seed-history.sh` does
- `wl-copy` hangs when no window has focus. Copy from inside a focused app with Ctrl+C instead, as `seed-history.sh` does
- To paste a menu entry the way a user would: `E "__ci.item('text').actor.grab_key_focus(); __kb.tap('v')"`. The paste button is `__ci.item('text').pasteBtn.emit('clicked', 1)`
- A menu paste closes the menu, sets the clipboard to the entry, and sends Shift+Insert to the focused window (Ctrl+Shift+Insert when the focused input is a terminal). About 50 ms later it restores the previously selected entry, so a later Ctrl+V pastes that one. Wait about 0.5 s after a menu paste before checking the result or pressing more keys
- Wayland apps need `WAYLAND_DISPLAY=wayland-1` and the session's bus. `app` sets both
- For X11 apps, under Xwayland, use the `DISPLAY` from the "public X11 display" line in `shell.log`, and set `XAUTHORITY` to the newest `/run/user/$UID/.mutter-Xwaylandauth.*`. Chrome also needs `--ozone-platform=x11 --user-data-dir=<a scratch dir>`
