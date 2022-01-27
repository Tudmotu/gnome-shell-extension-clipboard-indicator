'use strict';

const { GLib, Gio } = imports.gi;

const ExtensionUtils = imports.misc.extensionUtils;
const Me = ExtensionUtils.getCurrentExtension();
const DataStructures = Me.imports.dataStructures;

const REGISTRY_DIR = GLib.build_filenamev([GLib.get_user_cache_dir(), Me.uuid]);
const OLD_REGISTRY_FILE = GLib.build_filenamev([REGISTRY_DIR, '/registry.txt']);
/**
 * Stores our compacting log implementation. Here are its key ideas:
 * - We only ever append to the log.
 * - This means there will be operations that cancel each other out. These are wasted/useless ops
 *   that must be occasionally pruned. MAX_WASTED_OPS limits the number of useless ops.
 * - The available operations are listed in the OP_TYPE_* constants.
 * - An add op never moves (until compaction), allowing us to derive globally unique entry IDs based
 *   on the order in which these add ops are discovered.
 */
const DATABASE_FILE = GLib.build_filenamev([REGISTRY_DIR, '/database.log']);

// Don't use zero b/c DataInputStream uses 0 as its error value
const OP_TYPE_SAVE_TEXT = 1;
const OP_TYPE_DELETE_TEXT = 2;
const OP_TYPE_FAVORITE_ITEM = 3;
const OP_TYPE_UNFAVORITE_ITEM = 4;
const OP_TYPE_MOVE_ITEM_TO_END = 5;

const MAX_WASTED_OPS = 500;
let uselessOpCount;

function init() {
  if (GLib.mkdir_with_parents(REGISTRY_DIR, 0o775) !== 0) {
    log(
      Me.uuid,
      "Failed to create cache dir, extension likely won't work",
      REGISTRY_DIR,
    );
  }
}

class TextEntry extends DataStructures.LinkedListItem {
  constructor(id, text) {
    super();
    this.id = id;
    this.type = 'text';
    this.text = text;
    this.favorite = false;
  }

  getId() {
    return this.id;
  }
}

function buildClipboardStateFromLog(callback) {
  if (typeof callback !== 'function') {
    throw TypeError('`callback` must be a function');
  }
  uselessOpCount = 0;

  Gio.File.new_for_path(DATABASE_FILE).read_async(0, null, (src, res) => {
    try {
      _parseLog(src.read_finish(res), callback);
    } catch (e) {
      if (e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.NOT_FOUND)) {
        _readAndConsumeOldFormat(callback);
      } else {
        throw e;
      }
    }
  });
}

function _parseLog(stream, callback) {
  stream = Gio.DataInputStream.new(stream);
  stream.set_byte_order(Gio.DataStreamByteOrder.BIG_ENDIAN);
  _consumeStream(
    stream,
    { entries: new DataStructures.LinkedList(), nextId: 1 },
    callback,
  );
}

function _consumeStream(stream, state, callback) {
  const forceFill = (minBytes, fillCallback) => {
    stream.fill_async(/*count=*/ -1, 0, null, (src, res) => {
      if (src.fill_finish(res) < minBytes) {
        callback(state.entries.toArray(), state.nextId);
      } else {
        fillCallback();
      }
    });
  };

  if (stream.get_available() === 0) {
    forceFill(1, () => _consumeStream(stream, state, callback));
    return;
  }

  const parseAvailableAware = (minBytes, parse) => {
    if (stream.get_available() < minBytes) {
      forceFill(minBytes, parse);
    } else {
      parse();
    }
  };

  const opType = stream.read_byte(null);
  if (opType === OP_TYPE_SAVE_TEXT) {
    stream.read_upto_async(
      /*stop_chars=*/ '\0',
      /*stop_chars_len=*/ 1,
      0,
      null,
      (src, res) => {
        const [text] = src.read_upto_finish(res);
        src.read_byte(null);

        state.entries.append(new TextEntry(state.nextId++, text));
        _consumeStream(stream, state, callback);
      },
    );
    return;
  } else if (opType === OP_TYPE_DELETE_TEXT) {
    parseAvailableAware(4, () => {
      const id = stream.read_uint32(null);
      state.entries.findById(id).detach();
    });
    uselessOpCount += 2;
  } else if (opType === OP_TYPE_FAVORITE_ITEM) {
    parseAvailableAware(4, () => {
      const id = stream.read_uint32(null);
      state.entries.findById(id).favorite = true;
    });
  } else if (opType === OP_TYPE_UNFAVORITE_ITEM) {
    parseAvailableAware(4, () => {
      const id = stream.read_uint32(null);
      state.entries.findById(id).favorite = false;
    });
    uselessOpCount += 2;
  } else if (opType === OP_TYPE_MOVE_ITEM_TO_END) {
    parseAvailableAware(4, () => {
      const id = stream.read_uint32(null);
      state.entries.append(state.entries.findById(id).detach());
    });
    uselessOpCount++;
  } else {
    log(Me.uuid, 'Unknown op type, aborting load.', opType);
    callback(state.entries.toArray(), state.nextId);
    return;
  }

  _consumeStream(stream, state, callback);
}

