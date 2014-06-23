const Gtk = imports.gi.Gtk;
const Gio = imports.gi.Gio;
const Lang = imports.lang;
const Extension = imports.misc.extensionUtils.getCurrentExtension();
const Convenience = Extension.imports.convenience;
const prettyPrint = Convenience.dbPrintObj;

const Gettext = imports.gettext;
const _ = Gettext.gettext;

let schemaDir = Extension.dir.get_child('schemas').get_path();
let schemaSource = Gio.SettingsSchemaSource.new_from_directory(schemaDir, Gio.SettingsSchemaSource.get_default(), false);
let schema = schemaSource.lookup('org.gnome.shell.extensions.clipboard-indicator', false);
let Schema = new Gio.Settings({ settings_schema: schema });


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
                lower: 1000,
                upper: 10000,
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
                lower: 20,
                upper: 100,
                step_increment: 1
            })
        });
        this.field_deletion = new Gtk.Switch({
            active: true
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
            label: _("Preview Size"),
            hexpand: true,
            halign: Gtk.Align.START
        });
        let deleteLabel   = new Gtk.Label({
            label: _("Enable Deletion"),
            hexpand: true,
            halign: Gtk.Align.START
        });
        this.main.attach(sizeLabel    , 2, 1, 2 ,1);
        this.main.attach(intervalLabel, 2, 2, 2 ,1);
        this.main.attach(previewLabel , 2, 3, 2 ,1);
        this.main.attach(deleteLabel  , 2, 4, 2 ,1);

        this.main.attach(this.field_size        , 4, 1, 2, 1);
        this.main.attach(this.field_interval    , 4, 2, 2, 1);
        this.main.attach(this.field_preview_size, 4, 3, 2, 1);
        this.main.attach(this.field_deletion    , 4, 4, 2, 1);

        Schema.bind('history-size', this.field_size, 'value', Gio.SettingsBindFlags.DEFAULT);
        Schema.bind('refresh-interval', this.field_interval, 'value', Gio.SettingsBindFlags.DEFAULT);
        Schema.bind('preview-size', this.field_preview_size, 'value', Gio.SettingsBindFlags.DEFAULT);
        Schema.bind('enable-deletion', this.field_deletion, 'active', Gio.SettingsBindFlags.DEFAULT);

        this.main.show_all();
    }
});

function buildPrefsWidget(){
    let widget = new App();
    return widget.main;
};
