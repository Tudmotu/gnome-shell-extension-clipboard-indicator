# Clipboard Indicator — New Features Design

**Date**: 2026-04-27
**Branch**: `fix/registry-read-hang-and-incorrect-filter` (base), feature branch TBD

## Overview

Add five new capabilities to the clipboard indicator extension:

1. **Duplicate detection** — avoid re-adding content already at the top of history
2. **Timestamps on entries** — show when each item was captured (relative or absolute, toggleable)
3. **Snippets** — permanent saved items that never auto-clear, with a dedicated menu section
4. **Quick-paste by number** — Alt+1 through Alt+9 pastes the nth visible menu item
5. **Smart content icons** — detect URLs, emails, file paths, and code blocks; show type-specific icons

---

## Feature 1: Duplicate Detection

### Behavior
- When new clipboard content arrives, compare its string value to the most recent entry (index `clipItemsRadioGroup.length - 1`)
- If identical → skip: do not add, do not notify, do not move
- If identical to an older entry (not latest): remove the old duplicate, add the new copy at top (keeps most recent timestamp)
- Favorites and snippets are also checked for duplicates

### Implementation
- **File**: `extension.js`, method `_refreshIndicator()`
- Add check between `#getClipboardContent()` resolving and `_addEntry()` call
- Use `entry.getStringValue()` comparison (uses the `equals()` method on ClipboardEntry)
- Edge case: integer hash collision in image entries — use the existing `equals()` which compares `getStringValue()` (for images this is `[Image <hash>]`)

---

## Feature 2: Timestamps

### Storage
- Add `timestamp: number` (epoch milliseconds) to each entry in the registry JSON
- Add `timestamp` private field to `ClipboardEntry` class
- Constructor: `new ClipboardEntry(mimetype, bytes, favorite, timestamp)` — defaults to `Date.now()`
- `fromJSON()` reads `jsonEntry.timestamp`
- `write()` serializes `entry.timestamp`

### Settings (new GSettings keys)
- `show-timestamps` (boolean, default `true`) — toggle timestamp display in menu
- `timestamp-format` (integer enum, default `0`) — `0` = relative, `1` = absolute

Add to `PrefsFields` in `constants.js` and to `schemas/org.gnome.shell.extensions.clipboard-indicator.gschema.xml`.

### Display
- Each menu item shows timestamp below the label in a smaller, dimmed `St.Label`
- Format helper function `formatTimestamp(timestamp, format)`:
  - **Relative**: "just now" (< 10s), "1 min ago", "5 min ago", "2 hrs ago", "3 days ago", "2 weeks ago", "1 month ago", "> 1 year ago"
  - **Absolute**: localized format using `GLib.DateTime`, e.g. "14:30 27 Apr" for same year, "14:30 27 Apr 2025" for different year
- Updated when settings change (already handled by `_onSettingsChange` → `_setEntryLabel`)
- A setting change rebuilds labels for all existing items

### UI element placement
```
┌─────────────────────────────────────┐
│ [icon] hello world text...    [pin] │  ← label (existing)
│        2 min ago                    │  ← timestamp (new, smaller, dimmed)
└─────────────────────────────────────┘
```

---

## Feature 3: Snippets

### Concept
Snippets are clipboard entries marked as permanent. They differ from favorites:
- **Favorites** = pinned within the history list (still subject to some limits)
- **Snippets** = never auto-cleared by history-size limit, interval clearing, or clear-all. Always visible.

An entry can be both favorited AND a snippet (superset relationship).

### Storage
- Add `snippet: boolean` to registry JSON per entry
- Add `#snippet` private field to `ClipboardEntry` class
- `ClipboardEntry.isSnippet()` getter, `ClipboardEntry.setSnippet(val)` setter
- `fromJSON()` reads `jsonEntry.snippet`
- `write()` serializes `entry.isSnippet()`

