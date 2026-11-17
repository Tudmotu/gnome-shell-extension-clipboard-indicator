/*
 * Small authenticated encryption layer built only on GLib primitives, since
 * GJS has no WebCrypto.
 *
 *   key derivation   PBKDF2-HMAC-SHA256 (password) or /dev/urandom (session)
 *   cipher           HMAC-SHA512 in counter mode used as a keystream
 *   integrity        HMAC-SHA256 over header and ciphertext (encrypt-then-MAC)
 *
 * Blob layout: "CIE1" | salt(16) | iv(16) | mac(32) | ciphertext
 */
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';

const MAGIC = new Uint8Array([0x43, 0x49, 0x45, 0x31]);
const SALT_LEN = 16;
const IV_LEN = 16;
const MAC_LEN = 32;
const HEADER_LEN = MAGIC.length + SALT_LEN + IV_LEN + MAC_LEN;
const PBKDF2_ITERATIONS = 20000;

const HEX = new Uint8Array(128);
for (let i = 0; i < 10; i++) HEX[48 + i] = i;
for (let i = 0; i < 6; i++) HEX[97 + i] = 10 + i;

function hexToBytes (hex, out) {
    for (let i = 0, j = 0; j < hex.length; i++, j += 2)
        out[i] = (HEX[hex.charCodeAt(j)] << 4) | HEX[hex.charCodeAt(j + 1)];
    return out;
}

function hmacSha256 (key, data) {
    const hex = GLib.compute_hmac_for_bytes(GLib.ChecksumType.SHA256,
                                            new GLib.Bytes(key), new GLib.Bytes(data));
    return hexToBytes(hex, new Uint8Array(32));
}

function concat (...parts) {
    const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
    let offset = 0;
    for (const p of parts) {
        out.set(p, offset);
        offset += p.length;
    }
    return out;
}

function constantTimeEqual (a, b) {
    if (a.length !== b.length)
        return false;
    let diff = 0;
    for (let i = 0; i < a.length; i++)
        diff |= a[i] ^ b[i];
    return diff === 0;
}

function label (text) {
    return new TextEncoder().encode('clipboard-indicator ' + text);
}

function randomBytes (length) {
    const stream = Gio.File.new_for_path('/dev/urandom').read(null);
    const data = stream.read_bytes(length, null).get_data();
    stream.close(null);
    if (!data || data.length !== length)
        throw new Error('short read from /dev/urandom');
    return new Uint8Array(data);
}

/* PBKDF2-HMAC-SHA256, single 32 byte output block. */
function deriveKey (password, salt, iterations = PBKDF2_ITERATIONS) {
    const pw = new TextEncoder().encode(password);
    let u = hmacSha256(pw, concat(salt, new Uint8Array([0, 0, 0, 1])));
    const t = u.slice();
    for (let i = 1; i < iterations; i++) {
        u = hmacSha256(pw, u);
        for (let j = 0; j < 32; j++)
            t[j] ^= u[j];
    }
    return t;
}

/* The salt a blob was written with, needed to re-derive a password key. */
export function saltOf (blob) {
    return isEncrypted(blob) ? blob.slice(MAGIC.length, MAGIC.length + SALT_LEN) : null;
}

export function isEncrypted (blob) {
    return blob.length >= HEADER_LEN && MAGIC.every((b, i) => blob[i] === b);
}

export class Key {
    constructor (master, salt) {
        this.salt = salt;
        this._encKey = new GLib.Bytes(hmacSha256(master, label('enc')));
        this._macKey = hmacSha256(master, label('mac'));
        this._nameKey = new GLib.Bytes(hmacSha256(master, label('name')));
    }

    static random () {
        return new Key(randomBytes(32), randomBytes(SALT_LEN));
    }

    static fromPassword (password, salt) {
        salt = salt || randomBytes(SALT_LEN);
        return new Key(deriveKey(password, salt), salt);
    }

    _xorKeystream (iv, data) {
        const out = new Uint8Array(data.length);
        const block = new Uint8Array(IV_LEN + 4);
        const ks = new Uint8Array(64);
        block.set(iv, 0);

        for (let offset = 0, counter = 0; offset < data.length; offset += 64, counter++) {
            block[IV_LEN] = counter >>> 24;
            block[IV_LEN + 1] = (counter >>> 16) & 0xff;
            block[IV_LEN + 2] = (counter >>> 8) & 0xff;
            block[IV_LEN + 3] = counter & 0xff;
            hexToBytes(GLib.compute_hmac_for_bytes(GLib.ChecksumType.SHA512,
                                                  this._encKey, new GLib.Bytes(block)), ks);
            const n = Math.min(64, data.length - offset);
            for (let i = 0; i < n; i++)
                out[offset + i] = data[offset + i] ^ ks[i];
        }
        return out;
    }

    encrypt (plaintext) {
        const iv = randomBytes(IV_LEN);
        const ciphertext = this._xorKeystream(iv, plaintext);
        const mac = hmacSha256(this._macKey, concat(MAGIC, this.salt, iv, ciphertext));
        return concat(MAGIC, this.salt, iv, mac, ciphertext);
    }

    /* Plaintext, or null when the blob is not from this key or was altered. */
    decrypt (blob) {
        if (!isEncrypted(blob))
            return null;

        let offset = MAGIC.length;
        const salt = blob.subarray(offset, offset += SALT_LEN);
        const iv = blob.subarray(offset, offset += IV_LEN);
        const mac = blob.subarray(offset, offset += MAC_LEN);
        const ciphertext = blob.subarray(offset);

        const expected = hmacSha256(this._macKey, concat(MAGIC, salt, iv, ciphertext));
        if (!constantTimeEqual(mac, expected))
            return null;

        return this._xorKeystream(iv, ciphertext);
    }

    /* Keyed file name, so cache names do not reveal plain content hashes. */
    nameFor (data) {
        return GLib.compute_hmac_for_bytes(GLib.ChecksumType.SHA256,
                                           this._nameKey, new GLib.Bytes(data));
    }
}
