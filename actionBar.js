const St = imports.gi.St;
const PopupMenu = imports.ui.popupMenu;
const GObject = imports.gi.GObject;
const Clutter = imports.gi.Clutter;
const Lang = imports.lang;

const ExtensionUtils = imports.misc.extensionUtils;
const Me = ExtensionUtils.getCurrentExtension();
const ConfirmDialog = Me.imports.confirmDialog;
const Utils = Me.imports.utils;

const Gettext = imports.gettext.domain("clipboard-indicator");
const _ = Gettext.gettext;

var ActionBar = GObject.registerClass(
  class ActionBar extends PopupMenu.PopupBaseMenuItem {
    _init() {
      super._init({
        activate: false,
        hover: false,
        style_class: 'ci-action-bar-box',
      })

      this.actionsBox = new St.BoxLayout({
        vertical: false,
        style_class: 'ci-action-bar-box-layout',
      });

      this.actionsBox.set_x_expand(true);
      this.actionsBox.set_y_expand(true);

      // TODO:: Add tooltip
      // Private mode switch
      this.privateModeBtn = new PopupMenu.PopupSwitchMenuItem(
        _("Private mode"), false, {
        reactive: true, hover: true,
      });
      this.actionsBox.add(this.privateModeBtn);
      // Add a spacer
      this.spacer = new PopupMenu.PopupBaseMenuItem();
      this.spacer.set_x_expand(true);
      this.spacer.set_y_expand(true);
      this.actionsBox.add(this.spacer);      

      // Add 'Clear' button which removes all items from cache
      this.clearBtn = new PopupMenu.PopupBaseMenuItem({
        style_class: 'ci-action-bar-btn'
      });


      this.clearIcon = new St.Icon({
        icon_name: "edit-delete-all-symbolic",
        style_class: 'popup-menu-icon',
        hover: true,

      });
      this.clearBtn.add_child(this.clearIcon);
      this.clearBtn.set_x_expand(false);
      this.clearBtn.set_y_expand(false);
      this.clearBtn._ornamentLabel.visible = false;
      this.actionsBox.add(this.clearBtn);

      // TODO:: Add tooltip
      // Add 'Settings' menu item to open settings
      this.settingsBtn = new PopupMenu.PopupBaseMenuItem({
        style_class: 'ci-action-bar-btn'
      });

      this.settingsIcon = new St.Icon({
        icon_name: "applications-system-symbolic",
        style_class: 'popup-menu-icon',
        hover: true,

      });
      this.settingsBtn.add_child(this.settingsIcon);
      this.settingsBtn.set_x_expand(false);
      this.settingsBtn.set_y_expand(false);
      this.settingsBtn._ornamentLabel.visible = false;
      this.actionsBox.add(this.settingsBtn);

      this.actor.add(this.actionsBox);
    }

    _registerPrivateModeSwitch(callback) {
      this.privateModeBtn.connect('toggled', (obj) => {
        callback(obj.state);
      });
    }

    _registerRemoveAll(callback) {
      this.clearBtn.connect('activate', (obj) => {
        callback();
      });
    }

    _registerOpenSettings(callback) {
      this.settingsBtn.connect('activate', (obj) => {
        callback();
      });
    }

    _privateMode() {
      return this.privateModeBtn.state;
    }
  }
);
