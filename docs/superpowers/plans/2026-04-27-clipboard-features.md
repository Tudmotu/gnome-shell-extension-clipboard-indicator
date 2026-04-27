# Clipboard Indicator New Features — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add duplicate detection, timestamps, snippets, quick-paste by number, and smart content icons to the GNOME clipboard indicator extension.

**Architecture:** Changes touch 7 files. Core data changes (timestamp + snippet fields) go in `registry.js`. New module `contentDetectors.js` handles content-type detection. UI/logic changes in `extension.js`. Settings in `constants.js`, GSschemas XML, and `prefs.js`.

**Tech Stack:** GJS (GNOME JavaScript), GNOME Shell 46+, St/Clutter UI toolkit, Adw preferences

**Testing:** Manual verification via GNOME Shell. Copy text, check menu behavior. No automated test framework exists for GNOME Shell extensions.

---

### Task 1: Add GSettings keys and constants

**Files:**
- Modify: `constants.js`
- Modify: `schemas/org.gnome.shell.extensions.clipboard-indicator.gschema.xml`

- [ ] **Step 1: Add new PrefsFields to constants.js**

Append to the `PrefsFields` object in `constants.js`:

```js
export const PrefsFields = {
    // ... existing entries ...
    SHOW_TIMESTAMPS                : 'show-timestamps',
    TIMESTAMP_FORMAT               : 'timestamp-format',
    SHOW_CONTENT_ICONS             : 'show-content-icons',
};
```

- [ ] **Step 2: Add new GSettings keys to schema XML**

Insert before `</schema>` (line 228) in `schemas/org.gnome.shell.extensions.clipboard-indicator.gschema.xml`:

```xml
    <key name="show-timestamps" type="b">
        <default>true</default>
        <summary>Show timestamps in menu</summary>
        <description>
            If true, each clipboard entry shows when it was captured.
        </description>
    </key>
    <key name="timestamp-format" type="i">
        <default>0</default>
        <summary>Timestamp display format</summary>
        <description>
            0 = relative ("2 min ago"), 1 = absolute ("14:30 27 Apr")
        </description>
        <range min="0" max="1"/>
    </key>
    <key name="show-content-icons" type="b">
        <default>true</default>
        <summary>Show smart content type icons</summary>
        <description>
            If true, each clipboard entry shows an icon indicating its content type (URL, email, path, code, text).
        </description>
    </key>
```

- [ ] **Step 3: Compile schema and commit**

```bash
glib-compile-schemas schemas/
git add constants.js schemas/
git commit -m "feat: add GSettings keys for timestamps, content icons"
```

---

### Task 2: Add timestamp and snippet support to ClipboardEntry

**Files:**
- Modify: `registry.js`

- [ ] **Step 1: Add timestamp and snippet fields to the ClipboardEntry constructor**

In `registry.js`, modify the `ClipboardEntry` class (line 208). Add `#timestamp` and `#snippet` private fields, update constructor:

```js
export class ClipboardEntry {
    #mimetype;
    #bytes;
    #favorite;
    #timestamp;
    #snippet;

    // ... static methods unchanged ...

    constructor (mimetype, bytes, favorite, timestamp, snippet) {
        this.#mimetype = mimetype;
        this.#bytes = bytes;
        this.#favorite = favorite;
        this.#timestamp = timestamp || Date.now();
        this.#snippet = !!snippet;
    }

    // ... encode unchanged ...

    isFavorite () {
        return this.#favorite;
    }

    set favorite (val) {
        this.#favorite = !!val;
    }

    get timestamp () {
        return this.#timestamp;
    }

    isSnippet () {
        return this.#snippet;
    }

    setSnippet (val) {
        this.#snippet = !!val;
    }

    // ... rest unchanged ...
}
```

- [ ] **Step 2: Update serialization in write() method**

In the `write` method (line 20), modify the item object:

```js
write (entries) {
    const registryContent = [];

    for (let entry of entries) {
        const item = {
            favorite: entry.isFavorite(),
            mimetype: entry.mimetype(),
            timestamp: entry.timestamp,
            snippet: entry.isSnippet()
        };

        if (entry.isText()) {
            item.contents = entry.getStringValue();
        }
        else if (entry.isImage()) {
            const filename = this.getEntryFilename(entry);
            item.contents = filename;
            this.writeEntryFile(entry);
        }

        registryContent.push(item);
    }

    this.writeToFile(registryContent);
}
```

