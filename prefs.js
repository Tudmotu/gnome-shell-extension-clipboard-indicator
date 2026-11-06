import Adw from 'gi://Adw';
import GObject from 'gi://GObject';
import Gtk from 'gi://Gtk';
import Gdk from 'gi://Gdk';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import { ExtensionPreferences, gettext as _ } from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';
import { PrefsFields } from './constants.js';

export default class ClipboardIndicatorPreferences extends ExtensionPreferences {
    fillPreferencesWindow (window) {
        window._settings = this.getSettings();
        const settingsUI = new Settings(window._settings);
        settingsUI.window = window;

        const tabs = [
            { title: _('UI'),            iconName: 'view-grid-symbolic',               groups: [settingsUI.ui, settingsUI.item_actions] },
            { title: _('Behavior'),      iconName: 'system-run-symbolic',              groups: [settingsUI.behavior] },
            { title: _('Search'),        iconName: 'system-search-symbolic',           groups: [settingsUI.search] },
            { title: _('Limits'),        iconName: 'preferences-system-symbolic',      groups: [settingsUI.limits] },
            { title: _('Exclusion'),     iconName: 'action-unavailable-symbolic',      groups: [settingsUI.exclusion] },
            { title: _('Topbar'),        iconName: 'edit-paste-symbolic',              groups: [settingsUI.topbar] },
            { title: _('Notifications'), iconName: 'emoji-objects-symbolic',           groups: [settingsUI.notifications] },
            { title: _('Shortcuts'),     iconName: 'input-keyboard-symbolic',          groups: [settingsUI.shortcuts] },
            { title: _('Import / Export'), iconName: 'document-save-symbolic',         groups: [settingsUI.archive] },
        ];

        window.set_default_size(700, 650);

        for (const { title, iconName, groups } of tabs) {
            const page = new Adw.PreferencesPage({ title, icon_name: iconName });
            groups.forEach(g => page.add(g));
            window.add(page);
        }
    }
}

