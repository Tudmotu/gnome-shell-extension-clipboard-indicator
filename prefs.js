const Gtk = imports.gi.Gtk;
const Gio = imports.gi.Gio;
const Lang = imports.lang;
const Extension = imports.misc.extensionUtils.getCurrentExtension();
const Convenience = Extension.imports.convenience;
const prettyPrint = Convenience.dbPrintObj;

const Gettext = imports.gettext;
const _ = Gettext.gettext;

const Fields = {
    INTERVAL    : 'refresh-interval',
    HISTORY_SIZE: 'history-size',
    PREVIEW_SIZE: 'preview-size',
    DELETE      : 'enable-deletion'
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
            row_spacing: 10,
            column_spacing: 20,
            column_homogeneous: false,
            row_homogeneous: true
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
        //let deleteLabel   = new Gtk.Label({
            //label: _("Enable Deletion"),
            //hexpand: true,
            //halign: Gtk.Align.START
        //});
        this.main.attach(sizeLabel    , 2, 1, 2 ,1);
        this.main.attach(previewLabel , 2, 2, 2 ,1);
        this.main.attach(intervalLabel, 2, 3, 2 ,1);
        //this.main.attach(deleteLabel  , 2, 4, 2 ,1);

        this.main.attach(this.field_size        , 4, 1, 2, 1);
        this.main.attach(this.field_preview_size, 4, 2, 2, 1);
        this.main.attach(this.field_interval    , 4, 3, 2, 1);
        //this.main.attach(this.field_deletion    , 4, 4, 2, 1);

        SettingsSchema.bind(Fields.INTERVAL    , this.field_interval    , 'value' , Gio.SettingsBindFlags.DEFAULT);
        SettingsSchema.bind(Fields.HISTORY_SIZE, this.field_size        , 'value' , Gio.SettingsBindFlags.DEFAULT);
        SettingsSchema.bind(Fields.PREVIEW_SIZE, this.field_preview_size, 'value' , Gio.SettingsBindFlags.DEFAULT);
        //SettingsSchema.bind(Fields.DELETE      , this.field_deletion    , 'active', Gio.SettingsBindFlags.DEFAULT);

        this.main.show_all();
    }
});

function buildPrefsWidget(){
    let widget = new App();
    return widget.main;
};