- [ ] **Step 3: Update deserialization in fromJSON() method**

In `fromJSON` (line 223), read the new fields:

```js
static async fromJSON (jsonEntry) {
    const mimetype = jsonEntry.mimetype || 'text/plain;charset=utf-8';
    const favorite = jsonEntry.favorite;
    const timestamp = jsonEntry.timestamp || Date.now();
    const snippet = jsonEntry.snippet || false;
    let bytes;

    // ... existing bytes logic unchanged ...

    return new ClipboardEntry(mimetype, bytes, favorite, timestamp, snippet);
}
```

- [ ] **Step 4: Update creation in extension.js _refreshIndicator**

In `extension.js` line 1411, the `new ClipboardEntry(type, bytes.get_data(), false)` needs a third argument update — constructor now has 5 params but `false` still fills `favorite` correctly, `timestamp` and `snippet` will default. No change needed here (defaults handle it).

- [ ] **Step 5: Commit**

```bash
git add registry.js
git commit -m "feat: add timestamp and snippet fields to ClipboardEntry"
```

---

### Task 3: Create content type detection module

**Files:**
- Create: `contentDetectors.js`

- [ ] **Step 1: Create contentDetectors.js**

```js
export const ContentDetectors = [
    {
        type: 'url',
        icon: 'applications-internet-symbolic',
        priority: 100,
        test (text) {
            return /^(https?|ftp|sftp|file):\/\//i.test(text.trim());
        }
    },
    {
        type: 'email',
        icon: 'mail-unread-symbolic',
        priority: 90,
        test (text) {
            return /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(text.trim());
        }
    },
    {
        type: 'path',
        icon: 'folder-symbolic',
        priority: 80,
        test (text) {
            return /^\/[a-zA-Z0-9._/-]+$/.test(text.trim());
        }
    },
    {
        type: 'code',
        icon: 'text-x-generic-symbolic',
        priority: 70,
        test (text) {
            if (!text.includes('\n')) return false;
            const patterns = [
                /\b(function|class|def|import|const|let|var)\b/,
                /\b(if|for|while|return|export)\b/,
                /\{[\s\S]*\}/,
            ];
            return patterns.some(p => p.test(text));
        }
    },
];

const DEFAULT_ICON = 'text-x-generic-symbolic';

export function detectContentType (text) {
    if (!text || !text.trim()) return null;

    for (const detector of ContentDetectors.sort((a, b) => b.priority - a.priority)) {
        if (detector.test(text)) {
            return detector;
        }
    }

    return { type: 'text', icon: DEFAULT_ICON, priority: 0 };
}
```

- [ ] **Step 2: Commit**

```bash
git add contentDetectors.js
git commit -m "feat: add content type detection module"
```

---

### Task 4: Add duplicate detection

**Files:**
- Modify: `extension.js`

- [ ] **Step 1: Add duplicate check in _refreshIndicator**

In `extension.js`, inside `_refreshIndicator()` (line 769), after the `result` is obtained from `#getClipboardContent()` and before the `for` loop that checks existing items (around line 784), add a duplicate check against the latest entry:

In `_refreshIndicator`, find this section (around line 781):

```js
            if (result) {
                for (let menuItem of this.clipItemsRadioGroup) {
```

Modify it to check for duplicate first:

```js
            if (result) {
                // Duplicate detection: skip if identical to latest entry
                if (this.clipItemsRadioGroup.length > 0) {
                    const latestEntry = this.clipItemsRadioGroup[this.clipItemsRadioGroup.length - 1].entry;
                    if (latestEntry.equals(result)) {
                        this.#refreshInProgress = false;
                        return;
                    }
                }

                for (let menuItem of this.clipItemsRadioGroup) {
```

- [ ] **Step 2: Commit**

```bash
git add extension.js
git commit -m "feat: skip adding duplicate clipboard content"
```

---

### Task 5: Add timestamp display

**Files:**
- Modify: `extension.js`

- [ ] **Step 1: Add timestamp formatting helper**

Add near the top of `extension.js` (after the module-level variables around line 49):