### Menu UI
- New `snippetsSection` (like `favoritesSection`) with its own `St.ScrollView`
- Placed above favorites section (order: Snippets → Favorites → History)
- When `PINNED_ON_BOTTOM` is true, snippets still appear at top (they're distinct from "pinned")
- Each snippet item has both a pin-button (favorite) and a snippet indicator icon

### Keyboard shortcut
- Press `s` on a focused menu item to toggle snippet status
- Press `p` to toggle favorite (existing behavior)

### Clearing behavior
- `_clearHistory()`: skips snippet items (regardless of `KEEP_SELECTED_ON_CLEAR`)
- `_removeOldestEntries()`: skips snippet items (they don't count toward `MAX_REGISTRY_LENGTH`)
- Interval clearing: skips snippet items
- Clear on boot: skips snippet items
- Manual delete via Delete key or X button: still allowed (user-initiated)

### Indicators
- Snippet items show a small bookmark icon (e.g. `bookmark-new-symbolic`) on the left
- Non-snippet items show the normal content-type icon

---

## Feature 4: Quick-paste by Number (Alt+1–9)

### Behavior
- When the menu is open, Alt+1 through Alt+9 immediately pastes the nth *visible* menu item
- "Visible" means respecting search filter results — if search hides 5 of 10 items, Alt+1 pastes the first *visible* item, not the first in the list
- After pasting, menu closes and item is set as current selection
- If Alt+number pressed but fewer items are visible, nothing happens

### Implementation
- Add key-press-event handler on `this.menu` (the PopupMenu itself)
- Check for `Alt` modifier + number key (Clutter.KEY_1 through Clutter.KEY_9)
- Compile list of visible items from `this.clipItemsRadioGroup.filter(m => m.actor.visible)`
- Map key to index (key_1 → 0, key_2 → 1, etc.)
- Call `_onMenuItemSelectedAndMenuClose(visibleItems[index], true)`

### Edge cases
- Search box focused: Alt+1 still works (key events bubble from entry to menu)
- No items visible: nothing happens
- Private mode: items hidden, so nothing happens
- Alt+number when only fewer items: ignored

---

## Feature 5: Smart Content Icons

### Detectors
Extensible detector registry. Each detector has:
- `name`: string identifier
- `test(text)`: returns boolean (fast, synchronous)
- `icon`: icon name string
- `priority`: number (higher priority wins if multiple match)

Built-in detectors (in priority order):

| Priority | Type   | Pattern                                                      | Icon                         |
|----------|--------|--------------------------------------------------------------|------------------------------|
| 100      | url    | `^(https?|ftp|sftp|file)://`                                | `applications-internet-symbolic` |
| 90       | email  | `^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$`         | `mail-unread-symbolic`       |
| 80       | path   | `^/(?:[a-zA-Z0-9._-]+/)*[a-zA-Z0-9._-]*$`                  | `folder-symbolic`            |
| 70       | code   | Multi-line + contains keyword pattern: `function`, `class`, `def`, `import`, `const`, `let`, `var`, `if`, `for`, `while` | `text-x-generic-symbolic`    |

Default: `text-x-generic` icon for plain text. Code detection is the fallback detector — it only matches if no URL/email/path was detected and the text spans multiple lines with recognizable code keywords.

### Display
- Replace the item's leading icon with the content-type icon
- The icon is shown on the left side of each menu item (currently no icon exists there — add one)
- The pin button, paste button, and delete button remain on the right side

### When no content-type icon
- Show a generic text icon for text entries
- Show an image icon for image entries (existing behavior)

### Extensibility
- Detectors stored as an array in a new module `contentDetectors.js`
- Adding a new type = adding an object to the array
- Future: could add a settings UI for users to enable/disable detectors

---

## Files Affected

| File          | Changes                                                        |
|---------------|----------------------------------------------------------------|
| `extension.js`| Duplicate detection, timestamps display, snippets section, quick-paste handler, content-type icon rendering |
| `registry.js` | Timestamp field in ClipboardEntry, snippet field, serialization |
| `constants.js`| New PrefsFields for show-timestamps, timestamp-format, snippet shortcuts |
| `prefs.js`    | Settings UI for show-timestamps toggle, timestamp-format dropdown |
| `schemas/*.xml` | New GSettings keys for timestamps, timestamp-format |
| `stylesheet.css` | Styles for timestamp label, snippet indicator |
| `contentDetectors.js` | **New file** — content type detection registry |

---

## Testing

- **Duplicate detection**: copy same text twice, verify only one entry
- **Timestamps**: copy text, verify timestamp appears, toggle format in settings
- **Snippets**: mark item as snippet, clear history, verify snippet remains
- **Quick-paste**: open menu, Alt+1, verify item pasted to focused app
- **Smart icons**: copy URL/email/path/code, verify correct icon appears
- **Integration**: all features work together (snippet + timestamp + icon + duplicate detection)
