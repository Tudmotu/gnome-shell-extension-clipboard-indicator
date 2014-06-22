const GLib = imports.gi.GLib;
const Gio = imports.gi.Gio;
const FileTest = GLib.FileTest;

const ExtensionUtils = imports.misc.extensionUtils;
const Me = ExtensionUtils.getCurrentExtension();

const REGISTRY_DIR = GLib.get_user_cache_dir() + '/' + Me.uuid;
const REGISTRY_FILE = '/registry.txt';
const REGISTRY_PATH = REGISTRY_DIR + REGISTRY_FILE;

// Print objects... why no dev tools
function dbPrintObj (name, obj, recurse, _indent) {
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
			dbPrintObj(name + '::' + k, obj[k], true, indent + 1);
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
            let success = w_obj.write_bytes_finish(w_res);
            stream.close(null);
        });
    });
}

function readRegistry (callback) {
    if (typeof callback !== 'function')
        throw TypeError('`callback` must be a function');

    if (GLib.file_test(REGISTRY_PATH, FileTest.EXISTS)) {
        let file = Gio.file_new_for_path(REGISTRY_PATH);
        file.load_contents_async(null, function (obj, res) {
            let success = obj.load_contents_finish(res); // Humm..
            let content = success[0] === true ?
                            JSON.parse(success[1]) :
                            [];

            callback(content);
        });
    }
    else {
        callback([]);
    }
}