```js
let SHOW_TIMESTAMPS           = true;
let TIMESTAMP_FORMAT          = 0; // 0 = relative, 1 = absolute

function formatTimestamp (timestamp, format) {
    if (!timestamp) return '';
    const now = Date.now();
    const diff = now - timestamp;
    const seconds = Math.floor(diff / 1000);

    if (format === 1) {
        // Absolute format
        const date = new Date(timestamp);
        const nowDate = new Date();
        const hours = date.getHours().toString().padStart(2, '0');
        const minutes = date.getMinutes().toString().padStart(2, '0');
        const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                        'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        const day = date.getDate();
        const month = months[date.getMonth()];
        if (date.getFullYear() !== nowDate.getFullYear()) {
            return `${hours}:${minutes} ${day} ${month} ${date.getFullYear()}`;
        }
        return `${hours}:${minutes} ${day} ${month}`;
    }

    // Relative format
    if (seconds < 10) return _('just now');
    if (seconds < 60) return _('%d min ago').replace('%d', Math.floor(seconds / 60) || 1);
    if (seconds < 3600) return _('%d min ago').replace('%d', Math.floor(seconds / 60));
    if (seconds < 86400) return _('%d hr ago').replace('%d', Math.floor(seconds / 3600));
    if (seconds < 604800) return _('%d days ago').replace('%d', Math.floor(seconds / 86400));
    if (seconds < 2592000) return _('%d weeks ago').replace('%d', Math.floor(seconds / 604800));
    if (seconds < 31536000) return _('%d months ago').replace('%d', Math.floor(seconds / 2592000));
    return _('> 1 year ago');
}
```

- [ ] **Step 2: Add timestamp label to each menu item in _addEntry**

In `_addEntry` (line 500), after the label is set with `_setEntryLabel`, add a timestamp label below it. Modify the method — after `this._setEntryLabel(menuItem);` (line 537), add:

```js
        this._setEntryLabel(menuItem);

        // Timestamp label
        menuItem.timestampLabel = new St.Label({
            style_class: 'ci-timestamp-label',
            text: '',
            y_align: Clutter.ActorAlign.CENTER
        });
        menuItem.actor.insert_child_below(menuItem.timestampLabel, menuItem.label);
        this._updateTimestampLabel(menuItem);
```

- [ ] **Step 3: Add _updateTimestampLabel helper method**

Add this method to the ClipboardIndicator class (near `_setEntryLabel`):

```js
    _updateTimestampLabel (menuItem) {
        if (!menuItem.timestampLabel) return;
        if (!SHOW_TIMESTAMPS) {
            menuItem.timestampLabel.hide();
            return;
        }
        menuItem.timestampLabel.show();
        menuItem.timestampLabel.set_text(formatTimestamp(menuItem.entry.timestamp, TIMESTAMP_FORMAT));
    }
```

- [ ] **Step 4: Fetch new settings in _fetchSettings**

In `_fetchSettings` (line 1112), add:

```js
        SHOW_TIMESTAMPS             = settings.get_boolean(PrefsFields.SHOW_TIMESTAMPS);
        TIMESTAMP_FORMAT            = settings.get_int(PrefsFields.TIMESTAMP_FORMAT);
```

- [ ] **Step 5: Update timestamps in _onSettingsChange**

In `_onSettingsChange` (line 1140), after the existing `_setEntryLabel` loop, add a loop to update timestamp labels:

```js
            this._getAllIMenuItems().forEach(function (mItem) {
                that._setEntryLabel(mItem);
                that._updateTimestampLabel(mItem);
                mItem.pasteBtn.visible = PASTE_BUTTON;
            });
```

- [ ] **Step 6: Add SHOW_CONTENT_ICONS to _fetchSettings (needed for Task 8)**

Also in `_fetchSettings`:

```js
let SHOW_CONTENT_ICONS         = true;

// in _fetchSettings:
        SHOW_CONTENT_ICONS          = settings.get_boolean(PrefsFields.SHOW_CONTENT_ICONS);
```

- [ ] **Step 7: Commit**

```bash
git add extension.js
git commit -m "feat: add timestamp display to menu items"
```

---

### Task 6: Add snippets section

**Files:**
- Modify: `extension.js`

- [ ] **Step 1: Add module-level snippet variables**

Near top of `extension.js` (after line 43):