class Settings {
    constructor (schema) {
        this.schema = schema;

        this.field_size = new Adw.SpinRow({
            title: _("History Size"),
            subtitle: _("Maximum number of entries to keep in clipboard history"),
            adjustment: new Gtk.Adjustment({
                lower: 1,
                upper: 10000,
                step_increment: 1
            })
        });

        this.field_preview_size = new Adw.SpinRow({
            title: _("Preview Size (characters)"),
            subtitle: _("Number of characters shown per entry in the history menu"),
            adjustment: new Gtk.Adjustment({
                lower: 10,
                upper: 100,
                step_increment: 1
            })
        });

        this.field_cache_size = new Adw.SpinRow({
            title: _("Max cache file size (MB)"),
            subtitle: _("Maximum disk space used for caching clipboard data"),
            adjustment: new Gtk.Adjustment({
                lower: 1,
                upper: 1024,
                step_increment: 1
            })
        });

        this.field_topbar_preview_size = new Adw.SpinRow({
            title: _("Number of characters in top bar"),
            subtitle: _("Length of the clipboard content preview shown in the panel"),
            adjustment: new Gtk.Adjustment({
                lower: 1,
                upper: 100,
                step_increment: 1
            })
        });

        this.field_display_mode = new Adw.ComboRow({
            title: _("What to show in top bar"),
            model: this.#createDisplayModeOptions()
        });

        this.field_disable_down_arrow = new Adw.SwitchRow({
            title: _("Remove down arrow in top bar"),
            subtitle: _("Hide the dropdown arrow next to the clipboard indicator")
        });

        this.field_blink_icon_on_copy = new Adw.SwitchRow({
            title: _("Blink icon on copy"),
            subtitle: _("Briefly flash the indicator icon when something is copied")
        });

        this.field_cache_disable = new Adw.SwitchRow({
            title: _("Cache only pinned items"),
            subtitle: _("Only save pinned (favorite) entries to disk")
        });

        this.field_copy_notification_toggle = new Adw.SwitchRow({
            title: _("Show notification on copy"),
            subtitle: _("Display a notification each time text is copied")
        });

        this.field_cycle_notification_toggle = new Adw.SwitchRow({
            title: _("Show notification on cycle"),
            subtitle: _("Display a notification when cycling through entries with shortcuts")
        });

        this.field_clear_notification_toggle = new Adw.SwitchRow({
            title: _("Show notification on Clear History"),
            subtitle: _("Display a notification when clipboard history is cleared")
        });

        this.field_import_export_notification_toggle = new Adw.SwitchRow({
            title: _("Show notification on Import/Export"),
            subtitle: _("Display a notification when clipboard history is imported or exported")
        });

        this.field_confirm_clear_toggle = new Adw.SwitchRow({
            title: _("Prompt for confirmation on Clear History"),
            subtitle: _("Ask before deleting all clipboard entries")
        });

        this.field_confirm_pinned_delete_toggle = new Adw.SwitchRow({
            title: _("Prompt before deleting pinned item"),
            subtitle: _("Ask for confirmation before deleting a pinned item")
        });

        this.field_strip_text = new Adw.SwitchRow({
            title: _("Remove whitespace around text"),
            subtitle: _("Strip leading and trailing whitespace from text entries on copy")
        });

        this.field_move_item_first = new Adw.SwitchRow({
            title: _("Move item to the top after selection"),
            subtitle: _("When selecting an entry, bring it to the top of the history")
        });

        this.field_keep_selected_on_clear = new Adw.SwitchRow({
            title: _("Keep selected entry after Clear History"),
            subtitle: _("The currently active clipboard entry will not be removed when clearing history")
        });

        this.field_pinned_on_bottom = new Adw.SwitchRow({
            title: _("Place the pinned section on the bottom"),
            subtitle: _("Move the pinned section to the bottom of the menu. Requires re-login")
        });

        this.field_show_search_bar = new Adw.SwitchRow({
            title: _("Show Search Bar"),
            subtitle: _("Display a search field at the top of the clipboard menu")
        });
        this.field_show_private_mode = new Adw.SwitchRow({
            title: _("Show Private Mode"),
            subtitle: _("Display the private mode toggle in the clipboard menu")
        });
        this.field_show_settings_button = new Adw.SwitchRow({
            title: _("Show Settings Button"),
            subtitle: _("Display a shortcut to these settings in the clipboard menu")
        });
        this.field_show_clear_history_button = new Adw.SwitchRow({
            title: _("Show Clear History Button"),
            subtitle: _("Display the clear history button in the clipboard menu")
        });

        this.field_clear_on_boot = new Adw.SwitchRow({
            title: _("Clear clipboard history on system reboot"),
            subtitle: _("Delete all cached clipboard entries when the system starts")
        });

        this.field_paste_on_select = new Adw.SwitchRow({
            title: _("Paste on select"),
            subtitle: _("Automatically paste the entry into the active window when selected")
        });

        this.field_open_at_cursor = new Adw.SwitchRow({
            title: _("Open menu at cursor"),
            subtitle: _("When using the keyboard shortcut, open the menu at the cursor position")
        });

        this.field_show_delete_button = new Adw.SwitchRow({
            title: _("Delete"),
            subtitle: _("Show the delete button on each item")
        });

        this.field_show_tag_button = new Adw.SwitchRow({
            title: _("Tag"),
            subtitle: _("Show the tag button on each item")
        });

        this.field_paste_button = new Adw.SwitchRow({
            title: _("Paste"),
            subtitle: _("Show the paste button on each item")
        });

        this.field_show_pin_button = new Adw.SwitchRow({
            title: _("Pin"),
            subtitle: _("Show the pin/favorite button on each item")
        });

        this.field_show_edit_button = new Adw.SwitchRow({
            title: _("Edit"),
            subtitle: _("Show the edit button on each text item")
        });

        this.field_show_preview_button = new Adw.SwitchRow({
            title: _("Preview"),
            subtitle: _("Show the preview button on each image item")
        });

        this.field_cache_images = new Adw.SwitchRow({
            title: _("Cache images"),
            subtitle: _("Save copied images to clipboard history"),
            active: true
        });

        this.field_exclusion_row = new Adw.ExpanderRow({
            title: _('Excluded Apps'),
            subtitle: _('Content copied will not be saved while these apps are in focus'),
        });

        this.field_exclusion_row_add_button = new Gtk.Button({
            iconName: 'list-add-symbolic',
            cssClasses: ['flat'],
            valign: Gtk.Align.CENTER,
            halign: Gtk.Align.CENTER,
        });

        this.case_sensitive_search = new Adw.SwitchRow({
            title: _("Case-sensitive"),
            subtitle: _("Match uppercase and lowercase letters exactly when searching")
        });

        this.regex_search = new Adw.SwitchRow({
            title: _("Regular expressions"),
            subtitle: _("Allow regular expressions to filter clipboard entries")
        });

        this.field_exclusion_row_add_button.connect('clicked', () => {
            this.field_exclusion_row_add_button.set_sensitive(false);
            this.excluded_row_counter++;
            this.field_exclusion_row.set_expanded(true);
            this.field_exclusion_row.add_row(this.#createExcludedAppInputRow());
        });

        this.field_exclusion_row.add_suffix(this.field_exclusion_row_add_button);

        this.field_clear_history_on_interval = new Adw.SwitchRow({
            title: _("Clear clipboard history on interval"),
            subtitle: _("Automatically clear clipboard history at a recurring interval")
        });

        this.field_clear_history_interval = new Adw.SpinRow({
            title: _("History clear interval (in minutes)"),
            adjustment: new Gtk.Adjustment({
            lower: 1,
            upper: 1440,
            step_increment: 10
            })
        });

        this.field_clear_history_on_interval.connect('notify::active', (widget) => {
            this.field_clear_history_interval.set_sensitive(widget.active);
        });

        this.ui =  new Adw.PreferencesGroup({ title: _('UI') });
        this.behavior = new Adw.PreferencesGroup({title: _('Behavior')});
        this.exclusion = new Adw.PreferencesGroup({ title: _('Exclusion') });
        this.limits =  new Adw.PreferencesGroup({ title: _('Limits') });
        this.topbar =  new Adw.PreferencesGroup({ title: _('Topbar') });
        this.notifications =  new Adw.PreferencesGroup({ title: _('Notifications') });
        this.shortcuts =  new Adw.PreferencesGroup({ title: _('Shortcuts') });
        this.search = new Adw.PreferencesGroup({title: _('Search')});
        this.item_actions = new Adw.PreferencesGroup({ title: _('Item Actions') });
        this.archive = new Adw.PreferencesGroup({ title: _('Import / Export History') });

        const exportButton = new Gtk.Button({
            label: _('Export history'),
            iconName: 'document-save-symbolic',
            valign: Gtk.Align.CENTER,
        });
        exportButton.connect('clicked', () => this.#exportHistory());
        const exportRow = new Adw.ActionRow({
            title: _('Export clipboard history'),
            subtitle: _('Save the registry and cached files as a ZIP archive'),
        });
        exportRow.add_suffix(exportButton);
        this.archive.add(exportRow);

        const importButton = new Gtk.Button({
            label: _('Import history'),
            iconName: 'document-open-symbolic',
            valign: Gtk.Align.CENTER,
        });
        importButton.connect('clicked', () => this.#importHistory());
        const importRow = new Adw.ActionRow({
            title: _('Import clipboard history'),
            subtitle: _('Restore a ZIP archive created by this extension'),
        });
        importRow.add_suffix(importButton);
        this.archive.add(importRow);

        this.ui.add(this.field_preview_size);
        this.ui.add(this.field_confirm_clear_toggle);
        this.ui.add(this.field_confirm_pinned_delete_toggle);
        this.ui.add(this.field_pinned_on_bottom);
        this.ui.add(this.field_show_search_bar);
        this.ui.add(this.field_show_private_mode);
        this.ui.add(this.field_show_settings_button);
        this.ui.add(this.field_show_clear_history_button);

        this.behavior.add(this.field_strip_text);
        this.behavior.add(this.field_move_item_first);
        this.behavior.add(this.field_keep_selected_on_clear);
        this.behavior.add(this.field_open_at_cursor);
        this.behavior.add(this.field_paste_on_select);
        this.behavior.add(this.field_cache_images);
        this.behavior.add(this.field_clear_on_boot);
        this.behavior.add(this.field_clear_history_on_interval);
        this.behavior.add(this.field_clear_history_interval);

        this.exclusion.add(this.field_exclusion_row);
        this.exclusion.add(this.field_exclusion_row_add_button);

        this.limits.add(this.field_size);
        this.limits.add(this.field_cache_size);
        this.limits.add(this.field_cache_disable);

        this.topbar.add(this.field_display_mode);
        this.topbar.add(this.field_topbar_preview_size);
        this.topbar.add(this.field_disable_down_arrow);
        this.topbar.add(this.field_blink_icon_on_copy);

        this.notifications.add(this.field_copy_notification_toggle);
        this.notifications.add(this.field_cycle_notification_toggle);
        this.notifications.add(this.field_clear_notification_toggle);
        this.notifications.add(this.field_import_export_notification_toggle);

        this.search.add(this.case_sensitive_search);
        this.search.add(this.regex_search);

        this.item_actions.add(this.field_show_delete_button);
        this.item_actions.add(this.field_show_tag_button);
        this.item_actions.add(this.field_paste_button);
        this.item_actions.add(this.field_show_pin_button);
        this.item_actions.add(this.field_show_edit_button);
        this.item_actions.add(this.field_show_preview_button);

        this.#buildShorcuts(this.shortcuts);

        this.schema.bind(PrefsFields.HISTORY_SIZE, this.field_size, 'value', Gio.SettingsBindFlags.DEFAULT);
        this.schema.bind(PrefsFields.PREVIEW_SIZE, this.field_preview_size, 'value', Gio.SettingsBindFlags.DEFAULT);
        this.schema.bind(PrefsFields.CACHE_FILE_SIZE, this.field_cache_size, 'value', Gio.SettingsBindFlags.DEFAULT);
        this.schema.bind(PrefsFields.CACHE_ONLY_FAVORITE, this.field_cache_disable, 'active', Gio.SettingsBindFlags.DEFAULT);
        this.schema.bind(PrefsFields.NOTIFY_ON_COPY, this.field_copy_notification_toggle, 'active', Gio.SettingsBindFlags.DEFAULT);
        this.schema.bind(PrefsFields.NOTIFY_ON_CYCLE, this.field_cycle_notification_toggle, 'active', Gio.SettingsBindFlags.DEFAULT);
        this.schema.bind(PrefsFields.NOTIFY_ON_CLEAR, this.field_clear_notification_toggle, 'active', Gio.SettingsBindFlags.DEFAULT);
        this.schema.bind(PrefsFields.NOTIFY_ON_IMPORT_EXPORT, this.field_import_export_notification_toggle, 'active', Gio.SettingsBindFlags.DEFAULT);
        this.schema.bind(PrefsFields.CONFIRM_ON_CLEAR, this.field_confirm_clear_toggle, 'active', Gio.SettingsBindFlags.DEFAULT);
        this.schema.bind(PrefsFields.CONFIRM_ON_PINNED_DELETE, this.field_confirm_pinned_delete_toggle, 'active', Gio.SettingsBindFlags.DEFAULT);
        this.schema.bind(PrefsFields.MOVE_ITEM_FIRST, this.field_move_item_first, 'active', Gio.SettingsBindFlags.DEFAULT);
        this.schema.bind(PrefsFields.KEEP_SELECTED_ON_CLEAR, this.field_keep_selected_on_clear, 'active', Gio.SettingsBindFlags.DEFAULT);
        this.schema.bind(PrefsFields.TOPBAR_DISPLAY_MODE_ID, this.field_display_mode, 'selected', Gio.SettingsBindFlags.DEFAULT);
        this.schema.bind(PrefsFields.DISABLE_DOWN_ARROW, this.field_disable_down_arrow, 'active', Gio.SettingsBindFlags.DEFAULT);
        this.schema.bind(PrefsFields.BLINK_ICON_ON_COPY, this.field_blink_icon_on_copy, 'active', Gio.SettingsBindFlags.DEFAULT);
        this.schema.bind(PrefsFields.TOPBAR_PREVIEW_SIZE, this.field_topbar_preview_size, 'value', Gio.SettingsBindFlags.DEFAULT);
        this.schema.bind(PrefsFields.STRIP_TEXT, this.field_strip_text, 'active', Gio.SettingsBindFlags.DEFAULT);
        this.schema.bind(PrefsFields.PASTE_BUTTON, this.field_paste_button, 'active', Gio.SettingsBindFlags.DEFAULT);
        this.schema.bind(PrefsFields.PINNED_ON_BOTTOM, this.field_pinned_on_bottom, 'active', Gio.SettingsBindFlags.DEFAULT);
        this.schema.bind(PrefsFields.SHOW_SEARCH_BAR, this.field_show_search_bar, 'active', Gio.SettingsBindFlags.DEFAULT);
        this.schema.bind(PrefsFields.SHOW_PRIVATE_MODE, this.field_show_private_mode, 'active', Gio.SettingsBindFlags.DEFAULT);
        this.schema.bind(PrefsFields.SHOW_SETTINGS_BUTTON, this.field_show_settings_button, 'active', Gio.SettingsBindFlags.DEFAULT);
        this.schema.bind(PrefsFields.SHOW_CLEAR_HISTORY_BUTTON, this.field_show_clear_history_button, 'active', Gio.SettingsBindFlags.DEFAULT);
        this.schema.bind(PrefsFields.ENABLE_KEYBINDING, this.field_keybinding_activation, 'active', Gio.SettingsBindFlags.DEFAULT);
        this.schema.bind(PrefsFields.CLEAR_ON_BOOT, this.field_clear_on_boot, 'active', Gio.SettingsBindFlags.DEFAULT);
        this.schema.bind(PrefsFields.PASTE_ON_SELECT, this.field_paste_on_select, 'active', Gio.SettingsBindFlags.DEFAULT);
        this.schema.bind(PrefsFields.OPEN_AT_CURSOR, this.field_open_at_cursor, 'active', Gio.SettingsBindFlags.DEFAULT);
        this.schema.bind(PrefsFields.CACHE_IMAGES, this.field_cache_images, 'active', Gio.SettingsBindFlags.DEFAULT);
        this.schema.bind(PrefsFields.CLEAR_HISTORY_ON_INTERVAL, this.field_clear_history_on_interval, 'active', Gio.SettingsBindFlags.DEFAULT);
        this.schema.bind(PrefsFields.CLEAR_HISTORY_INTERVAL, this.field_clear_history_interval, 'value', Gio.SettingsBindFlags.DEFAULT);
        this.schema.bind(PrefsFields.CASE_SENSITIVE_SEARCH, this.case_sensitive_search, 'active', Gio.SettingsBindFlags.DEFAULT);
        this.schema.bind(PrefsFields.REGEX_SEARCH, this.regex_search, 'active', Gio.SettingsBindFlags.DEFAULT);
        this.schema.bind(PrefsFields.SHOW_DELETE_BUTTON, this.field_show_delete_button, 'active', Gio.SettingsBindFlags.DEFAULT);
        this.schema.bind(PrefsFields.SHOW_TAG_BUTTON, this.field_show_tag_button, 'active', Gio.SettingsBindFlags.DEFAULT);
        this.schema.bind(PrefsFields.SHOW_PIN_BUTTON, this.field_show_pin_button, 'active', Gio.SettingsBindFlags.DEFAULT);
        this.schema.bind(PrefsFields.SHOW_EDIT_BUTTON, this.field_show_edit_button, 'active', Gio.SettingsBindFlags.DEFAULT);
        this.schema.bind(PrefsFields.SHOW_PREVIEW_BUTTON, this.field_show_preview_button, 'active', Gio.SettingsBindFlags.DEFAULT);

        this.field_clear_history_interval.set_sensitive(this.field_clear_history_on_interval.active);
        this.#fetchExludedAppsList();
    }

    #cacheDirectory = `${GLib.get_user_cache_dir()}/clipboard-indicator@tudmotu.com`;

    #showError (message) {
        const dialog = new Gtk.AlertDialog({
            message: _('Clipboard history import/export failed'),
            detail: message,
            buttons: [_('OK')],
        });
        dialog.choose(this.window, null, () => {});
    }

    #chooseFile (save) {
        return new Promise(resolve => {
            const dialog = new Gtk.FileChooserNative({
                title: save ? _('Export clipboard history') : _('Import clipboard history'),
                accept_label: save ? _('Export') : _('Import'),
                cancel_label: _('Cancel'),
                action: save ? Gtk.FileChooserAction.SAVE : Gtk.FileChooserAction.OPEN,
            });
            const filter = new Gtk.FileFilter();
            filter.set_name(_('ZIP archives'));
            filter.add_pattern('*.zip');
            dialog.add_filter(filter);
            if (save) dialog.set_current_name('clipboard-history.zip');
            dialog.set_transient_for(this.window);
            dialog.connect('response', (source, response) => {
                resolve(response === Gtk.ResponseType.ACCEPT ? source.get_file()?.get_path() : null);
                source.destroy();
            });
            dialog.show();
        });
    }

    async #runCommand (argv, cwd = null) {
        if (!GLib.find_program_in_path(argv[0]))
            throw new Error(_('%s is required for clipboard history import/export').replace('%s', argv[0]));

        const launcher = new Gio.SubprocessLauncher({
            flags: Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE,
        });
        if (cwd) launcher.set_cwd(cwd);
        const process = launcher.spawnv(argv);
        const [success, stdout, stderr] = await new Promise((resolve, reject) => {
            process.communicate_utf8_async(null, null, (source, result) => {
                try {
                    resolve(source.communicate_utf8_finish(result));
                }
                catch (e) {
                    reject(e);
                }
            });
        });
        if (!success || !process.get_successful()) throw new Error(stderr || argv[0]);
        return stdout;
    }

