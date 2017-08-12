const Clutter    = imports.gi.Clutter;
const Gio        = imports.gi.Gio;
const Lang       = imports.lang;
const Mainloop   = imports.mainloop;
const Meta       = imports.gi.Meta;
const Shell      = imports.gi.Shell;
const St         = imports.gi.St;
const PolicyType = imports.gi.Gtk.PolicyType;
const Util       = imports.misc.util;
const MessageTray = imports.ui.messageTray;

const Main      = imports.ui.main;
const PanelMenu = imports.ui.panelMenu;
const PopupMenu = imports.ui.popupMenu;
const CheckBox  = imports.ui.checkBox.CheckBox;

const Gettext = imports.gettext;
const _ = Gettext.domain('clipboard-indicator').gettext;

const Clipboard = St.Clipboard.get_default();
const CLIPBOARD_TYPE = St.ClipboardType.CLIPBOARD;

const SETTING_KEY_CLEAR_HISTORY = "clear-history";
const SETTING_KEY_PREV_ENTRY = "prev-entry";
const SETTING_KEY_NEXT_ENTRY = "next-entry";
const SETTING_KEY_TOGGLE_MENU = "toggle-menu";
const INDICATOR_ICON = 'edit-paste-symbolic';

const ExtensionUtils = imports.misc.extensionUtils;
const Me = ExtensionUtils.getCurrentExtension();
const Utils = Me.imports.utils;
const Prefs = Me.imports.prefs;
const prettyPrint = Utils.prettyPrint;
const writeRegistry = Utils.writeRegistry;
const readRegistry = Utils.readRegistry;

let TIMEOUT_MS           = 1000;
let MAX_REGISTRY_LENGTH  = 15;
let MAX_ENTRY_LENGTH     = 50;
let DELETE_ENABLED       = true;
let ENABLE_KEYBINDING    = true;
let PRIVATEMODE          = false;
let NOTIFY_ON_COPY       = true;