```js
let PINNED_ON_BOTTOM          = false;
let CACHE_IMAGES              = true;
```

- [ ] **Step 2: Create snippets section in _buildMenu**

In `_buildMenu` (around line 217, after `favoritesSection` creation), add:

```js
        // Snippets
        that.snippetsSection = new PopupMenu.PopupMenuSection();

        that.scrollViewSnippetsMenuSection = new PopupMenu.PopupMenuSection();
        this.snippetsScrollView = new St.ScrollView({
            style_class: 'ci-history-menu-section',
            overlay_scrollbars: true
        });
        this.snippetsScrollView.add_child(that.snippetsSection.actor);
        that.scrollViewSnippetsMenuSection.actor.add_child(this.snippetsScrollView);
        this.snippetsSeparator = new PopupMenu.PopupSeparatorMenuItem();
```

- [ ] **Step 3: Add snippets section to menu in correct order**

After the history section addition block (around line 246, replacing the `if (PINNED_ON_BOTTOM)` block):

```js
        // Add sections ordered: Snippets (always on top) > Favorites/History
        that.menu.addMenuItem(that.scrollViewSnippetsMenuSection);
        if (PINNED_ON_BOTTOM) {
            that.menu.addMenuItem(that.scrollViewMenuSection);
            that.menu.addMenuItem(that.scrollViewFavoritesMenuSection);
        }
        else {
            that.menu.addMenuItem(that.scrollViewFavoritesMenuSection);
            that.menu.addMenuItem(that.scrollViewMenuSection);
        }
```

- [ ] **Step 4: Add snippet icon toggle to each menu item in _addEntry**

In `_addEntry` (after line 600, after the delete button creation), add a snippet toggle button:

```js
        // Snippet button
        let iconSnip = new St.Icon({
            icon_name: 'bookmark-new-symbolic',
            style_class: 'system-status-icon'
        });

        let snipBtn = new St.Button({
            style_class: 'ci-snippet-btn ci-action-btn',
            can_focus: true,
            child: iconSnip,
            x_align: Clutter.ActorAlign.END,
            x_expand: false,
            y_expand: true
        });

        menuItem.snipBtn = snipBtn;
        menuItem.snippetPressId = snipBtn.connect('clicked',
            () => this._snippetToggle(menuItem)
        );
        menuItem.actor.add_child(snipBtn);
```

- [ ] **Step 5: Handle snippet key press in menu item key handler**

In the `key-press-event` handler inside `_addEntry` (around line 514), add after the `KEY_p` case:

```js
                case Clutter.KEY_s:
                    this.#selectNextMenuItem(menuItem);
                    this._snippetToggle(menuItem);
                    break;
```

- [ ] **Step 6: Add _snippetToggle method**

```js
    _snippetToggle (menuItem) {
        const isSnippet = !menuItem.entry.isSnippet();
        menuItem.entry.setSnippet(isSnippet);
        menuItem.snipIcon.set_icon_name(
            isSnippet ? 'bookmark-filled-symbolic' : 'bookmark-new-symbolic'
        );
        this._moveItemFirst(menuItem);
        this._updateCache();
        this.#showElements();
    }
```

- [ ] **Step 6.5: Add _setSnippetIcon helper**

```js
    _setSnippetIcon (menuItem) {
        if (!menuItem.snipIcon) return;
        menuItem.snipIcon.set_icon_name(
            menuItem.entry.isSnippet() ? 'bookmark-filled-symbolic' : 'bookmark-new-symbolic'
        );
    }
```

Then in `_addEntry`, after creating the snippet button (Step 4), store the icon reference and set initial state:

```js
        menuItem.snipBtn = snipBtn;
        menuItem.snipIcon = iconSnip;
        this._setSnippetIcon(menuItem);
```

- [ ] **Step 7: Add _moveToSnippetSection and update _addEntry section logic**

In `_addEntry`, instead of only checking `isFavorite()` for section placement, also consider `isSnippet()`:

Replace this block (line 602):
```js
        if (entry.isFavorite()) {
            this.favoritesSection.addMenuItem(menuItem, 0);
        } else {
            this.historySection.addMenuItem(menuItem, 0);
        }
```

