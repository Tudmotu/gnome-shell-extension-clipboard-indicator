const GLib = imports.gi.GLib;
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
    let textContent = JSON.stringify(registry);

    // Make sure dir exists
    GLib.mkdir_with_parents(REGISTRY_DIR, parseInt('0775', 8));

    // Write contents to file
    GLib.file_set_contents(REGISTRY_PATH, textContent);
}

function readRegistry () {
    if (GLib.file_test(REGISTRY_PATH, FileTest.EXISTS)) {
        let fileContent = GLib.file_get_contents(REGISTRY_PATH)[1];
        let textContent = fileContent.toString().trim();

        return JSON.parse(textContent);
    }
    else {
        return [];
    }
}
