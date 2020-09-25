const St = imports.gi.St;
const GObject = imports.gi.GObject;
const ModalDialog = imports.ui.modalDialog;
const CheckBox = imports.ui.checkBox;
const Clutter = imports.gi.Clutter;




function openConfirmDialog(title, message, sub_message, ok_label, cancel_label, callback) {
    new ConfirmDialog(title, message + "\n" + sub_message, ok_label, cancel_label, callback).open();
}

const ConfirmDialog = GObject.registerClass(
  class ConfirmDialog extends ModalDialog.ModalDialog {

    _init(title, desc, ok_label, cancel_label, callback) {
      super._init();

      let main_box = new St.BoxLayout({
        vertical: false,
        style_class: 'gt-modal-dialog',
      });
      this.contentLayout.add(main_box, { x_fill: true, y_fill: true });

      let message_box = new St.BoxLayout({
        vertical: true
      });
      main_box.add(message_box, { y_align: St.Align.START });

      let subject_label = new St.Label({
        style: `font-weight: 700`,
        text: title
      });

      message_box.add(subject_label, { y_fill: true, y_align: St.Align.START });

      let desc_label = new St.Label({
        style: 'padding-top: 12px; ',
        text: desc
      });

      message_box.add(desc_label, { y_fill: true, y_align: St.Align.START });

      this.setButtons([
        {
          label: cancel_label,
          action: () => {
            this.close();
          },
          key: Clutter.Escape
        },
        {
          label: ok_label,
          action: () => {
            this.close();
            callback();
          }
        }
      ]);
    }
  }
);