With:
```js
        if (entry.isSnippet()) {
            this.snippetsSection.addMenuItem(menuItem, 0);
        } else if (entry.isFavorite()) {
            this.favoritesSection.addMenuItem(menuItem, 0);
        } else {
            this.historySection.addMenuItem(menuItem, 0);
        }
```

- [ ] **Step 8: Exclude snippets from clearing in _clearHistory**

In `_clearHistory` (line 636), filter out snippets:

```js
        this.historySection._getMenuItems().forEach(mItem => {
            if (KEEP_SELECTED_ON_CLEAR === false || !mItem.currentlySelected) {
                if (mItem.entry.isSnippet()) return;
                this._removeEntry(mItem, 'delete');
            }
        });
```

- [ ] **Step 9: Exclude snippets from oldest-entry removal in _removeOldestEntries**

In `_removeOldestEntries` (line 681), filter snippet items out of the non-favorite pool:

```js
        let clipItemsRadioGroupNoFavorite = that.clipItemsRadioGroup.filter(
            item => item.entry.isFavorite() === false && item.entry.isSnippet() === false);
```

- [ ] **Step 10: Update #showElements to handle snippet separators**

In `#showElements` (line 360), add snippet separator handling:

In the separator section (around line 372), add before the favorites logic:

```js
            if (this.snippetsSection._getMenuItems().length > 0) {
                if (this.menu.box.contains(this.snippetsSeparator) === false) {
                    this.menu.box.insert_child_above(this.snippetsSeparator, this.scrollViewSnippetsMenuSection.actor);
                }
            }
            else if (this.menu.box.contains(this.snippetsSeparator) === true) {
                this.menu.box.remove_child(this.snippetsSeparator);
            }
```

- [ ] **Step 11: Update #hideElements to include snippet separator**

In `#hideElements` (line 352), add:

```js
        if (this.menu.box.contains(this.snippetsSeparator)) this.menu.box.remove_child(this.snippetsSeparator);
```

- [ ] **Step 12: Hide snippets section in private mode**

In `_onPrivateModeSwitch` (around line 1074), add alongside the existing visibility toggles:

```js
        this.scrollViewSnippetsMenuSection.actor.visible = !PRIVATEMODE;
        this.scrollViewFavoritesMenuSection.actor.visible = !PRIVATEMODE;
        this.scrollViewMenuSection.actor.visible = !PRIVATEMODE;
```

- [ ] **Step 13: Update _getAllIMenuItems to include snippets**

In `_getAllIMenuItems` (line 830):

```js
    _getAllIMenuItems () {
        return this.snippetsSection._getMenuItems().concat(this.historySection._getMenuItems()).concat(this.favoritesSection._getMenuItems());
    }
```

- [ ] **Step 14: Commit**

```bash
git add extension.js
git commit -m "feat: add snippets section with permanent items"
```

---

### Task 7: Add quick-paste by Alt+number

**Files:**
- Modify: `extension.js`

- [ ] **Step 1: Add Alt+number handler to menu**

In `_buildMenu`, after the existing `menu.connect('open-state-changed', ...)` block (around line 213), add a key-press handler on the menu actor:

```js
        that.menu.actor.connect('key-press-event', (actor, event) => {
            const modifier = event.get_state();
            const isAlt = modifier & Clutter.ModifierType.MOD1_MASK;
            if (!isAlt) return Clutter.EVENT_PROPAGATE;

            const keyMap = {
                [Clutter.KEY_1]: 0, [Clutter.KEY_2]: 1, [Clutter.KEY_3]: 2,
                [Clutter.KEY_4]: 3, [Clutter.KEY_5]: 4, [Clutter.KEY_6]: 5,
                [Clutter.KEY_7]: 6, [Clutter.KEY_8]: 7, [Clutter.KEY_9]: 8,
            };

            const index = keyMap[event.get_key_symbol()];
            if (index === undefined) return Clutter.EVENT_PROPAGATE;

            const visibleItems = this.clipItemsRadioGroup.filter(m => m.actor.visible);
            if (index < visibleItems.length) {
                this._onMenuItemSelectedAndMenuClose(visibleItems[index], true);
            }

            return Clutter.EVENT_STOP;
        });
```

- [ ] **Step 2: Commit**

```bash
git add extension.js
git commit -m "feat: add quick-paste by Alt+1 through Alt+9"
```

---