const ClipboardIndicator = Lang.Class({
    Name: 'ClipboardIndicator',
    Extends: PanelMenu.Button,

    _settingsChangedId: null,
    _clipboardTimeoutId: null,
    _historyLabelTimeoutId: null,
    _historyLabel: null,

    destroy: function () {
        this._disconnectSettings();
        this._unbindShortcuts();
        this._clearClipboardTimeout();
        this._clearLabelTimeout();
        this._clearDelayedSelectionTimeout();

        // Call parent
        this.parent();
    },

    _init: function() {
        this.parent(0.0, "ClipboardIndicator");
        let hbox = new St.BoxLayout({ style_class: 'panel-status-menu-box clipboard-indicator-hbox' });
        this.icon = new St.Icon({ icon_name: INDICATOR_ICON,
            style_class: 'system-status-icon clipboard-indicator-icon' });

        hbox.add_child(this.icon);
        hbox.add(PopupMenu.arrowIcon(St.Side.BOTTOM));
        this.actor.add_child(hbox);

        this._shortcutsBindingIds = [];
        this.clipItemsRadioGroup = [];

        this._createHistoryLabel();
        this._loadSettings();
        this._buildMenu();
        this._setupTimeout();
    },

    _buildMenu: function () {
        let that = this;
        this._getCache(function (clipHistory) {
            let lastIdx = clipHistory.length - 1;
            let clipItemsArr = that.clipItemsRadioGroup;

            // Create menu section for items
            that.historySection = new PopupMenu.PopupMenuSection();

            that.scrollViewMenuSection = new PopupMenu.PopupMenuSection();
            let historyScrollView = new St.ScrollView({
                style_class: 'ci-history-menu-section',
                overlay_scrollbars: true
            });
            historyScrollView.add_actor(that.historySection.actor);

            that.scrollViewMenuSection.actor.add_actor(historyScrollView);

            that.menu.addMenuItem(that.scrollViewMenuSection);

            // Add cached items
            clipHistory.forEach(function (buffer) {
                that._addEntry(buffer);
            });

            // Add separator
            that.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

            // Private mode switch
            that.privateModeMenuItem = new PopupMenu.PopupSwitchMenuItem(
                _("Private mode"), PRIVATEMODE, { reactive: true });
            that.privateModeMenuItem.connect('toggled',
                Lang.bind(that, that._onPrivateModeSwitch));
            that.menu.addMenuItem(that.privateModeMenuItem);
            that._onPrivateModeSwitch();

            // Add 'Clear' button which removes all items from cache
            let clearMenuItem = new PopupMenu.PopupMenuItem(_('Clear history'));
            that.menu.addMenuItem(clearMenuItem);
            clearMenuItem.connect('activate', Lang.bind(that, that._removeAll));

            // Add 'Settings' menu item to open settings
            let settingsMenuItem = new PopupMenu.PopupMenuItem(_('Settings'));
            that.menu.addMenuItem(settingsMenuItem);
            settingsMenuItem.connect('activate', Lang.bind(that, that._openSettings));

            if (lastIdx >= 0) {
                that._selectMenuItem(clipItemsArr[lastIdx]);
            }
        });
    },

    _setEntryLabel: function (menuItem) {
        let buffer = menuItem.clipContents,
        shortened = buffer.substr(0,MAX_ENTRY_LENGTH).replace(/\s+/g, ' ');

        if (buffer.length > MAX_ENTRY_LENGTH)
            shortened += '...';

        menuItem.label.set_text(shortened);
    },

    _addEntry: function (buffer, autoSelect, autoSetClip) {
        let menuItem = new PopupMenu.PopupMenuItem('');

        menuItem.menu = this.menu;
        menuItem.clipContents = buffer;
        menuItem.radioGroup = this.clipItemsRadioGroup;
        menuItem.buttonPressId = menuItem.connect('activate',
            Lang.bind(menuItem, this._onMenuItemSelected));

        this._setEntryLabel(menuItem);
        this.clipItemsRadioGroup.push(menuItem);

        let icon = new St.Icon({
            icon_name: 'edit-delete-symbolic', //'mail-attachment-symbolic',
            style_class: 'system-status-icon'
        });

        let icoBtn = new St.Button({
            style_class: 'ci-action-btn',
            x_fill: true,
            can_focus: true,
            child: icon
        });

        icoBtn.set_x_align(Clutter.ActorAlign.END);
        icoBtn.set_x_expand(true);
        icoBtn.set_y_expand(true);

        menuItem.actor.add_child(icoBtn);
        menuItem.icoBtn = icoBtn;
        menuItem.deletePressId = icoBtn.connect('button-press-event',
            Lang.bind(this, function () {
                this._removeEntry(menuItem);
            })
        );

        this.historySection.addMenuItem(menuItem, 0);

        if (autoSelect === true)
            this._selectMenuItem(menuItem, autoSetClip);

        this._updateCache();
    },

    _removeAll: function () {
        let that = this;
        // We can't actually remove all items, because the clipboard still
        // has data that will be re-captured on next refresh, so we remove
        // all except the currently selected item
        that.historySection._getMenuItems().forEach(function (mItem) {
            if (!mItem.currentlySelected) {
                let idx = that.clipItemsRadioGroup.indexOf(mItem);
                mItem.destroy();
                that.clipItemsRadioGroup.splice(idx,1);
            }
        });
        that._updateCache();
        that._showNotification(_("Clipboard history cleared"));
    },

    _removeEntry: function (menuItem) {
        let itemIdx = this.clipItemsRadioGroup.indexOf(menuItem);

        menuItem.destroy();
        this.clipItemsRadioGroup.splice(itemIdx,1);
        this._updateCache();
    },

    _removeOldestEntries: function () {
        let that = this;
        while (that.clipItemsRadioGroup.length > MAX_REGISTRY_LENGTH) {
            let oldest = that.clipItemsRadioGroup.shift();
            oldest.disconnect(oldest.buttonPressId);
            oldest.destroy();
        }

        that._updateCache();
    },

    _onMenuItemSelected: function (autoSet) {
        var that = this;
        that.radioGroup.forEach(function (menuItem) {
            let clipContents = that.clipContents;

            if (menuItem === that && clipContents) {
                that.setOrnament(PopupMenu.Ornament.DOT);
                that.icoBtn.visible = false;
                that.currentlySelected = true;
                if (autoSet !== false)
                    Clipboard.set_text(CLIPBOARD_TYPE, clipContents);
            }
            else {
                menuItem.icoBtn.visible = true;
                menuItem.setOrnament(PopupMenu.Ornament.NONE);
                menuItem.currentlySelected = false;
            }
        });

        that.menu.close();
    },

    _selectMenuItem: function (menuItem, autoSet) {
        let fn = Lang.bind(menuItem, this._onMenuItemSelected);
        fn(autoSet);
    },

    _getCache: function (cb) {
        return readRegistry(cb);
    },

    _updateCache: function () {
        writeRegistry(this.clipItemsRadioGroup.map(function (menuItem) {
            return menuItem.clipContents;
        }));
    },

    _refreshIndicator: function () {
        if (PRIVATEMODE) return; // Private mode, do not.

        let that = this;

        Clipboard.get_text(CLIPBOARD_TYPE, function (clipBoard, text) {
            let registry = that.clipItemsRadioGroup.map(function (menuItem) {
                return menuItem.clipContents;
            });

            if (text && registry.indexOf(text) < 0) {
                that._addEntry(text, true, false);
                that._removeOldestEntries();
                if(NOTIFY_ON_COPY)
                    that._showNotification(_("Copied to clipboard"));
            }
            else if (text && registry.indexOf(text) >= 0 &&
                    registry.indexOf(text) < registry.length - 1) {
                // If exists, but not already first, move it to be first
                that._moveItemFirst(text);
            }
        });
    },

    _moveItemFirst: function (text) {
        let item = this._findItem(text);
        this._removeEntry(item);
        this._addEntry(text, true, false);
    },

    _findItem: function (text) {
        return this.clipItemsRadioGroup.filter(
            item => item.clipContents === text)[0];
    },

    _setupTimeout: function (reiterate) {
        let that = this;
        reiterate = typeof reiterate === 'boolean' ? reiterate : true;

        this._clipboardTimeoutId = Mainloop.timeout_add(TIMEOUT_MS, function () {
            that._refreshIndicator();

            // If the timeout handler returns `false`, the source is
            // automatically removed, so we reset the timeout-id so it won't
            // be removed on `.destroy()`
            if (reiterate === false)
                that._clipboardTimeoutId = null;

            // As long as the timeout handler returns `true`, the handler
            // will be invoked again and again as an interval
            return reiterate;
        });
    },

    _openSettings: function () {
        Util.spawn([
            "gnome-shell-extension-prefs",
            Me.uuid
        ]);
    },

    _initNotifSource: function () {
        if (!this._notifSource) {
            this._notifSource = new MessageTray.Source('ClipboardIndicator',
                                    INDICATOR_ICON);
            this._notifSource.connect('destroy', Lang.bind(this, function() {
                this._notifSource = null;
            }));
            Main.messageTray.add(this._notifSource);
        }
    },

    _showNotification: function (message) {
        let notification = null;

        this._initNotifSource();

        if (this._notifSource.count === 0) {
            notification = new MessageTray.Notification(this._notifSource, message);
        }
        else {
            notification = this._notifSource.notifications[0];
            notification.update(message, '', { clear: true });
        }

        notification.setTransient(true);
        this._notifSource.notify(notification);      
    },

    _createHistoryLabel: function () {
        this._historyLabel = new St.Label({
            style_class: 'ci-notification-label',
            text: ''
        });

        global.stage.add_actor(this._historyLabel);

        this._historyLabel.hide();
    },

    _onPrivateModeSwitch: function() {
        PRIVATEMODE = this.privateModeMenuItem.state;
        // We hide the history in private mode because it will be out of sync (selected item will not reflect clipboard)
        this.scrollViewMenuSection.actor.visible = !PRIVATEMODE;

        // If we get out of private mode then we restore the clipboard to old state
        if (!PRIVATEMODE) {
            let selectList = this.clipItemsRadioGroup.filter((item) => !!item.currentlySelected);

            if (selectList.length) {
                this._selectMenuItem(selectList[0]);
            } else {
                // Nothing to return to, let's empty it instead
                Clipboard.set_text(CLIPBOARD_TYPE, "");
            }

            this.icon.remove_style_class_name('private-mode');
        } else {
            this.icon.add_style_class_name('private-mode');
        }
    },

    _loadSettings: function () {
        this._settings = Prefs.SettingsSchema;
        this._settingsChangedId = this._settings.connect('changed',
            Lang.bind(this, this._onSettingsChange));

        this._fetchSettings();

        if (ENABLE_KEYBINDING)
            this._bindShortcuts();
    },

    _fetchSettings: function () {
        TIMEOUT_MS           = this._settings.get_int(Prefs.Fields.INTERVAL);
        MAX_REGISTRY_LENGTH  = this._settings.get_int(Prefs.Fields.HISTORY_SIZE);
        MAX_ENTRY_LENGTH     = this._settings.get_int(Prefs.Fields.PREVIEW_SIZE);
        DELETE_ENABLED       = this._settings.get_boolean(Prefs.Fields.DELETE);
        ENABLE_KEYBINDING    = this._settings.get_boolean(Prefs.Fields.ENABLE_KEYBINDING);
        NOTIFY_ON_COPY       = this._settings.get_boolean(Prefs.Fields.NOTIFY_ON_COPY);
    },

    _onSettingsChange: function () {
        var that = this;

        // Load the settings into variables
        that._fetchSettings();

        // Remove old entries in case the registry size changed
        that._removeOldestEntries();

        // Re-set menu-items lables in case preview size changed
        that.historySection._getMenuItems().forEach(function (mItem) {
            that._setEntryLabel(mItem);
        });

        // Bind or unbind shortcuts
        if (ENABLE_KEYBINDING)
            that._bindShortcuts();
        else
            that._unbindShortcuts();
    },

    _bindShortcuts: function () {
        this._unbindShortcuts();
        this._bindShortcut(SETTING_KEY_CLEAR_HISTORY, this._removeAll);
        this._bindShortcut(SETTING_KEY_PREV_ENTRY, this._previousEntry);
        this._bindShortcut(SETTING_KEY_NEXT_ENTRY, this._nextEntry);
        this._bindShortcut(SETTING_KEY_TOGGLE_MENU, this._toggleMenu);
    },

    _unbindShortcuts: function () {
        this._shortcutsBindingIds.forEach(
            (id) => Main.wm.removeKeybinding(id)
        );

        this._shortcutsBindingIds = [];
    },

    _bindShortcut: function(name, cb) {
        var ModeType = Shell.hasOwnProperty('ActionMode') ?
            Shell.ActionMode : Shell.KeyBindingMode;

        Main.wm.addKeybinding(
            name,
            this._settings,
            Meta.KeyBindingFlags.NONE,
            ModeType.ALL,
            Lang.bind(this, cb)
        );

        this._shortcutsBindingIds.push(name);
    },

    _disconnectSettings: function () {
        if (!this._settingsChangedId)
            return;

        this._settings.disconnect(this._settingsChangedId);
        this._settingsChangedId = null;
    },

    _clearClipboardTimeout: function () {
        if (!this._clipboardTimeoutId)
            return;

        Mainloop.source_remove(this._clipboardTimeoutId);
        this._clipboardTimeoutId = null;
    },

    _clearLabelTimeout: function () {
        if (!this._historyLabelTimeoutId)
            return;

        Mainloop.source_remove(this._historyLabelTimeoutId);
        this._historyLabelTimeoutId = null;
    },

    _clearDelayedSelectionTimeout: function () {
        if (this._delayedSelectionTimeoutId) {
            Mainloop.source_remove(this._delayedSelectionTimeoutId);
        }
    },

    _selectEntryWithDelay: function (entry) {
        let that = this;

        that._selectMenuItem(entry, false);
        that._delayedSelectionTimeoutId = Mainloop.timeout_add(
                TIMEOUT_MS * 0.75, function () {

            that._selectMenuItem(entry);  //select the item

            that._delayedSelectionTimeoutId = null;
            return false;
        });
    },

    _previousEntry: function() {
        let that = this;

        that._clearDelayedSelectionTimeout();

        this.historySection._getMenuItems().some(function (mItem, i, menuItems){
            if (mItem.currentlySelected) {
                i--;                                 //get the previous index
                if (i < 0) i = menuItems.length - 1; //cycle if out of bound
                let index = i + 1;                   //index to be displayed
                that._showNotification(index + ' / ' + menuItems.length + ': ' + menuItems[i].label.text);
                that._selectEntryWithDelay(menuItems[i]);
                return true;
            }
            return false;
        });
    },

    _nextEntry: function() {
        let that = this;

        that._clearDelayedSelectionTimeout();

        this.historySection._getMenuItems().some(function (mItem, i, menuItems) {
            if (mItem.currentlySelected) {
                i++;                                 //get the next index
                if (i === menuItems.length) i = 0;   //cycle if out of bound
                let index = i + 1;                     //index to be displayed
                that._showNotification(index + ' / ' + menuItems.length + ': ' + menuItems[i].label.text);
                that._selectEntryWithDelay(menuItems[i]);
                return true;
            }
            return false;
        });
    },

    _toggleMenu: function(){
        this.menu.toggle();
    }
});


function init () {
    let localeDir = Me.dir.get_child('locale');
    Gettext.bindtextdomain('clipboard-indicator', localeDir.get_path());
}

let clipboardIndicator;
function enable () {
    clipboardIndicator = new ClipboardIndicator();
    Main.panel.addToStatusArea('clipboardIndicator', clipboardIndicator, 1);
}

function disable () {
    clipboardIndicator.destroy();
}
