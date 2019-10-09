const GLib = imports.gi.GLib;
const Gio = imports.gi.Gio;
const FileQueryInfoFlags = imports.gi.Gio.FileQueryInfoFlags;
const FileCopyFlags = imports.gi.Gio.FileCopyFlags;
const FileTest = GLib.FileTest;

const ExtensionUtils = imports.misc.extensionUtils;
const Me = ExtensionUtils.getCurrentExtension();
const Prefs = Me.imports.prefs;
const SettingsSchema = Prefs.SettingsSchema;

const REGISTRY_DIR = GLib.get_user_cache_dir() + '/' + Me.uuid;
const REGISTRY_FILE = 'registry.txt';
const REGISTRY_PATH = REGISTRY_DIR + '/' + REGISTRY_FILE;
const BACKUP_REGISTRY_PATH = REGISTRY_PATH + '~';

// Print objects... why no dev tools
function prettyPrint (name, obj, recurse, _indent) {
    let prefix = '';
    let indent = typeof _indent === 'number' ? _indent : 0;
    for (let i = 0; i < indent; i++) {
        prefix += '    ';
    }

    recurse = typeof recurse === 'boolean' ? recurse : true;
    if (typeof name !== 'string') {
        obj = arguments[0];
        recurse = arguments[1];
        _indent = arguments[2];
        name = obj.toString();
    }

    log(prefix + '--------------');
    log(prefix + name);
    log(prefix + '--------------');
    for (let k in obj) {
        if (typeof obj[k] === 'object' && recurse) {
            prettyPrint(name + '::' + k, obj[k], true, indent + 1);
        }
        else {
            log(prefix + k, typeof obj[k] === 'function' ? '[Func]' : obj[k]);
        }
    }
}

// I/O Files
function writeRegistry (registry) {
    let json = JSON.stringify(registry);
    let contents = new GLib.Bytes(json);

    // Make sure dir exists
    GLib.mkdir_with_parents(REGISTRY_DIR, parseInt('0775', 8));

    // Write contents to file asynchronously
    let file = Gio.file_new_for_path(REGISTRY_PATH);
    file.replace_async(null, false, Gio.FileCreateFlags.NONE,
                        GLib.PRIORITY_DEFAULT, null, function (obj, res) {

        let stream = obj.replace_finish(res);

        stream.write_bytes_async(contents, GLib.PRIORITY_DEFAULT,
                            null, function (w_obj, w_res) {

            w_obj.write_bytes_finish(w_res);
            stream.close(null);
        });
    });
}

function readRegistry (callback) {
    if (typeof callback !== 'function')
        throw TypeError('`callback` must be a function');

    if (GLib.file_test(REGISTRY_PATH, FileTest.EXISTS)) {
        let file = Gio.file_new_for_path(REGISTRY_PATH);
        let CACHE_FILE_SIZE = SettingsSchema.get_int(Prefs.Fields.CACHE_FILE_SIZE);

        file.query_info_async('*', FileQueryInfoFlags.NONE,
                              GLib.PRIORITY_DEFAULT, null, function (src, res) {
            // Check if file size is larger than CACHE_FILE_SIZE
            // If so, make a backup of file, and invoke callback with empty array
            let file_info = src.query_info_finish(res);

            if (file_info.get_size() >= CACHE_FILE_SIZE * 1024) {
                let destination = Gio.file_new_for_path(BACKUP_REGISTRY_PATH);

                file.move(destination, FileCopyFlags.OVERWRITE, null, null);
                callback([]);
                return;
            }

            file.load_contents_async(null, function (obj, res) {
                let registry;
                let [success, contents] = obj.load_contents_finish(res);

                if (success) {
                    try {
                        let max_size = SettingsSchema.get_int(Prefs.Fields.HISTORY_SIZE);

                        // are we running gnome 3.30 or higher?
                        if (contents instanceof Uint8Array) {
                          contents = imports.byteArray.toString(contents);
                        }

                        registry = JSON.parse(contents);

                        let registryNoFavorite = registry.filter(
                            item => item['favorite'] === false);

                        while (registryNoFavorite.length > max_size) {
                            let oldestNoFavorite = registryNoFavorite.shift();
                            let itemIdx = registry.indexOf(oldestNoFavorite);
                            registry.splice(itemIdx,1);

                            registryNoFavorite = registry.filter(
                                item => item["favorite"] === false);
                        }
                    }
                    catch (e) {
                        registry = [];
                    }
                }
                else {
                    registry = [];
                }

                callback(registry);
            });
        });
    }
    else {
        callback([]);
    }
}