### Task 8: Add smart content icons

**Files:**
- Modify: `extension.js`

- [ ] **Step 1: Add import for content detectors**

At top of `extension.js` (after line 16):

```js
import { detectContentType } from './contentDetectors.js';
```

- [ ] **Step 2: Add content-type icon to each menu item in _addEntry**

In `_addEntry`, after the label is created (around line 502), add a content-type icon to the left side. After `menuItem.clipContents = entry.getStringValue();`:

```js
        menuItem.clipContents = entry.getStringValue();
        menuItem.contentIcon = new St.Icon({
            style_class: 'ci-content-type-icon system-status-icon',
            icon_name: 'text-x-generic-symbolic',
            y_align: Clutter.ActorAlign.CENTER
        });
        menuItem.actor.insert_child_at_index(menuItem.contentIcon, 0);
        this._updateContentIcon(menuItem);
```

- [ ] **Step 3: Add _updateContentIcon method**

```js
    _updateContentIcon (menuItem) {
        if (!menuItem.contentIcon || !SHOW_CONTENT_ICONS) {
            if (menuItem.contentIcon) menuItem.contentIcon.hide();
            return;
        }
        if (!menuItem.entry.isText()) {
            menuItem.contentIcon.set_icon_name('image-x-generic-symbolic');
            menuItem.contentIcon.show();
            return;
        }
        const detector = detectContentType(menuItem.entry.getStringValue());
        menuItem.contentIcon.set_icon_name(detector.icon);
        menuItem.contentIcon.show();
    }
```

- [ ] **Step 4: Update _setEntryLabel to also refresh icon**

In `_setEntryLabel` (line 448), at the end, call:

```js
        this._updateContentIcon(menuItem);
```

- [ ] **Step 5: Update _onSettingsChange to refresh all icons**

In `_onSettingsChange`, inside the forEach loop (alongside `_setEntryLabel` and `_updateTimestampLabel`):

```js
                that._updateContentIcon(mItem);
```

- [ ] **Step 6: Commit**

```bash
git add extension.js
git commit -m "feat: add smart content type icons to menu items"
```

---

### Task 9: Add settings UI

**Files:**
- Modify: `prefs.js`

- [ ] **Step 1: Create timestamp and content icon preference widgets**

In `prefs.js`, in the `Settings` constructor, after the existing field declarations (around line 166), add:

```js
        this.field_show_timestamps = new Adw.SwitchRow({
            title: _("Show timestamps in menu"),
            subtitle: _("Displays when each clipboard item was captured")
        });

        this.field_timestamp_format = new Adw.ComboRow({
            title: _("Timestamp format"),
            model: this.#createTimestampFormatOptions()
        });

        this.field_show_content_icons = new Adw.SwitchRow({
            title: _("Show content type icons"),
            subtitle: _("Displays an icon indicating the content type (URL, email, file path, code)")
        });
```

- [ ] **Step 2: Add _createTimestampFormatOptions method**

After `#createDisplayModeOptions` (line 254):

```js
    #createTimestampFormatOptions () {
        let options = [
            _("Relative (2 min ago)"),
            _("Absolute (14:30 27 Apr)")
        ];
        let liststore = new Gtk.StringList();
        for (let option of options) {
            liststore.append(option);
        }
        return liststore;
    }
```

- [ ] **Step 3: Wire timestamp format visibility to show-timestamps toggle**

After widget creation (after step 1), connect: 

```js
        this.field_show_timestamps.connect('notify::active', (widget) => {
            this.field_timestamp_format.set_sensitive(widget.active);
        });
```

- [ ] **Step 4: Add widgets to the UI group**

In the UI group (around line 181), add:

```js
        this.ui = new Adw.PreferencesGroup({ title: _('UI') });
        // ... existing adds ...
        this.ui.add(this.field_show_timestamps);
        this.ui.add(this.field_timestamp_format);
        this.ui.add(this.field_show_content_icons);
```

- [ ] **Step 5: Add schema bindings**

After the existing bindings (around line 236), add:

