import Adw from 'gi://Adw';
import GObject from 'gi://GObject';
import Gtk from 'gi://Gtk';
import Gdk from 'gi://Gdk';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import { ExtensionPreferences, gettext as _ } from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';
import { PrefsFields } from './constants.js';

GLib.log_set_debug_enabled(true);

export default class ClipboardIndicatorPreferences extends ExtensionPreferences {
    fillPreferencesWindow (window) {
        window._settings = this.getSettings();
        const settingsUI = new Settings(window._settings);
        const page = new Adw.PreferencesPage();
        page.add(settingsUI.ui);
        page.add(settingsUI.limits);
        page.add(settingsUI.topbar);
        page.add(settingsUI.notifications);
        page.add(settingsUI.shortcuts);
        window.add(page);
    }
}

class Settings {
    constructor (schema) {
        this.schema = schema;

        const makeGrid = () => new Gtk.Grid({
            margin_top: 0,
            margin_bottom: 0,
            margin_start: 0,
            margin_end: 0,
            row_spacing: 12,
            column_spacing: 18,
            column_homogeneous: false,
            row_homogeneous: false
        });

        this.field_size = new Gtk.SpinButton({
            adjustment: new Gtk.Adjustment({
                lower: 1,
                upper: 200,
                step_increment: 1
            })
        });
        this.field_preview_size = new Gtk.SpinButton({
            adjustment: new Gtk.Adjustment({
                lower: 10,
                upper: 100,
                step_increment: 1
            })
        });
        this.field_cache_size = new Gtk.SpinButton({
            adjustment: new Gtk.Adjustment({
                lower: 512,
                upper: Math.pow(2, 14),
                step_increment: 1
            })
        });
        this.field_topbar_preview_size = new Gtk.SpinButton({
            adjustment: new Gtk.Adjustment({
                lower: 1,
                upper: 100,
                step_increment: 1
            })
        });
        this.field_display_mode = new Gtk.ComboBox({
            model: this._create_display_mode_options()});

        let rendererText = new Gtk.CellRendererText();
        this.field_display_mode.pack_start (rendererText, false);
        this.field_display_mode.add_attribute (rendererText, "text", 0);
        this.field_disable_down_arrow = new Gtk.Switch();
        this.field_cache_disable = new Gtk.Switch();
        this.field_notification_toggle = new Gtk.Switch();
        this.field_confirm_clear_toggle = new Gtk.Switch();
        this.field_strip_text = new Gtk.Switch();
        this.field_move_item_first = new Gtk.Switch();

        var that = this;

        let sizeLabel     = new Gtk.Label({
            label: _("History Size"),
            hexpand: true,
            halign: Gtk.Align.START
        });
        let intervalLabel = new Gtk.Label({
            label: _("Refresh Interval (ms)"),
            hexpand: true,
            halign: Gtk.Align.START
        });
        let previewLabel  = new Gtk.Label({
            label: _("Preview Size (characters)"),
            hexpand: true,
            halign: Gtk.Align.START
        });
        let cacheSizeLabel  = new Gtk.Label({
            label: _("Max cache file size (kb)"),
            hexpand: true,
            halign: Gtk.Align.START
        });
        let cacheDisableLabel  = new Gtk.Label({
            label: _("Cache only favorites"),
            hexpand: true,
            halign: Gtk.Align.START
        });
        let notificationLabel  = new Gtk.Label({
            label: _("Show notification on copy"),
            hexpand: true,
            halign: Gtk.Align.START
        });
        let confirmClearLabel = new Gtk.Label({
            label: _("Show confirmation on Clear History"),
            hexpand: true,
            halign: Gtk.Align.START
        });
        let moveFirstLabel  = new Gtk.Label({
            label: _("Move item to the top after selection"),
            hexpand: true,
            halign: Gtk.Align.START
        });
        let topbarPreviewLabel  = new Gtk.Label({
            label: _("Number of characters in top bar"),
            hexpand: true,
            halign: Gtk.Align.START
        });
        let displayModeLabel  = new Gtk.Label({
            label: _("What to show in top bar"),
            hexpand: true,
            halign: Gtk.Align.START
        });
        let disableDownArrowLabel = new Gtk.Label({
            label: _("Remove down arrow in top bar"),
            hexpand: true,
            halign: Gtk.Align.START
        });
        let stripTextLabel = new Gtk.Label({
            label: _("Remove whitespace around text"),
            hexpand: true,
            halign: Gtk.Align.START
        });

        const addRowFactory = (main) => {
            let row = 0;
            return (label, input) => {
                let inputWidget = input;

                if (input instanceof Gtk.Switch) {
                    inputWidget = new Gtk.Box({
                        orientation: Gtk.Orientation.HORIZONTAL,
                        halign: Gtk.Align.END
                    });
                    inputWidget.append(input);
                }

                if (label) {
                    main.attach(label, 0, row, 1, 1);
                    main.attach(inputWidget, 1, row, 1, 1);
                }
                else {
                    main.attach(inputWidget, 0, row, 2, 1);
                }

                row++;
            };
        };

        const attachGrid = group => {
            const grid = makeGrid();
            group.add(grid);
            return grid;
        };

        this.ui =  new Adw.PreferencesGroup({ title: _('UI') });
        this.limits =  new Adw.PreferencesGroup({ title: _('Limits') });
        this.topbar =  new Adw.PreferencesGroup({ title: _('Topbar') });
        this.notifications =  new Adw.PreferencesGroup({ title: _('Notifications') });
        this.shortcuts =  new Adw.PreferencesGroup({ title: _('Shortcuts') });

        const addToUI = addRowFactory(attachGrid(this.ui));
        const addToLimits = addRowFactory(attachGrid(this.limits));
        const addToTopbar = addRowFactory(attachGrid(this.topbar));
        const addToNotifications = addRowFactory(attachGrid(this.notifications));
        const addToShortcuts = addRowFactory(attachGrid(this.shortcuts));

        addToUI(previewLabel, this.field_preview_size);
        addToUI(moveFirstLabel, this.field_move_item_first);
        addToUI(stripTextLabel, this.field_strip_text);

        addToLimits(sizeLabel, this.field_size);
        addToLimits(cacheSizeLabel, this.field_cache_size);
        addToLimits(cacheDisableLabel, this.field_cache_disable);

        addToTopbar(displayModeLabel, this.field_display_mode);
        addToTopbar(topbarPreviewLabel, this.field_topbar_preview_size);
        addToTopbar(disableDownArrowLabel, this.field_disable_down_arrow);

        addToNotifications(notificationLabel, this.field_notification_toggle);
        addToNotifications(confirmClearLabel, this.field_confirm_clear_toggle);

        this.#buildShorcuts(this.shortcuts);

        this.schema.bind(PrefsFields.HISTORY_SIZE, this.field_size, 'value', Gio.SettingsBindFlags.DEFAULT);
        this.schema.bind(PrefsFields.PREVIEW_SIZE, this.field_preview_size, 'value', Gio.SettingsBindFlags.DEFAULT);
        this.schema.bind(PrefsFields.CACHE_FILE_SIZE, this.field_cache_size, 'value', Gio.SettingsBindFlags.DEFAULT);
        this.schema.bind(PrefsFields.CACHE_ONLY_FAVORITE, this.field_cache_disable, 'active', Gio.SettingsBindFlags.DEFAULT);
        this.schema.bind(PrefsFields.NOTIFY_ON_COPY, this.field_notification_toggle, 'active', Gio.SettingsBindFlags.DEFAULT);
        this.schema.bind(PrefsFields.CONFIRM_ON_CLEAR, this.field_confirm_clear_toggle, 'active', Gio.SettingsBindFlags.DEFAULT);
        this.schema.bind(PrefsFields.MOVE_ITEM_FIRST, this.field_move_item_first, 'active', Gio.SettingsBindFlags.DEFAULT);
        this.schema.bind(PrefsFields.TOPBAR_DISPLAY_MODE_ID, this.field_display_mode, 'active', Gio.SettingsBindFlags.DEFAULT);
        this.schema.bind(PrefsFields.DISABLE_DOWN_ARROW, this.field_disable_down_arrow, 'active', Gio.SettingsBindFlags.DEFAULT);
        this.schema.bind(PrefsFields.TOPBAR_PREVIEW_SIZE, this.field_topbar_preview_size, 'value', Gio.SettingsBindFlags.DEFAULT);
        this.schema.bind(PrefsFields.STRIP_TEXT, this.field_strip_text, 'active', Gio.SettingsBindFlags.DEFAULT);
        this.schema.bind(PrefsFields.ENABLE_KEYBINDING, this.field_keybinding_activation, 'active', Gio.SettingsBindFlags.DEFAULT);
    }

    _create_display_mode_options  (){
        let options = [{ name: _("Icon") },
        { name: _("Clipboard Content"),},
        { name: _("Both")}];
        let liststore = new Gtk.ListStore();
        liststore.set_column_types([GObject.TYPE_STRING])
        for (let i = 0; i < options.length; i++ ) {
            let option = options[i];
            let iter = liststore.append();
            liststore.set (iter, [0], [option.name]);
        }
        return liststore;
    }

    #shortcuts = {
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

        const originalValue = this.schema.get_strv(pref)[0];

        const startEditing = () => {
            button.isEditing = button.label;
            button.set_label(_('Enter shortcut'));
        };

        const revertEditing = () => {
            button.set_label(button.isEditing);
            button.isEditing = null;
        };

        const stopEditing = () => {
            button.set_label(this.schema.get_strv(pref)[0]);
            button.isEditing = null;
        };

        if (!originalValue) {
            button.set_label(_('Disabled'));
        }
        else {
            button.set_label(originalValue);
        }

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
                            button.set_label(_('Disabled'));
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
}
