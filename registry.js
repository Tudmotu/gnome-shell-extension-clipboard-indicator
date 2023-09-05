import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import { PrefsFields } from './constants.js';

const FileQueryInfoFlags = Gio.FileQueryInfoFlags;
const FileCopyFlags = Gio.FileCopyFlags;
const FileTest = GLib.FileTest;

export default class Registry {
    constructor ({ settings, uuid }) {
        this.uuid = uuid;
        this.settings = settings;
        this.REGISTRY_FILE = 'registry.txt';
        this.REGISTRY_DIR = GLib.get_user_cache_dir() + '/' + this.uuid;
        this.REGISTRY_PATH = this.REGISTRY_DIR + '/' + this.REGISTRY_FILE;
        this.BACKUP_REGISTRY_PATH = this.REGISTRY_PATH + '~';
    }

    write (registry) {
        let json = JSON.stringify(registry);
        let contents = new GLib.Bytes(json);

        // Make sure dir exists
        GLib.mkdir_with_parents(this.REGISTRY_DIR, parseInt('0775', 8));

        // Write contents to file asynchronously
        let file = Gio.file_new_for_path(this.REGISTRY_PATH);
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

    read (callback) {
        if (typeof callback !== 'function')
            throw TypeError('`callback` must be a function');

        if (GLib.file_test(this.REGISTRY_PATH, FileTest.EXISTS)) {
            let file = Gio.file_new_for_path(this.REGISTRY_PATH);
            let CACHE_FILE_SIZE = this.settings.get_int(PrefsFields.CACHE_FILE_SIZE);

            file.query_info_async('*', FileQueryInfoFlags.NONE,
                                  GLib.PRIORITY_DEFAULT, null, function (src, res) {
                // Check if file size is larger than CACHE_FILE_SIZE
                // If so, make a backup of file, and invoke callback with empty array
                let file_info = src.query_info_finish(res);

                if (file_info.get_size() >= CACHE_FILE_SIZE * 1024) {
                    let destination = Gio.file_new_for_path(this.BACKUP_REGISTRY_PATH);

                    file.move(destination, FileCopyFlags.OVERWRITE, null, null);
                    callback([]);
                    return;
                }

                file.load_contents_async(null, function (obj, res) {
                    let registry;
                    let [success, contents] = obj.load_contents_finish(res);

                    if (success) {
                        try {
                            let max_size = this.settings.get_int(PrefsFields.HISTORY_SIZE);

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
}
