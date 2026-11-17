import St from 'gi://St';
import GObject from 'gi://GObject';
import Clutter from 'gi://Clutter';
import * as ModalDialog from 'resource:///org/gnome/shell/ui/modalDialog.js';
import { boxLayoutOrientation } from './compat.js';

/*
 * A modal dialog that collects the history password: once to unlock or
 * encrypt, twice to set a new one. onSubmit returns null to close the
 * dialog, an error string to show it and keep the dialog open, or a
 * Promise of either. onFinish is emitted either way so the caller can
 * drop its reference.
 */
export const PasswordDialog = GObject.registerClass(
    class PasswordDialog extends ModalDialog.ModalDialog {
        #onSubmit = null;
        #first = null;
        #confirm = null;
        #error = null;

        _init ({ title, confirm, onSubmit, onCancel }) {
            super._init();

            this.#onSubmit = onSubmit;
            this.onFinish = null;

            const message_box = new St.BoxLayout({
                ...boxLayoutOrientation(true)
            });
            this.contentLayout.add_child(message_box);

            message_box.add_child(new St.Label({
                style: 'font-weight: bold',
                x_align: Clutter.ActorAlign.CENTER,
                text: title
            }));

            const makeEntry = hint => {
                const entry = new St.Entry({
                    style: 'margin-top: 12px',
                    hint_text: hint,
                    can_focus: true,
                    x_expand: true
                });
                entry.clutter_text.set_password_char('\u25cf');
                message_box.add_child(entry);
                return entry;
            };

            this.#first = makeEntry(confirm ? _('Password') : _('Password'));
            this.#confirm = confirm ? makeEntry(_('Repeat password')) : null;

            this.#error = new St.Label({
                style: 'margin-top: 12px',
                x_align: Clutter.ActorAlign.CENTER,
                text: '',
                visible: false
            });
            message_box.add_child(this.#error);

            this.#first.clutter_text.connect('activate', () => {
                if (this.#confirm)
                    this.#confirm.grab_key_focus();
                else
                    this.#submit();
            });
            if (this.#confirm)
                this.#confirm.clutter_text.connect('activate', this.#submit.bind(this));

            this.setButtons([
                {
                    label: _('Cancel'),
                    action: () => {
                        this.close();
                        if (onCancel)
                            onCancel();
                        if (this.onFinish)
                            this.onFinish();
                    },
                    key: Clutter.KEY_Escape
                },
                {
                    label: confirm ? _('Set') : _('Unlock'),
                    action: () => this.#submit(),
                    'default': true
                }
            ]);

            this.connect('opened', () => this.#first.grab_key_focus());
        }

        async #submit () {
            const password = this.#first.get_text();

            let message = null;
            if (password.length === 0)
                message = _('Enter a password');
            else if (this.#confirm && this.#confirm.get_text() !== password)
                message = _('The passwords do not match');
            else
                message = await this.#onSubmit(password);

            if (message) {
                this.#error.text = message;
                this.#error.show();
                this.#first.clutter_text.set_selection(0, -1);
                this.#first.grab_key_focus();
                return;
            }

            this.close();
            if (this.onFinish)
                this.onFinish();
        }
    }
);