    async #copyFile (sourcePath, destinationPath) {
        const source = Gio.file_new_for_path(sourcePath);
        const destination = Gio.file_new_for_path(destinationPath);
        await new Promise((resolve, reject) => {
            source.copy_async(destination, Gio.FileCopyFlags.OVERWRITE,
                GLib.PRIORITY_DEFAULT, null, null, (object, result) => {
                    try {
                        object.copy_finish(result);
                        resolve();
                    }
                    catch (e) {
                        reject(e);
                    }
                });
        });
    }

    #removeDirectory (path) {
        const directory = Gio.file_new_for_path(path);
        if (!directory.query_exists(null)) return;
        const enumerator = directory.enumerate_children('standard::name',
            Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS, null);
        let info;
        while ((info = enumerator.next_file(null)) !== null) {
            const child = directory.get_child(info.get_name());
            if (info.get_file_type() === Gio.FileType.DIRECTORY)
                this.#removeDirectory(child.get_path());
            else
                child.delete(null);
        }
        enumerator.close(null);
        directory.delete(null);
    }

    #isTextMimetype (mimetype) {
        return mimetype.startsWith('text/') || mimetype === 'STRING' ||
            mimetype === 'UTF8_STRING';
    }

    #isRegularFile (path) {
        try {
            const info = Gio.file_new_for_path(path).query_info(
                'standard::type', Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS, null);
            return info.get_file_type() === Gio.FileType.REGULAR;
        }
        catch (e) {
            return false;
        }
    }

    #validateCachedFile (path, filename) {
        if (!this.#isRegularFile(path)) return false;
        const [, contents] = GLib.file_get_contents(path);
        return GLib.Bytes.new(contents).hash().toString() === filename;
    }

    async #installCachedFile (sourcePath, filename) {
        const destinationPath = `${this.#cacheDirectory}/${filename}`;
        if (GLib.file_test(destinationPath, GLib.FileTest.EXISTS)) {
            if (!this.#isRegularFile(destinationPath))
                throw new Error(_('The clipboard cache contains an invalid file'));
            return;
        }
        await this.#copyFile(sourcePath, destinationPath);
    }

    async #exportHistory () {
        const archivePath = await this.#chooseFile(true);
        if (!archivePath) return;
        let temporaryDirectory;
        try {
            temporaryDirectory = GLib.dir_make_tmp('clipboard-indicator-export-XXXXXX');
            const registryPath = `${this.#cacheDirectory}/registry.txt`;
            if (!GLib.file_test(registryPath, GLib.FileTest.EXISTS))
                throw new Error(_('Clipboard history is empty'));
            GLib.mkdir_with_parents(`${temporaryDirectory}/cache`, 0o775);
            await this.#copyFile(registryPath, `${temporaryDirectory}/registry.txt`);

            const [, registryContents] = GLib.file_get_contents(registryPath);
            const registry = JSON.parse(new TextDecoder().decode(registryContents));
            if (!Array.isArray(registry)) throw new Error(_('The registry is invalid'));
            for (const entry of registry) {
                if (!entry || typeof entry !== 'object' || typeof entry.mimetype !== 'string')
                    throw new Error(_('The registry is invalid'));
                const isText = this.#isTextMimetype(entry.mimetype);
                if (!isText) {
                    const filename = GLib.path_get_basename(entry.contents);
                    const sourcePath = `${this.#cacheDirectory}/${filename}`;
                    if (filename !== entry.contents && GLib.file_test(entry.contents, GLib.FileTest.EXISTS))
                        await this.#copyFile(entry.contents, `${temporaryDirectory}/cache/${filename}`);
                    else if (GLib.file_test(sourcePath, GLib.FileTest.EXISTS))
                        await this.#copyFile(sourcePath, `${temporaryDirectory}/cache/${filename}`);
                    else
                        throw new Error(_('A cached clipboard file is missing'));
                }
            }
            await this.#runCommand(['zip', '-qr', archivePath, 'registry.txt', 'cache'], temporaryDirectory);
            this.schema.set_string(PrefsFields.HISTORY_OPERATION_MESSAGE,
                _('Clipboard history exported successfully'));
        }
        catch (e) {
            this.#showError(e.message || String(e));
        }
        finally {
            if (temporaryDirectory) {
                try { this.#removeDirectory(temporaryDirectory); } catch (e) {}
            }
        }
    }

    async #importHistory () {
        const archivePath = await this.#chooseFile(false);
        if (!archivePath) return;
        let temporaryDirectory;
        try {
            temporaryDirectory = GLib.dir_make_tmp('clipboard-indicator-import-XXXXXX');
            const listing = await this.#runCommand(['unzip', '-Z1', archivePath]);
            const paths = listing.trim().split('\n').filter(path => path && path !== 'cache/');
            if (!paths.includes('registry.txt') || paths.some(path =>
                !/^registry\.txt$|^(cache|images)\/[A-Za-z0-9._-]+$|^[A-Za-z0-9._-]+$/.test(path)))
                throw new Error(_('The selected file is not a valid clipboard history archive'));
            await this.#runCommand(['unzip', '-q', archivePath, '-d', temporaryDirectory]);

            const registryPath = `${temporaryDirectory}/registry.txt`;
            if (!this.#isRegularFile(registryPath))
                throw new Error(_('The archive registry is not a regular file'));
            const [, contents] = GLib.file_get_contents(registryPath);
            const registry = JSON.parse(new TextDecoder().decode(contents));
            if (!Array.isArray(registry)) throw new Error(_('The registry is invalid'));
            const cachedFiles = [];
            for (const entry of registry) {
                if (!entry || typeof entry !== 'object' || typeof entry.mimetype !== 'string' ||
                    typeof entry.contents !== 'string')
                    throw new Error(_('The registry is invalid'));
                const isText = this.#isTextMimetype(entry.mimetype);
                if (!isText) {
                    const filename = GLib.path_get_basename(entry.contents);
                    const sourcePath = ['cache', 'images', ''].map(directory =>
                        `${temporaryDirectory}/${directory ? `${directory}/` : ''}${filename}`
                    ).find(path => this.#validateCachedFile(path, filename));
                    if (!filename || !sourcePath)
                        throw new Error(_('The archive is missing a cached clipboard file'));
                    entry.contents = `${this.#cacheDirectory}/${filename}`;
                    cachedFiles.push([sourcePath, filename]);
                }
            }

            const currentRegistryPath = `${this.#cacheDirectory}/registry.txt`;
            let currentRegistry = [];
            if (GLib.file_test(currentRegistryPath, GLib.FileTest.EXISTS)) {
                const [, currentContents] = GLib.file_get_contents(currentRegistryPath);
                currentRegistry = JSON.parse(new TextDecoder().decode(currentContents));
                if (!Array.isArray(currentRegistry)) throw new Error(_('The current registry is invalid'));
            }

            const entryKey = entry => {
                const isText = this.#isTextMimetype(entry.mimetype);
                return `${entry.mimetype}\u0000${isText ? entry.contents : GLib.path_get_basename(entry.contents)}`;
            };
            const mergedRegistry = [...currentRegistry];
            const existingEntries = new Map(mergedRegistry.map(entry => [entryKey(entry), entry]));
            for (const entry of registry) {
                const existingEntry = existingEntries.get(entryKey(entry));
                if (existingEntry) {
                    existingEntry.favorite = existingEntry.favorite || entry.favorite;
                    if (!existingEntry.tag && entry.tag) existingEntry.tag = entry.tag;
                }
                else {
                    mergedRegistry.push(entry);
                    existingEntries.set(entryKey(entry), entry);
                }
            }

            GLib.mkdir_with_parents(this.#cacheDirectory, 0o775);
            for (const [sourcePath, filename] of cachedFiles)
                await this.#installCachedFile(sourcePath, filename);
            Gio.file_new_for_path(`${this.#cacheDirectory}/registry.txt`).replace_contents(
                new TextEncoder().encode(JSON.stringify(mergedRegistry)), null, false,
                Gio.FileCreateFlags.NONE, null);
            this.schema.set_int(PrefsFields.HISTORY_IMPORTED,
                this.schema.get_int(PrefsFields.HISTORY_IMPORTED) + 1);
            this.schema.set_string(PrefsFields.HISTORY_OPERATION_MESSAGE,
                _('Clipboard history imported successfully'));
        }
        catch (e) {
            this.#showError(e.message || String(e));
        }
        finally {
            if (temporaryDirectory) {
                try { this.#removeDirectory(temporaryDirectory); } catch (e) {}
            }
        }
    }

    #createDisplayModeOptions () {
        let options = [
            _("Icon"),
            _("Clipboard Content"),
            _("Both"),
            _("Neither")
        ];
        let liststore = new Gtk.StringList();
        for (let option of options) {
            liststore.append(option)
        }
        return liststore;
    }

    #shortcuts = {
        [PrefsFields.BINDING_PRIVATE_MODE]: _("Private mode"),
        [PrefsFields.BINDING_TOGGLE_MENU]: _("Toggle the menu"),
        [PrefsFields.BINDING_CLEAR_HISTORY]: _("Clear history"),
        [PrefsFields.BINDING_PREV_ENTRY]: _("Previous entry"),
        [PrefsFields.BINDING_NEXT_ENTRY]: _("Next entry")
    };

    #buildShorcuts (group) {
        this.field_keybinding_activation = new Adw.SwitchRow({
            title: _("Enable shortcuts")
        });

        group.add(this.field_keybinding_activation);

        for (const [pref, title] of Object.entries(this.#shortcuts)) {
            const row = new Adw.ActionRow({
                title
            });

            row.add_suffix(this.#createShortcutButton(pref));

            group.add(row);
        }
    }

    #createShortcutButton (pref) {
        const button = new Gtk.Button({
            has_frame: false
        });

        const setLabelFromSettings = () => {
            const originalValue = this.schema.get_strv(pref)[0];

            if (!originalValue) {
                button.set_label(_('Disabled'));
            }
            else {
                button.set_label(originalValue);
            }
        };

        const startEditing = () => {
            button.isEditing = button.label;
            button.set_label(_('Enter shortcut'));
        };

        const revertEditing = () => {
            button.set_label(button.isEditing);
            button.isEditing = null;
        };

        const stopEditing = () => {
            setLabelFromSettings();
            button.isEditing = null;
        };

        setLabelFromSettings();

        button.connect('clicked', () => {
            if (button.isEditing) {
                revertEditing();
                return;
            }

            startEditing();

            const eventController = new Gtk.EventControllerKey();
            button.add_controller(eventController);

            let debounceTimeoutId = null;
            const connectId = eventController.connect('key-pressed', (_ec, keyval, keycode, mask) => {
                if (debounceTimeoutId) clearTimeout(debounceTimeoutId);

                mask = mask & Gtk.accelerator_get_default_mod_mask();

                if (mask === 0) {
                    switch (keyval) {
                        case Gdk.KEY_Escape:
                            revertEditing();
                            return Gdk.EVENT_STOP;
                        case Gdk.KEY_BackSpace:
                            this.schema.set_strv(pref, []);
                            setLabelFromSettings();
                            stopEditing();
                            eventController.disconnect(connectId);
                            return Gdk.EVENT_STOP;
                    }
                }

                const selectedShortcut = Gtk.accelerator_name_with_keycode(
                    null,
                    keyval,
                    keycode,
                    mask
                );

                debounceTimeoutId = setTimeout(() => {
                    eventController.disconnect(connectId);
                    this.schema.set_strv(pref, [selectedShortcut]);
                    stopEditing();
                }, 400);

                return Gdk.EVENT_STOP;
            });

            button.show();
        });

        return button;
    }

    #excluded_row_counter = 0;

    set excluded_row_counter(value) {
        this.#excluded_row_counter = value;
        this.#updateExcludedAppRow();
    }

    get excluded_row_counter() {
        return this.#excluded_row_counter;
    }

    #createExcludedAppInputRow() {
        //The entry row for adding new excluded apps
        const entry_row = new Adw.ActionRow({
            hexpand: false,
        });

        //The input field for the app wm class name
        const entry = new Gtk.Entry({
            placeholderText: _('Window class name, e.g. "KeePassXC"'),
            halign: Gtk.Align.FILL,
            valign: Gtk.Align.CENTER,
            hexpand: true,
        });

        //The button to open the popover with the list of installed applications
        const appButton = new Gtk.MenuButton({
            iconName: 'view-list-symbolic',
            cssClasses: ['flat'],
            valign: Gtk.Align.CENTER,
            halign: Gtk.Align.CENTER,
            tooltip_text: _('Choose from installed applications'),
        });

        //The popover
        const popover = new Gtk.Popover();

        //The popover box
        const popoverBox = new Gtk.Box({
            orientation: Gtk.Orientation.VERTICAL,
            margin_top: 6,
            margin_bottom: 6,
            margin_start: 6,
            margin_end: 6,
        });

        //The search entry in the popover list for searching applications
        const searchEntry = new Gtk.SearchEntry({
            placeholder_text: _('Search applications...'),
            margin_bottom: 6,
        });

        //The scrolled window for the list of applications
        const scrolledWindow = new Gtk.ScrolledWindow({
            hscrollbar_policy: Gtk.PolicyType.NEVER,
            vscrollbar_policy: Gtk.PolicyType.AUTOMATIC,
            height_request: 300,
            width_request: 300,
        });

        const listBox = new Gtk.ListBox();

        entry.connect('activate', () => {
            ok_button.emit('clicked');
        });

        popoverBox.append(searchEntry);

        popoverBox.append(scrolledWindow);

        scrolledWindow.set_child(listBox);

        popover.set_child(popoverBox);
        appButton.set_popover(popover);

        const appInfoList = Gio.AppInfo.get_all();
        const appRows = [];

        appInfoList.sort((a, b) => {
            return a.get_display_name().localeCompare(b.get_display_name());
        }).forEach(appInfo => {
            if (appInfo.should_show()) {
                const row = new Gtk.ListBoxRow();
                const box = new Gtk.Box({
                    orientation: Gtk.Orientation.HORIZONTAL,
                    spacing: 10,
                    margin_top: 6,
                    margin_bottom: 6,
                    margin_start: 6,
                    margin_end: 6,
                });

                const icon = appInfo.get_icon();
                if (icon) {
                    const image = new Gtk.Image({
                        gicon: icon,
                        pixel_size: 24,
                    });
                    box.append(image);
                }

                const label = new Gtk.Label({
                    label: appInfo.get_display_name(),
                    halign: Gtk.Align.START,
                    hexpand: true,
                });
                box.append(label);

                row.set_child(box);
                row.appInfo = appInfo;
                listBox.append(row);
                appRows.push({ row, appInfo });
            }
        });

        //for searching the list of applications
        searchEntry.connect('search-changed', () => {
            const text = searchEntry.get_text().toLowerCase();
            for (const { row, appInfo } of appRows) {
                const appName = appInfo.get_display_name().toLowerCase();
                row.set_visible(appName.includes(text));
            }
        });

        //when using enter on the search entry, select the first row and focus the entry
        searchEntry.connect('activate', () => {
            const firstVisibleRow = appRows.find(({ row }) => row.visible);
            if (firstVisibleRow) {
                listBox.emit('row-activated', firstVisibleRow.row);
            }
            entry.grab_focus();
        });

        //when selecting an application, set the entry text to the app class name and close the popover
        listBox.connect('row-activated', (list, row) => {
            if (row && row.appInfo) {
                const appClassName = row.appInfo.get_id().replace(/\.desktop$/, '');
                entry.set_text(appClassName);
                popover.popdown();
            }
        });

        //The suffix buttons
        const ok_button = new Gtk.Button({
            iconName: 'object-select-symbolic',
            valign: Gtk.Align.CENTER,
            halign: Gtk.Align.CENTER,
            cssClasses: ['flat'],
        });

        ok_button.connect('clicked', () => {
            const text = entry.get_text();
            if (text !== null && text.trim() !== '') {
                this.field_exclusion_row.remove(entry_row);
                this.field_exclusion_row.add_row(this.#createExludedAppRow(text.trim()));
                this.field_exclusion_row_add_button.set_sensitive(true);
                this.schema.set_strv('excluded-apps', [...this.schema.get_strv('excluded-apps'), text.trim()]);
            }
        });

        const cancel_button = new Gtk.Button({
            iconName: 'window-close-symbolic',
            valign: Gtk.Align.CENTER,
            halign: Gtk.Align.CENTER,
            cssClasses: ['flat'],
        });

        cancel_button.connect('clicked', () => {
            this.field_exclusion_row.remove(entry_row);
            this.field_exclusion_row_add_button.set_sensitive(true);
            this.excluded_row_counter--;
        });

        // Hide the title/subtitle/icon children of the ActionRow
        let child = entry_row.child.get_first_child();
        while (child) {
            child.visible = false;
            child = child.get_next_sibling();
        }

        entry_row.add_prefix(entry);
        entry_row.add_suffix(appButton);
        entry_row.add_suffix(ok_button);
        entry_row.add_suffix(cancel_button);

        return entry_row;
    }

    #createExludedAppRow(app_class_name) {
        const excluded_row = new Adw.ActionRow({
            title: app_class_name,
        });

        const remove_button = new Gtk.Button({
            cssClasses: ['destructive-action'],
            iconName: 'edit-delete-symbolic',
            valign: Gtk.Align.CENTER,
            halign: Gtk.Align.CENTER,
        });
        remove_button.connect('clicked', () => {
            this.field_exclusion_row.remove(excluded_row);
            const updated_list = this.schema.get_strv('excluded-apps').filter(app => app !== app_class_name);
            this.schema.set_strv('excluded-apps', updated_list);
            this.excluded_row_counter--;
        });
        excluded_row.add_suffix(remove_button);

        return excluded_row;
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