function _readAndConsumeOldFormat(callback) {
  Gio.File.new_for_path(OLD_REGISTRY_FILE).load_contents_async(
    null,
    (src, res) => {
      const state = [];
      let id = 1;

      let contents;
      try {
        [, contents] = src.load_contents_finish(res);
      } catch (e) {
        if (e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.NOT_FOUND)) {
          callback(state, id);
          return;
        } else {
          throw e;
        }
      }

      let registry = [];
      try {
        registry = JSON.parse(imports.byteArray.toString(contents));
      } catch (e) {
        logError(e);
      }

      for (const entry of registry) {
        if (typeof entry === 'string') {
          state.push({ id, type: 'text', text: entry, favorite: false });
        } else {
          state.push({
            id,
            type: 'text',
            text: entry.contents,
            favorite: entry.favorite,
          });
        }

        id++;
      }

      resetDatabase(() => state);
      Gio.File.new_for_path(OLD_REGISTRY_FILE).delete_async(
        0,
        null,
        (src, res) => {
          src.delete_finish(res);
        },
      );

      callback(state, id);
    },
  );
}

function maybePerformLogCompaction(currentStateBuilder) {
  if (uselessOpCount >= MAX_WASTED_OPS) {
    resetDatabase(currentStateBuilder);
  }
}

function resetDatabase(currentStateBuilder) {
  uselessOpCount = 0;

  const priority = -10;
  Gio.File.new_for_path(DATABASE_FILE).replace_async(
    /*etag=*/ null,
    /*make_backup=*/ false,
    Gio.FileCreateFlags.PRIVATE,
    priority,
    null,
    (src, res) => {
      const state = currentStateBuilder();
      if (state.length === 0) {
        _writeToStream(src.replace_finish(res), priority, () => true);
        return;
      }

      let i = 0;
      _writeToStream(src.replace_finish(res), priority, (dataStream) => {
        do {
          const entry = state[i];

          if (entry.type === 'text') {
            _storeTextOp(entry.text)(dataStream);
          } else {
            throw new TypeError('Unknown type: ' + entry.type);
          }
          if (entry.favorite) {
            _updateFavoriteStatusOp(entry.id, true)(dataStream);
          }

          i++;
        } while (i % 1000 !== 0 && i < state.length);

        // Flush the buffer every 1000 entries
        return i >= state.length;
      });
    },
  );
}

function storeTextEntry(text) {
  _appendBytesToLog(_storeTextOp(text), -5);
}

function _storeTextOp(text) {
  return (dataStream) => {
    dataStream.put_byte(OP_TYPE_SAVE_TEXT, null);
    dataStream.put_string(_normalizedText(text), null);
    dataStream.put_byte(0, null); // NUL terminator
    return true;
  };
}

function deleteTextEntry(id) {
  _appendBytesToLog(_deleteTextOp(id), 5);
  uselessOpCount += 2;
}

function _deleteTextOp(id) {
  return (dataStream) => {
    dataStream.put_byte(OP_TYPE_DELETE_TEXT, null);
    dataStream.put_uint32(id, null);
    return true;
  };
}

function updateFavoriteStatus(id, favorite) {
  _appendBytesToLog(_updateFavoriteStatusOp(id, favorite));

  if (!favorite) {
    uselessOpCount += 2;
  }
}

function _updateFavoriteStatusOp(id, favorite) {
  return (dataStream) => {
    dataStream.put_byte(
      favorite ? OP_TYPE_FAVORITE_ITEM : OP_TYPE_UNFAVORITE_ITEM,
      null,
    );
    dataStream.put_uint32(id, null);
    return true;
  };
}

function moveEntryToEnd(id) {
  _appendBytesToLog(_moveToEndOp(id));
  uselessOpCount++;
}

function _moveToEndOp(id) {
  return (dataStream) => {
    dataStream.put_byte(OP_TYPE_MOVE_ITEM_TO_END, null);
    dataStream.put_uint32(id, null);
    return true;
  };
}

/**
 * Defends against extra NUL terminators by simply removing them. This changes the copied data but
 * oh well. I mean, is it even possible to copy the NUL byte?
 *
 * Ideally, we would simply store the length of the string in bytes and read that number of bytes
 * to get the string back, but JavaScript is hot garbage so a) we can't get the length of the string
 * in bytes without using a TextEncoder polyfill (the length will be wrong with emojis and such) and
 * b) there's no API to read back some number of bytes. Theoretically we could hack our way around
 * this stuff, but it's not worth it.
 */
function _normalizedText(text) {
  return text.replaceAll('\0', '');
}

function _appendBytesToLog(callback, priority) {
  priority = priority || 0;
  Gio.File.new_for_path(DATABASE_FILE).append_to_async(
    Gio.FileCreateFlags.PRIVATE,
    priority,
    null,
    (src, res) => {
      _writeToStream(src.append_to_finish(res), priority, callback);
    },
  );
}

function _writeToStream(stream, priority, callback) {
  const bufStream = Gio.BufferedOutputStream.new(stream);
  bufStream.set_auto_grow(true); // Blocks flushing, needed for hack
  const ioStream = Gio.DataOutputStream.new(bufStream);
  ioStream.set_byte_order(Gio.DataStreamByteOrder.BIG_ENDIAN);

  _writeCallbackBytesAsyncHack(callback, ioStream, priority, () => {
    ioStream.close_async(priority, null, (src, res) => {
      src.close_finish(res);
    });
  });
}

/**
 * This garbage code is here to keep disk writes off the main thread. DataOutputStream doesn't have
 * async method variants, so we write to a memory buffer and then flush it asynchronously. We're
 * basically trying to balance memory allocations with disk writes.
 */
function _writeCallbackBytesAsyncHack(
  dataCallback,
  stream,
  priority,
  callback,
) {
  if (dataCallback(stream)) {
    callback();
  } else {
    stream.flush_async(priority, null, (src, res) => {
      src.flush_finish(res);
      _writeCallbackBytesAsyncHack(dataCallback, stream, priority, callback);
    });
  }
}
