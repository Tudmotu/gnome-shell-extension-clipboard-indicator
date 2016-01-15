const GObject = imports.gi.GObject;
const Gtk = imports.gi.Gtk;
const Gio = imports.gi.Gio;
const Lang = imports.lang;
const Extension = imports.misc.extensionUtils.getCurrentExtension();
const Utils = Extension.imports.utils;
const prettyPrint = Utils.prettyPrint;

const Gettext = imports.gettext;
const _ = Gettext.domain('clipboard-indicator').gettext;

const Fields = {
    INTERVAL       : 'refresh-interval',
    HISTORY_SIZE   : 'history-size',
    PREVIEW_SIZE   : 'preview-size',
    CACHE_FILE_SIZE: 'cache-size',
    DELETE         : 'enable-deletion',
    ENABLE_KEYBINDING : 'enable-keybindings',
};

const SCHEMA_NAME = 'org.gnome.shell.extensions.clipboard-indicator';

const getSchema = function () {
    let schemaDir = Extension.dir.get_child('schemas').get_path();
    let schemaSource = Gio.SettingsSchemaSource.new_from_directory(schemaDir, Gio.SettingsSchemaSource.get_default(), false);
    let schema = schemaSource.lookup(SCHEMA_NAME, false);

    return new Gio.Settings({ settings_schema: schema });
}

const SettingsSchema = getSchema();


function init() {
    let localeDir = Extension.dir.get_child('locale');
    if (localeDir.query_exists(null))
        Gettext.bindtextdomain('clipboard-indicator', localeDir.get_path());
}

const App = new Lang.Class({
    Name: 'ClipboardIndicator.App',
    _init: function() {
  	this.main = new Gtk.Grid({
            margin: 10,
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
                upper: 50,
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

        this.field_keybinding = createKeybindingWidget(SettingsSchema);
        addKeybinding(this.field_keybinding.model, SettingsSchema, "toggle-menu",
                      _("Toggle the menu"));
        addKeybinding(this.field_keybinding.model, SettingsSchema, "clear-history",
                      _("Clear history"));
        addKeybinding(this.field_keybinding.model, SettingsSchema, "prev-entry",
                      _("Previous entry"));
        addKeybinding(this.field_keybinding.model, SettingsSchema, "next-entry",
                      _("Next entry"));

        var that = this;
        this.field_keybinding_activation = new Gtk.Switch();
        this.field_keybinding_activation.connect("notify::active", function(widget){
            that.field_keybinding.set_sensitive(widget.active);
        });

        //this.field_deletion = new Gtk.Switch({
            //active: true
        //});

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
        let cacheLabel  = new Gtk.Label({
            label: _("Max Cache File Size (kb)"),
            hexpand: true,
            halign: Gtk.Align.START
        });
        let keybindingLabel  = new Gtk.Label({
            label: _("Keyboard shortcuts"),
            hexpand: true,
            halign: Gtk.Align.START
        });

        //let deleteLabel   = new Gtk.Label({
            //label: _("Enable Deletion"),
            //hexpand: true,
            //halign: Gtk.Align.START
        //});
        this.main.attach(sizeLabel       , 2, 1, 2 ,1);
        this.main.attach(previewLabel    , 2, 2, 2 ,1);
        this.main.attach(intervalLabel   , 2, 3, 2 ,1);
        this.main.attach(cacheLabel      , 2, 4, 2 ,1)
        this.main.attach(keybindingLabel , 2, 5, 2 ,1);
        //this.main.attach(deleteLabel  , 2, 4, 2 ,1);

        this.main.attach(this.field_size        , 4, 1, 2, 1);
        this.main.attach(this.field_preview_size, 4, 2, 2, 1);
        this.main.attach(this.field_interval    , 4, 3, 2, 1);
        this.main.attach(this.field_cache_size  , 4, 4, 2, 1);
        this.main.attach(this.field_keybinding_activation  , 4, 5, 2, 1);
        this.main.attach(this.field_keybinding  , 2, 6, 4, 2);
        //this.main.attach(this.field_deletion    , 4, 4, 2, 1);

        SettingsSchema.bind(Fields.INTERVAL    , this.field_interval    , 'value' , Gio.SettingsBindFlags.DEFAULT);
        SettingsSchema.bind(Fields.HISTORY_SIZE, this.field_size        , 'value' , Gio.SettingsBindFlags.DEFAULT);
        SettingsSchema.bind(Fields.PREVIEW_SIZE, this.field_preview_size, 'value' , Gio.SettingsBindFlags.DEFAULT);
        SettingsSchema.bind(Fields.CACHE_FILE_SIZE, this.field_cache_size, 'value' , Gio.SettingsBindFlags.DEFAULT);
        //SettingsSchema.bind(Fields.DELETE      , this.field_deletion    , 'active', Gio.SettingsBindFlags.DEFAULT);
	SettingsSchema.bind(Fields.ENABLE_KEYBINDING, this.field_keybinding_activation, 'active', Gio.SettingsBindFlags.DEFAULT);
        
        this.main.show_all();
    }
});

function buildPrefsWidget(){
    let widget = new App();
    return widget.main;
};


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
        [key, mods] = Gtk.accelerator_parse(settings.get_strv(id)[0]);

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
