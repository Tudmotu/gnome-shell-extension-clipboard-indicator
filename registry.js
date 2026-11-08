import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import St from 'gi://St';
import { PrefsFields } from './constants.js';

const FileQueryInfoFlags = Gio.FileQueryInfoFlags;
const FileCopyFlags = Gio.FileCopyFlags;
const FileTest = GLib.FileTest;

export class Registry {
    #writing = false;
    #pendingWrite = null;

    constructor ({ settings, uuid }) {
        this.uuid = uuid;
        this.settings = settings;
        this.REGISTRY_FILE = 'registry.txt';
        this.REGISTRY_DIR = GLib.get_user_cache_dir() + '/' + this.uuid;
        this.REGISTRY_PATH = this.REGISTRY_DIR + '/' + this.REGISTRY_FILE;
        this.BACKUP_REGISTRY_PATH = this.REGISTRY_PATH + '~';
    }

    write (entries) {
        const registryContent = [];

        for (let entry of entries) {
            const item = {
                favorite: entry.isFavorite(),
                mimetype: entry.mimetype()
            };

            registryContent.push(item);

            if (entry.isText()) {
                item.contents = entry.getStringValue();
            }
            else if (entry.isImage()) {
                const filename = this.getEntryFilename(entry);
                item.contents = filename;
                this.writeEntryFile(entry);
            }

            if (entry.getTag()) item.tag = entry.getTag();
        }

        this.writeToFile(registryContent);
    }

