import Adw from 'gi://Adw';
import GObject from 'gi://GObject';
import Gtk from 'gi://Gtk';
import Gio from 'gi://Gio';
import { ExtensionPreferences, gettext as _ } from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';
import { PrefsFields } from './constants.js';

export default class ClipboardIndicatorPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const schema = this.getSettings();

        let widget = new Settings(schema);

        const page = new Adw.PreferencesPage();

        page.add(widget.main);

        window.add(page);
    }
}

class Settings {
    constructor (schema) {
        this.schema = schema;

        this.main = new Gtk.Grid({
            margin_top: 10,
            margin_bottom: 10,
            margin_start: 10,
            margin_end: 10,
            row_spacing: 12,
            column_spacing: 18,
            column_homogeneous: false,
            row_homogeneous: false
        });
        this.field_interval = new Gtk.SpinButton({
            adjustment: new Gtk.Adjustment({
                lower: 500,
                upper: 5000,
                step_increment: 100
            })
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
        this.field_keybinding = createKeybindingWidget(this.schema);
        addKeybinding(this.field_keybinding.model, this.schema, "toggle-menu",
                      _("Toggle the menu"));
        addKeybinding(this.field_keybinding.model, this.schema, "clear-history",
                      _("Clear history"));
        addKeybinding(this.field_keybinding.model, this.schema, "prev-entry",
                      _("Previous entry"));
        addKeybinding(this.field_keybinding.model, this.schema, "next-entry",
                      _("Next entry"));

        var that = this;
        this.field_keybinding_activation = new Gtk.Switch();
        this.field_keybinding_activation.connect("notify::active", function(widget){
            that.field_keybinding.set_sensitive(widget.active);
        });

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
        let keybindingLabel  = new Gtk.Label({
            label: _("Keyboard shortcuts"),
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

        const addRow = ((main) => {
            let row = 0;
            return (label, input) => {
                let inputWidget = input;

                if (input instanceof Gtk.Switch) {
                    inputWidget = new Gtk.Box({orientation: Gtk.Orientation.HORIZONTAL,});
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
        })(this.main);

        addRow(sizeLabel,             this.field_size);
        addRow(previewLabel,          this.field_preview_size);
        addRow(intervalLabel,         this.field_interval);
        addRow(cacheSizeLabel,        this.field_cache_size);
        addRow(cacheDisableLabel,     this.field_cache_disable);
        addRow(notificationLabel,     this.field_notification_toggle);
        addRow(confirmClearLabel,     this.field_confirm_clear_toggle);
        addRow(displayModeLabel,      this.field_display_mode);
        addRow(disableDownArrowLabel, this.field_disable_down_arrow);
        addRow(topbarPreviewLabel,    this.field_topbar_preview_size);
        addRow(stripTextLabel,        this.field_strip_text);
        addRow(moveFirstLabel,        this.field_move_item_first);
        addRow(keybindingLabel,       this.field_keybinding_activation);
        addRow(null,                  this.field_keybinding);

        this.schema.bind(PrefsFields.INTERVAL, this.field_interval, 'value', Gio.SettingsBindFlags.DEFAULT);
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
}


//binding widgets
//////////////////////////////////
const COLUMN_ID          = 0;
const COLUMN_DESCRIPTION = 1;
const COLUMN_KEY         = 2;
const COLUMN_MODS        = 3;


function addKeybinding(model, settings, id, description) {
    // Get the current accelerator.
    let accelerator = settings.get_strv(id)[0];
    let key, mods;
    if (accelerator == null)
        [key, mods] = [0, 0];
    else
        [,key, mods] = Gtk.accelerator_parse(settings.get_strv(id)[0]);

    // Add a row for the keybinding.
    let row = model.insert(100); // Erm...
    model.set(row,
            [COLUMN_ID, COLUMN_DESCRIPTION, COLUMN_KEY, COLUMN_MODS],
            [id,        description,        key,        mods]);
}

function createKeybindingWidget(SettingsSchema) {
    let model = new Gtk.ListStore();

    model.set_column_types(
            [GObject.TYPE_STRING, // COLUMN_ID
             GObject.TYPE_STRING, // COLUMN_DESCRIPTION
             GObject.TYPE_INT,    // COLUMN_KEY
             GObject.TYPE_INT]);  // COLUMN_MODS

    let treeView = new Gtk.TreeView();
    treeView.model = model;
    treeView.headers_visible = false;

    let column, renderer;

    // Description column.
    renderer = new Gtk.CellRendererText();

    column = new Gtk.TreeViewColumn();
    column.expand = true;
    column.pack_start(renderer, true);
    column.add_attribute(renderer, "text", COLUMN_DESCRIPTION);

    treeView.append_column(column);

    // Key binding column.
    renderer = new Gtk.CellRendererAccel();
    renderer.accel_mode = Gtk.CellRendererAccelMode.GTK;
    renderer.editable = true;

    renderer.connect("accel-edited",
            function (renderer, path, key, mods, hwCode) {
                let [ok, iter] = model.get_iter_from_string(path);
                if(!ok)
                    return;

                // Update the UI.
                model.set(iter, [COLUMN_KEY, COLUMN_MODS], [key, mods]);

                // Update the stored setting.
                let id = model.get_value(iter, COLUMN_ID);
                let accelString = Gtk.accelerator_name(key, mods);
                SettingsSchema.set_strv(id, [accelString]);
            });

    renderer.connect("accel-cleared",
            function (renderer, path) {
                let [ok, iter] = model.get_iter_from_string(path);
                if(!ok)
                    return;

                // Update the UI.
                model.set(iter, [COLUMN_KEY, COLUMN_MODS], [0, 0]);

                // Update the stored setting.
                let id = model.get_value(iter, COLUMN_ID);
                SettingsSchema.set_strv(id, []);
            });

    column = new Gtk.TreeViewColumn();
    column.pack_end(renderer, false);
    column.add_attribute(renderer, "accel-key", COLUMN_KEY);
    column.add_attribute(renderer, "accel-mods", COLUMN_MODS);

    treeView.append_column(column);

    return treeView;
}