```js
        this.schema.bind(PrefsFields.SHOW_TIMESTAMPS, this.field_show_timestamps, 'active', Gio.SettingsBindFlags.DEFAULT);
        this.schema.bind(PrefsFields.TIMESTAMP_FORMAT, this.field_timestamp_format, 'selected', Gio.SettingsBindFlags.DEFAULT);
        this.schema.bind(PrefsFields.SHOW_CONTENT_ICONS, this.field_show_content_icons, 'active', Gio.SettingsBindFlags.DEFAULT);
```

- [ ] **Step 6: Set initial sensitivity of timestamp format**

At end of constructor (line 239), add:

```js
        this.field_timestamp_format.set_sensitive(this.field_show_timestamps.active);
```

- [ ] **Step 7: Commit**

```bash
git add prefs.js
git commit -m "feat: add preferences UI for timestamps and content icons"
```

---

### Task 10: Add styles

**Files:**
- Modify: `stylesheet.css`

- [ ] **Step 1: Add new CSS classes**

```css
.ci-timestamp-label {
    font-size: 0.75em;
    color: rgba(255, 255, 255, 0.5);
    margin-left: 1.5em;
}

.ci-content-type-icon {
    margin-right: 0.5em;
}

.ci-snippet-btn {
    color: rgba(255, 255, 255, 0.3);
}

.ci-snippet-btn:active,
.ci-snippet-btn:checked {
    color: rgba(255, 200, 0, 0.8);
}
```

- [ ] **Step 2: Add snippet-active styling for menu items that are snippets**

```css
.popup-menu-item.ci-snippet-item {
    border-left: 2px solid rgba(255, 200, 0, 0.5);
}
```

- [ ] **Step 3: Commit**

```bash
git add stylesheet.css
git commit -m "style: add styles for timestamps, content icons, and snippets"
```

---

### Task 11: Final integration — rebuild schema and verify

- [ ] **Step 1: Rebuild schemas**

```bash
glib-compile-schemas schemas/
```

- [ ] **Step 2: Copy all changed files to extension install dir**

```bash
cp extension.js ~/.local/share/gnome-shell/extensions/clipboard-indicator@tudmotu.com/extension.js
cp registry.js ~/.local/share/gnome-shell/extensions/clipboard-indicator@tudmotu.com/registry.js
cp constants.js ~/.local/share/gnome-shell/extensions/clipboard-indicator@tudmotu.com/constants.js
cp contentDetectors.js ~/.local/share/gnome-shell/extensions/clipboard-indicator@tudmotu.com/contentDetectors.js
cp prefs.js ~/.local/share/gnome-shell/extensions/clipboard-indicator@tudmotu.com/prefs.js
cp stylesheet.css ~/.local/share/gnome-shell/extensions/clipboard-indicator@tudmotu.com/stylesheet.css
cp schemas/org.gnome.shell.extensions.clipboard-indicator.gschema.xml ~/.local/share/gnome-shell/extensions/clipboard-indicator@tudmotu.com/schemas/org.gnome.shell.extensions.clipboard-indicator.gschema.xml
cp schemas/gschemas.compiled ~/.local/share/gnome-shell/extensions/clipboard-indicator@tudmotu.com/schemas/gschemas.compiled
```

- [ ] **Step 3: Reload extension**

```bash
gnome-extensions disable clipboard-indicator@tudmotu.com && sleep 1 && gnome-extensions enable clipboard-indicator@tudmotu.com
```

- [ ] **Step 4: Verify extension is active**

```bash
gnome-extensions info clipboard-indicator@tudmotu.com
```

Expected: State = ACTIVE

- [ ] **Step 5: Manual verification checklist**
  - [ ] Copy some text → appears in menu with timestamp
  - [ ] Copy same text again → only one entry (duplicate detection)
  - [ ] Toggle "Show timestamps" off/on in settings → timestamps hide/show
  - [ ] Switch timestamp format → format changes
  - [ ] Press `s` on an item → moved to Snippets section
  - [ ] Clear history → snippet remains
  - [ ] Open menu, press Alt+1 → first visible item pasted
  - [ ] Copy a URL → globe icon appears
  - [ ] Copy an email → mail icon appears
  - [ ] Copy a file path → folder icon appears
  - [ ] Copy code → code icon appears
  - [ ] Toggle "Show content type icons" off → icons hide

- [ ] **Step 6: Commit schema rebuild**

```bash
git add schemas/gschemas.compiled
git commit -m "chore: rebuild compiled schemas with new settings keys"
```