    writeToFile (registry) {
        // Only one write may be in flight. When GIO can't use a temp file
        // (e.g. hardlinked file, or ownership can't be preserved) it rewrites
        // the file in place, and two overlapping writes then leave the tail
        // of the longer one behind the shorter one, corrupting the JSON.
        // Queued writes are coalesced: only the newest content matters.
        this.#pendingWrite = JSON.stringify(registry);
        if (!this.#writing) this.#flushWrite();
    }

    #flushWrite () {
        const contents = new GLib.Bytes(this.#pendingWrite);
        this.#pendingWrite = null;
        this.#writing = true;

        // Make sure dir exists
        GLib.mkdir_with_parents(this.REGISTRY_DIR, parseInt('0775', 8));

        // replace_contents writes all bytes (a single write_bytes call may not).
        // REPLACE_DESTINATION makes GIO always write a temp file and rename it
        // over the registry, instead of falling back to rewriting it in place
        // (hardlinks, symlinks, ownership that can't be copied). Owner and
        // mode of the old file are not kept, which is fine for a cache file.
        let file = Gio.file_new_for_path(this.REGISTRY_PATH);
        file.replace_contents_bytes_async(contents, null, false,
                            Gio.FileCreateFlags.REPLACE_DESTINATION, null, (obj, res) => {
            try {
                obj.replace_contents_finish(res);
            } catch (e) {
                console.error('Clipboard Indicator: failed to write registry file', e);
            }

            this.#writing = false;
            if (this.#pendingWrite !== null) this.#flushWrite();
        });
    }

    async read () {
        return new Promise(resolve => {
            if (GLib.file_test(this.REGISTRY_PATH, FileTest.EXISTS)) {
                let file = Gio.file_new_for_path(this.REGISTRY_PATH);
                let CACHE_FILE_SIZE = this.settings.get_int(PrefsFields.CACHE_FILE_SIZE);

                file.query_info_async('*', FileQueryInfoFlags.NONE,
                                      GLib.PRIORITY_DEFAULT, null, (src, res) => {
                    // Check if file size is larger than CACHE_FILE_SIZE
                    // If so, make a backup of file, and keep only its favorites
                    let file_info = src.query_info_finish(res);
                    let isOversized = file_info.get_size() >= CACHE_FILE_SIZE * 1024 * 1024;
                    let source = file;

                    if (isOversized) {
                        source = Gio.file_new_for_path(this.BACKUP_REGISTRY_PATH);
                        file.move(source, FileCopyFlags.OVERWRITE, null, null);
                    }

                    source.load_contents_async(null, (obj, res) => {
                        let [success, contents] = obj.load_contents_finish(res);

                        if (success) {
                            let max_size = this.settings.get_int(PrefsFields.HISTORY_SIZE);
                            const cacheTextData = new TextDecoder().decode(contents);
                            let registry = [];
                            if (cacheTextData.trim().length > 0) {
                                try {
                                    const parsed = JSON.parse(cacheTextData);
                                    if (!Array.isArray(parsed))
                                        throw new Error('not a list of entries');
                                    registry = parsed;
                                } catch (e) {
                                    // Start with an empty history instead of never
                                    // loading. Keep the unreadable file as the backup,
                                    // so the next write does not overwrite it
                                    console.error(`Clipboard Indicator: could not read registry file, starting with an empty history: ${e.message}`);
                                    if (!isOversized) {
                                        try {
                                            file.move(Gio.file_new_for_path(this.BACKUP_REGISTRY_PATH),
                                                      FileCopyFlags.OVERWRITE, null, null);
                                        } catch (moveError) {
                                            console.error(moveError);
                                        }
                                    }
                                }
                            }
                            const entriesPromises = registry.map(
                                jsonEntry => {
                                    return ClipboardEntry.fromJSON(jsonEntry)
                                }
                            );

                            Promise.all(entriesPromises).then(clipboardEntries => {
                                clipboardEntries = clipboardEntries
                                    .filter(entry => entry !== null);

                                if (isOversized) {
                                    const favorites = clipboardEntries
                                        .filter(entry => entry.isFavorite());

                                    // Nothing else rewrites the registry until the
                                    // next clipboard change, so persist favorites now
                                    resolve(favorites);
                                    this.write(favorites);

                                    return;
                                }

                                // Drop the oldest unpinned entries beyond the
                                // history size, in a single pass
                                let excess = clipboardEntries
                                    .filter(entry => !entry.isFavorite()).length - max_size;

                                if (excess > 0) {
                                    clipboardEntries = clipboardEntries.filter(entry => {
                                        if (excess > 0 && !entry.isFavorite()) {
                                            excess--;
                                            return false;
                                        }
                                        return true;
                                    });
                                }

                                resolve(clipboardEntries);
                            }).catch(e => {
                                console.error(e);
                            });
                        }
                        else {
                            console.error('Clipboard Indicator: failed to open registry file');
                        }
                    });
                });
            }
            else {
                resolve([]);
            }
        });
    }

    #entryFileExists (entry) {
        const filename = this.getEntryFilename(entry);
        return GLib.file_test(filename, FileTest.EXISTS);
    }

    async getEntryAsImage (entry) {
        if (entry.isImage() === false) return;

        if (this.#entryFileExists(entry) == false) {
            await this.writeEntryFile(entry);
        }

        const gicon = Gio.icon_new_for_string(this.getEntryFilename(entry));
        const stIcon = new St.Icon({ gicon });
        return stIcon;
    }

    async getEntryAsTexture (entry) {
        if (entry.isImage() === false) return null;

        if (this.#entryFileExists(entry) === false) {
            await this.writeEntryFile(entry);
        }

        const file = Gio.file_new_for_path(this.getEntryFilename(entry));
        const scaleFactor = St.ThemeContext.get_for_stage(global.stage).scale_factor;
        return St.TextureCache.get_default().load_file_async(file, -1, -1, scaleFactor, 1.0);
    }

    getEntryFilename (entry) {
        return `${this.REGISTRY_DIR}/${entry.hash()}`;
    }

    async writeEntryFile (entry) {
        if (this.#entryFileExists(entry)) return;

        let file = Gio.file_new_for_path(this.getEntryFilename(entry));

        return new Promise(resolve => {
            file.replace_async(null, false, Gio.FileCreateFlags.NONE,
                               GLib.PRIORITY_DEFAULT, null, (obj, res) => {

                let stream = obj.replace_finish(res);

                stream.write_bytes_async(entry.asBytes(), GLib.PRIORITY_DEFAULT,
                                         null, (w_obj, w_res) => {

                    w_obj.write_bytes_finish(w_res);
                    stream.close(null);
                    resolve();
                });
            });
        });
    }

    async deleteEntryFile (entry) {
        const file = Gio.file_new_for_path(this.getEntryFilename(entry));

        try {
            await file.delete_async(GLib.PRIORITY_DEFAULT, null);
        }
        catch (e) {
            console.error(e);
        }
    }

    clearCacheFolder() {

        const CANCELLABLE = null;
        try {
            const folder = Gio.file_new_for_path(this.REGISTRY_DIR);
            const enumerator = folder.enumerate_children("", 1, CANCELLABLE);

            let file;
            while ((file = enumerator.iterate(CANCELLABLE)[2]) != null) {
                file.delete(CANCELLABLE);
            }

        }
        catch (e) {
            console.error(e);
        }
    }
}

export class ClipboardEntry {
    #mimetype;
    #bytes;
    #favorite;
    #cachedHash = null;
    #cachedString = null;

    static #decode (contents) {
        return Uint8Array.from(contents.match(/.{1,2}/g).map((byte) => parseInt(byte, 16)));
    }

    static __isText (mimetype) {
        return mimetype.startsWith('text/') ||
            mimetype === 'STRING' ||
            mimetype === 'UTF8_STRING';
    }

    static async fromJSON (jsonEntry) {
        const mimetype = jsonEntry.mimetype || 'text/plain;charset=utf-8';
        const favorite = jsonEntry.favorite;
        let bytes;

        if (ClipboardEntry.__isText(mimetype)) {
            bytes = new TextEncoder().encode(jsonEntry.contents);
        }
        else {
            const filename = jsonEntry.contents;
            if (!GLib.file_test(filename, FileTest.EXISTS)) return null;

            let file = Gio.file_new_for_path(filename);

            const contentType = await file.query_info_async('*', FileQueryInfoFlags.NONE, GLib.PRIORITY_DEFAULT, null, (obj, res) => {
                try {
                    const fileInfo = obj.query_info_finish(res);
                    return fileInfo.get_content_type();
                } catch (e) {
                    console.error(e);
                }
            });

            if (contentType && !contentType.startsWith('image/') && !contentType.startsWith('text/')) {
                bytes = new TextEncoder().encode(jsonEntry.contents);
            }
            else {
                bytes = await new Promise((resolve, reject) => file.load_contents_async(null, (obj, res) => {
                    let [success, contents] = obj.load_contents_finish(res);

                    if (success) {
                        resolve(contents);
                    }
                    else {
                        reject(
                            new Error('Clipboard Indicator: could not read image file from cache')
                        );
                    }
                }));
            }
        }

        const entry = new ClipboardEntry(mimetype, bytes, favorite);
        if (jsonEntry.tag) entry.setTag(jsonEntry.tag);
        return entry;
    }

    constructor (mimetype, bytes, favorite) {
        this.#mimetype = mimetype;
        this.#bytes = bytes;
        this.#favorite = favorite;
    }

    #encode () {
        if (this.isText()) {
            return this.getStringValue();
        }

        return [...this.#bytes]
            .map(x => x.toString(16).padStart(2, '0'))
            .join('');
    }

    getStringValue () {
        if (this.isImage()) {
            return `[Image ${this.hash()}]`;
        }
        return (this.#cachedString ??= new TextDecoder().decode(this.#bytes));
    }

    mimetype () {
        return this.#mimetype;
    }

    isFavorite () {
        return this.#favorite;
    }

    set favorite (val) {
        this.#favorite = !!val;
    }

    isText () {
        return ClipboardEntry.__isText(this.#mimetype);
    }

    isImage () {
        return this.#mimetype.startsWith('image/');
    }

    setText (text) {
        if (!this.isText()) return;
        this.#bytes = new TextEncoder().encode(text);
        this.#cachedHash = null;
        this.#cachedString = null;
    }

    #tag = null;

    getTag () {
        return this.#tag;
    }

    setTag (tag) {
        this.#tag = tag || null;
    }

    asBytes () {
        return GLib.Bytes.new(this.#bytes);
    }

    equals (otherEntry) {
        return this.getStringValue() === otherEntry.getStringValue();
        // this.asBytes().equal(otherEntry.asBytes());
    }

    hash () {
        return (this.#cachedHash ??= GLib.Bytes.new(this.#bytes).hash());
    }
}
