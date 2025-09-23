import Adw from 'gi://Adw';
import GObject from 'gi://GObject';
import Gtk from 'gi://Gtk';
import Gdk from 'gi://Gdk';
import Gio from 'gi://Gio';
import { ExtensionPreferences, gettext as _ } from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';
import { PrefsFields } from './constants.js';

export default class ClipboardIndicatorPreferences extends ExtensionPreferences {
    fillPreferencesWindow (window) {
        window._settings = this.getSettings();
        const settingsUI = new Settings(window._settings);
        const page = new Adw.PreferencesPage();
        page.add(settingsUI.ui);
        page.add(settingsUI.behavior);
        page.add(settingsUI.search);
        page.add(settingsUI.shortcuts);
        page.add(settingsUI.about);
        window.add(page);
    }
}

class Settings {
    constructor (schema) {
        this.schema = schema;

        this.ui = new Adw.PreferencesGroup({
            title: _("User Interface")
        });

        this.behavior = new Adw.PreferencesGroup({
            title: _("Behavior")
        });

        this.search = new Adw.PreferencesGroup({
            title: _("Search")
        });

        this.shortcuts = new Adw.PreferencesGroup({
            title: _("Keyboard shortcuts")
        });

        this.about = new Adw.PreferencesGroup({
            title: _("About")
        });

        this.field_preview_size = new Adw.SpinRow({
            title: _("Max number of characters in history"),
            adjustment: new Gtk.Adjustment({
                lower: 1,
                upper: 1000,
                step_increment: 1
            })
        });

        this.field_history_size = new Adw.SpinRow({
            title: _("History size"),
            adjustment: new Gtk.Adjustment({
                lower: 1,
                upper: 1000,
                step_increment: 1
            })
        });

        this.field_cache_size = new Adw.SpinRow({
            title: _("Max cache file size (MB)"),
            adjustment: new Gtk.Adjustment({
                lower: 1,
                upper: 1024,
                step_increment: 1
            })
        });

        this.field_topbar_preview_size = new Adw.SpinRow({
            title: _("Number of characters in top bar"),
            adjustment: new Gtk.Adjustment({
                lower: 1,
                upper: 100,
                step_increment: 1
            })
        });

        this.field_topbar_display_mode = new Adw.ComboRow({
            title: _("Top bar indicator style"),
            model: new Gtk.StringList({
                strings: [
                    _("Show only icon"),
                    _("Show only clipboard content"),
                    _("Show both"),
                    _("Show neither")
                ]
            })
        });

        this.field_delete = new Adw.SwitchRow({
            title: _("Show delete button")
        });

        this.field_move_first = new Adw.SwitchRow({
            title: _("Move item to top on re-select")
        });

        this.field_notify_on_copy = new Adw.SwitchRow({
            title: _("Show notification on copy")
        });

        this.field_notify_on_cycle = new Adw.SwitchRow({
            title: _("Show notification on selection change via shortcut")
        });

        this.field_enable_keybinding = new Adw.SwitchRow({
            title: _("Enable shortcuts")
        });

        this.field_clear_on_boot = new Adw.SwitchRow({
            title: _("Clear clipboard history on system reboot")
        });

        this.field_paste_on_select = new Adw.SwitchRow({
            title: _("Paste on select (Enter/Click)")
        });

        this.field_disable_down_arrow = new Adw.SwitchRow({
            title: _("Show dropdown arrow")
        });

        this.field_strip_text = new Adw.SwitchRow({
            title: _("Strip non-printable characters")
        });

        this.field_keep_selected = new Adw.SwitchRow({
            title: _("Keep selected item when clearing history")
        });

        this.field_paste_button = new Adw.SwitchRow({
            title: _("Show paste button")
        });

        this.field_pinned_on_bottom = new Adw.SwitchRow({
            title: _("Show favorites at bottom")
        });

        // NEW: toggleable UI switches (add once)
        this.field_show_search_bar = new Adw.SwitchRow({
          title: _("Show Search Bar")
        });
        this.schema.bind(PrefsFields.SHOW_SEARCH_BAR, this.field_show_search_bar, 'active', Gio.SettingsBindFlags.DEFAULT);
        this.ui.add(this.field_show_search_bar);
    
        this.field_show_private_mode = new Adw.SwitchRow({
          title: _("Show Private Mode")
        });
        this.schema.bind(PrefsFields.SHOW_PRIVATE_MODE, this.field_show_private_mode, 'active', Gio.SettingsBindFlags.DEFAULT);
        this.ui.add(this.field_show_private_mode);
    
        this.field_show_settings_button = new Adw.SwitchRow({
          title: _("Show Settings Button")
        });
        this.schema.bind(PrefsFields.SHOW_SETTINGS_BUTTON, this.field_show_settings_button, 'active', Gio.SettingsBindFlags.DEFAULT);
        this.ui.add(this.field_show_settings_button);
    
        this.field_show_clear_history_button = new Adw.SwitchRow({
          title: _("Show Clear History Button")
        });
        this.schema.bind(PrefsFields.SHOW_CLEAR_HISTORY_BUTTON, this.field_show_clear_history_button, 'active', Gio.SettingsBindFlags.DEFAULT);
        this.ui.add(this.field_show_clear_history_button);

        this.field_cache_images = new Adw.SwitchRow({
            title: _("Cache images to disk")
        });

        this.ui.add(this.field_preview_size);
        this.ui.add(this.field_history_size);
        this.ui.add(this.field_cache_size);
        this.ui.add(this.field_topbar_preview_size);
        this.ui.add(this.field_topbar_display_mode);
        this.ui.add(this.field_delete);
        this.ui.add(this.field_move_first);
        this.ui.add(this.field_notify_on_copy);
        this.ui.add(this.field_notify_on_cycle);
        this.ui.add(this.field_enable_keybinding);
        this.ui.add(this.field_paste_button);
        this.ui.add(this.field_pinned_on_bottom);

        this.behavior.add(this.field_clear_on_boot);
        this.behavior.add(this.field_paste_on_select);
        this.behavior.add(this.field_cache_images);
        this.behavior.add(this.field_clear_history_on_interval);
        this.behavior.add(this.field_clear_history_interval);

        this.field_clear_history_on_interval = new Adw.SwitchRow({
            title: _("Clear clipboard history on interval")
        });

        this.field_clear_history_interval = new Adw.SpinRow({
            title: _("Interval (minutes)"),
            adjustment: new Gtk.Adjustment({
                lower: 1,
                upper: 1440,
                step_increment: 1
            })
        });

        this.schema.bind(PrefsFields.CLEAR_HISTORY_ON_INTERVAL, this.field_clear_history_on_interval, 'active', Gio.SettingsBindFlags.DEFAULT);
        this.schema.bind(PrefsFields.CLEAR_HISTORY_INTERVAL, this.field_clear_history_interval, 'value', Gio.SettingsBindFlags.DEFAULT);

        // Search options
        this.field_case_sensitive_search = new Adw.SwitchRow({
            title: _("Case-sensitive search")
        });
        this.field_regex_search = new Adw.SwitchRow({
            title: _("Regular expression matching in search")
        });

        this.search.add(this.field_case_sensitive_search);
        this.search.add(this.field_regex_search);

        this.schema.bind(PrefsFields.CASE_SENSITIVE_SEARCH, this.field_case_sensitive_search, 'active', Gio.SettingsBindFlags.DEFAULT);
        this.schema.bind(PrefsFields.REGEX_SEARCH, this.field_regex_search, 'active', Gio.SettingsBindFlags.DEFAULT);

        // Excluded apps UI
        this.field_exclusion_row = new Adw.ExpanderRow({
            title: _("Exclude Apps (wm_class names)"),
            subtitle: _("Clipboard history disabled for these apps")
        });
        this.field_exclusion_row.set_enable_expansion(false);
        this.field_exclusion_row.set_expanded(false);

        this.field_exclusion_row_add_button = new Gtk.Button({
            icon_name: 'list-add-symbolic'
        });

        this.field_exclusion_row_add_button.connect('clicked', () => {
            this.field_exclusion_row_add_button.set_sensitive(false);
            this.excluded_row_counter++;
            this.field_exclusion_row.set_expanded(true);
            this.field_exclusion_row.add_row(this.#createExcludedAppInputRow());
        });

        this.field_exclusion_row.add_suffix(this.field_exclusion_row_add_button);

        this.field_clear_history_on_interval = new Adw.SwitchRow({
            title: _("Clear clipboard history on interval")
        });

        this.field_clear_history_interval = new Adw.SpinRow({
            title: _("Interval (minutes)"),
            adjustment: new Gtk.Adjustment({
                lower: 1,
                upper: 1440,
                step_increment: 1
            })
        });

        this.schema.bind(PrefsFields.CLEAR_HISTORY_ON_INTERVAL, this.field_clear_history_on_interval, 'active', Gio.SettingsBindFlags.DEFAULT);
        this.schema.bind(PrefsFields.CLEAR_HISTORY_INTERVAL, this.field_clear_history_interval, 'value', Gio.SettingsBindFlags.DEFAULT);

        this.behavior.add(this.field_exclusion_row);

        this.shortcuts.add(this._createShortcutRow(_('Toggle menu'), PrefsFields.BINDING_TOGGLE_MENU));
        this.shortcuts.add(this._createShortcutRow(_('Previous entry'), PrefsFields.BINDING_PREV_ENTRY));
        this.shortcuts.add(this._createShortcutRow(_('Next entry'), PrefsFields.BINDING_NEXT_ENTRY));
        this.shortcuts.add(this._createShortcutRow(_('Clear history'), PrefsFields.BINDING_CLEAR_HISTORY));
        this.shortcuts.add(this._createShortcutRow(_('Toggle private mode'), PrefsFields.BINDING_PRIVATE_MODE));

        this.about.add(this._createLinkRow(_('Source code'), 'https://github.com/Tudmotu/gnome-shell-extension-clipboard-indicator'));
        this.about.add(this._createLinkRow(_('Report an issue'), 'https://github.com/Tudmotu/gnome-shell-extension-clipboard-indicator/issues'));

        // Bindings
        this.schema.bind(PrefsFields.PREVIEW_SIZE, this.field_preview_size, 'value', Gio.SettingsBindFlags.DEFAULT);
        this.schema.bind(PrefsFields.HISTORY_SIZE, this.field_history_size, 'value', Gio.SettingsBindFlags.DEFAULT);
        this.schema.bind(PrefsFields.CACHE_SIZE, this.field_cache_size, 'value', Gio.SettingsBindFlags.DEFAULT);
        this.schema.bind(PrefsFields.TOPBAR_PREVIEW_SIZE, this.field_topbar_preview_size, 'value', Gio.SettingsBindFlags.DEFAULT);
        this.schema.bind(PrefsFields.TOPBAR_DISPLAY_MODE_ID, this.field_topbar_display_mode, 'selected', Gio.SettingsBindFlags.DEFAULT);
        this.schema.bind(PrefsFields.DELETE, this.field_delete, 'active', Gio.SettingsBindFlags.DEFAULT);
        this.schema.bind(PrefsFields.MOVE_ITEM_FIRST, this.field_move_first, 'active', Gio.SettingsBindFlags.DEFAULT);
        this.schema.bind(PrefsFields.NOTIFY_ON_COPY, this.field_notify_on_copy, 'active', Gio.SettingsBindFlags.DEFAULT);
        this.schema.bind(PrefsFields.NOTIFY_ON_CYCLE, this.field_notify_on_cycle, 'active', Gio.SettingsBindFlags.DEFAULT);
        this.schema.bind(PrefsFields.ENABLE_KEYBINDING, this.field_enable_keybinding, 'active', Gio.SettingsBindFlags.DEFAULT);
        this.schema.bind(PrefsFields.CLEAR_ON_BOOT, this.field_clear_on_boot, 'active', Gio.SettingsBindFlags.DEFAULT);
        this.schema.bind(PrefsFields.PASTE_ON_SELECT, this.field_paste_on_select, 'active', Gio.SettingsBindFlags.DEFAULT);
        this.schema.bind(PrefsFields.DISABLE_DOWN_ARROW, this.field_disable_down_arrow, 'active', Gio.SettingsBindFlags.DEFAULT);
        this.schema.bind(PrefsFields.STRIP_TEXT, this.field_strip_text, 'active', Gio.SettingsBindFlags.DEFAULT);
        this.schema.bind(PrefsFields.KEEP_SELECTED_ON_CLEAR, this.field_keep_selected, 'active', Gio.SettingsBindFlags.DEFAULT);
        this.schema.bind(PrefsFields.PASTE_BUTTON, this.field_paste_button, 'active', Gio.SettingsBindFlags.DEFAULT);
        this.schema.bind(PrefsFields.PINNED_ON_BOTTOM, this.field_pinned_on_bottom, 'active', Gio.SettingsBindFlags.DEFAULT);

        this.#fetchExludedAppsList();
        this.#updateExcludedAppRow();
    }

    _createShortcutRow (title, settingName) {
        const row = new Adw.ActionRow({ title });
        const btn = new Gtk.Button({
            has_frame: true,
            child: new Gtk.ShortcutLabel({
                disabled_text: _("Disabled"),
                accelerator: this.schema.get_strv(settingName)[0] || ''
            })
        });

        btn.connect('clicked', () => {
            const dlg = new Gtk.Dialog({
                modal: true,
                transient_for: row.get_root()
            });

            const content = dlg.get_content_area();
            const ctrl = new Gtk.ShortcutsEditor({
                accelerator: btn.child.accelerator,
                can_clear: true
            });

            content.append(ctrl);

            dlg.connect('response', () => {
                const accels = ctrl.get_accelerator() ? [ctrl.get_accelerator()] : [];
                this.schema.set_strv(settingName, accels);
                btn.child.set_accelerator(ctrl.get_accelerator() || '');
                dlg.destroy();
            });

            dlg.add_button(_('Cancel'), Gtk.ResponseType.CANCEL);
            dlg.add_button(_('OK'), Gtk.ResponseType.OK);
            dlg.show();
        });

        row.add_suffix(btn);
        return row;
    }

    _createLinkRow (title, url) {
        const row = new Adw.ActionRow({ title });
        const btn = new Gtk.Button({
            has_frame: true,
            child: new Gtk.Image({
                icon_name: 'emblem-system-symbolic'
            })
        });

        btn.connect('clicked', () => {
            Gtk.show_uri(null, url, Gdk.CURRENT_TIME);
        });

        row.add_suffix(btn);
        return row;
    }

    #createExcludedAppInputRow () {
        const row = new Adw.EntryRow({
            title: _("Add wm_class to exclude"),
            show_apply_button: true
        });

        row.connect('apply', () => {
            const value = row.text.trim();
            if (!value) return;

            row.set_title(value);
            row.set_show_apply_button(false);
            row.set_activatable_widget(null);
            row.set_activatable(false);
            row.set_sensitive(false);
            this.schema.set_strv('excluded-apps', [...this.schema.get_strv('excluded-apps'), value]);

            this.field_exclusion_row_add_button.set_sensitive(true);
        });

        return row;
    }

    #createExludedAppRow (value) {
        const row = new Adw.ActionRow({
            title: value
        });

        const del = new Gtk.Button({
            has_frame: true,
            icon_name: 'user-trash-symbolic'
        });

        del.connect('clicked', () => {
            const list = this.schema.get_strv('excluded-apps').filter(x => x !== value);
            this.schema.set_strv('excluded-apps', list);
            this.field_exclusion_row.remove(row);
            this.excluded_row_counter--;
            this.#updateExcludedAppRow();
        });

        row.add_suffix(del);
        return row;
    }

    #fetchExludedAppsList() {
        const excludedApps = this.schema.get_strv('excluded-apps');
        for (const app of excludedApps) {
            this.field_exclusion_row.add_row(this.#createExludedAppRow(app));
        }
        this.excluded_row_counter = excludedApps.length;
    }

    #updateExcludedAppRow() {
        const hasExcludedApps = this.excluded_row_counter > 0;
        this.field_exclusion_row.set_enable_expansion(hasExcludedApps);
        this.field_exclusion_row.set_expanded(hasExcludedApps);
    }
}
