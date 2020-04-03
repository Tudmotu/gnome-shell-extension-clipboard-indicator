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
let CACHE_ONLY_FAVORITE  = false;
let DELETE_ENABLED       = true;
let MOVE_ITEM_FIRST      = false;
let ENABLE_KEYBINDING    = true;
let PRIVATEMODE          = false;
let NOTIFY_ON_COPY       = true;
let MAX_TOPBAR_LENGTH    = 15;
let TOPBAR_DISPLAY_MODE  = 1; //0 - only icon, 1 - only clipbord content, 2 - both
let STRIP_TEXT           = false;

const ClipboardIndicator = Lang.Class({
    Name: 'ClipboardIndicator',
    Extends: PanelMenu.Button,

    _settingsChangedId: null,
    _clipboardTimeoutId: null,
    _selectionOwnerChangedId: null,
    _historyLabelTimeoutId: null,
    _historyLabel: null,
    _buttonText:null,

    destroy: function () {
        this._disconnectSettings();
        this._unbindShortcuts();
        this._clearClipboardTimeout();
        this._disconnectSelectionListener();
        this._clearLabelTimeout();
        this._clearDelayedSelectionTimeout();

        // Call parent
        this.parent();
    },

    _init: function() {
        this.parent(0.0, "ClipboardIndicator");
        this._shortcutsBindingIds = [];
        this.clipItemsRadioGroup = [];

        let hbox = new St.BoxLayout({ style_class: 'panel-status-menu-box clipboard-indicator-hbox' });
        this.icon = new St.Icon({ icon_name: INDICATOR_ICON,
            style_class: 'system-status-icon clipboard-indicator-icon' });
        hbox.add_child(this.icon);
        this._buttonText = new St.Label({
            text: _('Text will be here'),
            y_align: Clutter.ActorAlign.CENTER
        });
        hbox.add_child(this._buttonText);
        hbox.add(PopupMenu.arrowIcon(St.Side.BOTTOM));
        this.actor.add_child(hbox);

        this._createHistoryLabel();
        this._loadSettings();
        this._buildMenu();

        this._updateTopbarLayout();

        this._setupListener();
    },
    _updateButtonText: function(content){
        if (!content || PRIVATEMODE){
            this._buttonText.set_text("...")
        } else {
            this._buttonText.set_text(this._truncate(content, MAX_TOPBAR_LENGTH));
        }
    },

    _buildMenu: function () {
        let that = this;
        this._getCache(function (clipHistory) {
            let lastIdx = clipHistory.length - 1;
            let clipItemsArr = that.clipItemsRadioGroup;

            /* This create the search entry, which is add to a menuItem.
            The searchEntry is connected to the function for research.
            The menu itself is connected to some shitty hack in order to
            grab the focus of the keyboard. */
            that._entryItem = new PopupMenu.PopupBaseMenuItem({
                reactive: false,
                can_focus: false
            });
            that.searchEntry = new St.Entry({
                name: 'searchEntry',
                style_class: 'search-entry',
                can_focus: true,
                hint_text: _('Type here to search...'),
                track_hover: true
            });

            that.searchEntry.get_clutter_text().connect(
                'text-changed',
                Lang.bind(that, that._onSearchTextChanged)
            );

            that._entryItem.actor.add(that.searchEntry, { expand: true });

            that.menu.addMenuItem(that._entryItem);

            that.menu.connect('open-state-changed', Lang.bind(this, function(self, open){
                let a = Mainloop.timeout_add(50, Lang.bind(this, function() {
                    if (open) {
                        that.searchEntry.set_text('');
                        global.stage.set_key_focus(that.searchEntry);
                    }
                    Mainloop.source_remove(a);
                }));
            }));

            // Create menu sections for items
            // Favorites
            that.favoritesSection = new PopupMenu.PopupMenuSection();

            that.scrollViewFavoritesMenuSection = new PopupMenu.PopupMenuSection();
            let favoritesScrollView = new St.ScrollView({
                style_class: 'ci-history-menu-section',
                overlay_scrollbars: true
            });
            favoritesScrollView.add_actor(that.favoritesSection.actor);

            that.scrollViewFavoritesMenuSection.actor.add_actor(favoritesScrollView);
            that.menu.addMenuItem(that.scrollViewFavoritesMenuSection);
            that.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

            // History
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
                if (typeof buffer === 'string') {
                    // Old cache format
                    that._addEntry(buffer);
                } else {
                    that._addEntry(buffer["contents"], buffer["favorite"]);
                }
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

    /* When text change, this function will check, for each item of the
    historySection and favoritesSestion, if it should be visible or not (based on words contained
    in the clipContents attribute of the item). It doesn't destroy or create
    items. It the entry is empty, the section is restored with all items
    set as visible. */
    _onSearchTextChanged: function() {
        let searchedText = this.searchEntry.get_text().toLowerCase();

        if(searchedText === '') {
            this._getAllIMenuItems().forEach(function(mItem){
                mItem.actor.visible = true;
            });
        }
        else {
            this._getAllIMenuItems().forEach(function(mItem){
                let text = mItem.clipContents.toLowerCase();
                let isMatching = text.indexOf(searchedText) >= 0;
                mItem.actor.visible = isMatching
            });
        }
    },

    _truncate: function(string, length) {
        let shortened = string.replace(/\s+/g, ' ');

        if (shortened.length > length)
            shortened = shortened.substring(0,length-1) + '...';

        return shortened;
    },

    _setEntryLabel: function (menuItem) {
        let buffer = menuItem.clipContents;
        menuItem.label.set_text(this._truncate(buffer, MAX_ENTRY_LENGTH));
    },

    _addEntry: function (buffer, favorite, autoSelect, autoSetClip) {
        let menuItem = new PopupMenu.PopupMenuItem('');

        menuItem.menu = this.menu;
        menuItem.clipContents = buffer;
        menuItem.clipFavorite = favorite;
        menuItem.radioGroup = this.clipItemsRadioGroup;
        menuItem.buttonPressId = menuItem.connect('activate',
            Lang.bind(menuItem, this._onMenuItemSelectedAndMenuClose));

        this._setEntryLabel(menuItem);
        this.clipItemsRadioGroup.push(menuItem);

	// Favorite button
        let icon_name = favorite ? 'starred-symbolic' : 'non-starred-symbolic';
        let iconfav = new St.Icon({
            icon_name: icon_name,
            style_class: 'system-status-icon'
        });

        let icofavBtn = new St.Button({
            style_class: 'ci-action-btn',
            x_fill: true,
            can_focus: true,
            child: iconfav
        });

        icofavBtn.set_x_align(Clutter.ActorAlign.END);
        icofavBtn.set_x_expand(true);
        icofavBtn.set_y_expand(true);

        menuItem.actor.add_child(icofavBtn);
        menuItem.icofavBtn = icofavBtn;
        menuItem.favoritePressId = icofavBtn.connect('button-press-event',
            Lang.bind(this, function () {
                this._favoriteToggle(menuItem);
            })
        );

	// Delete button
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
        icoBtn.set_x_expand(false);
        icoBtn.set_y_expand(true);

        menuItem.actor.add_child(icoBtn);
        menuItem.icoBtn = icoBtn;
        menuItem.deletePressId = icoBtn.connect('button-press-event',
            Lang.bind(this, function () {
                this._removeEntry(menuItem, 'delete');
            })
        );

        if (favorite) {
            this.favoritesSection.addMenuItem(menuItem, 0);
        } else {
            this.historySection.addMenuItem(menuItem, 0);
        }

        if (autoSelect === true)
            this._selectMenuItem(menuItem, autoSetClip);

        if (TOPBAR_DISPLAY_MODE === 1 || TOPBAR_DISPLAY_MODE === 2) {
            this._updateButtonText(buffer);
        }

        this._updateCache();
    },

    _favoriteToggle: function (menuItem) {
        menuItem.clipFavorite = menuItem.clipFavorite ? false : true;
        this._moveItemFirst(menuItem);

        this._updateCache();
    },

    _removeAll: function () {
        let that = this;
        // We can't actually remove all items, because the clipboard still
        // has data that will be re-captured on next refresh, so we remove
        // all except the currently selected item
        // Don't remove favorites here
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

    _removeEntry: function (menuItem, event) {
        let itemIdx = this.clipItemsRadioGroup.indexOf(menuItem);

        if(event === 'delete' && menuItem.currentlySelected) {
            Clipboard.set_text(CLIPBOARD_TYPE, "");
        }

        menuItem.destroy();
        this.clipItemsRadioGroup.splice(itemIdx,1);

        this._updateCache();
    },

    _removeOldestEntries: function () {
        let that = this;

        let clipItemsRadioGroupNoFavorite = that.clipItemsRadioGroup.filter(
            item => item.clipFavorite === false);

        while (clipItemsRadioGroupNoFavorite.length > MAX_REGISTRY_LENGTH) {
            let oldestNoFavorite = clipItemsRadioGroupNoFavorite.shift();
            that._removeEntry(oldestNoFavorite);

            clipItemsRadioGroupNoFavorite = that.clipItemsRadioGroup.filter(
                item => item.clipFavorite === false);
        }

        that._updateCache();
    },

    _onMenuItemSelected: function (autoSet) {
        var that = this;
        that.radioGroup.forEach(function (menuItem) {
            let clipContents = that.clipContents;

            if (menuItem === that && clipContents) {
                that.setOrnament(PopupMenu.Ornament.DOT);
                that.currentlySelected = true;
                if (autoSet !== false)
                    Clipboard.set_text(CLIPBOARD_TYPE, clipContents);
            }
            else {
                menuItem.setOrnament(PopupMenu.Ornament.NONE);
                menuItem.currentlySelected = false;
            }
        });
    },

    _selectMenuItem: function (menuItem, autoSet) {
        let fn = Lang.bind(menuItem, this._onMenuItemSelected);
        fn(autoSet);
    },

    _onMenuItemSelectedAndMenuClose: function (autoSet) {
        var that = this;
        that.radioGroup.forEach(function (menuItem) {
            let clipContents = that.clipContents;

            if (menuItem === that && clipContents) {
                that.setOrnament(PopupMenu.Ornament.DOT);
                that.currentlySelected = true;
                if (autoSet !== false)
                    Clipboard.set_text(CLIPBOARD_TYPE, clipContents);
            }
            else {
                menuItem.setOrnament(PopupMenu.Ornament.NONE);
                menuItem.currentlySelected = false;
            }
        });

        that.menu.close();
    },

    _getCache: function (cb) {
        return readRegistry(cb);
    },

    _updateCache: function () {
        let registry = this.clipItemsRadioGroup.map(function (menuItem) {
            return {
                      "contents" : menuItem.clipContents,
                      "favorite" : menuItem.clipFavorite
                   };
        });

        writeRegistry(registry.filter(function (menuItem) {
            if (CACHE_ONLY_FAVORITE) {
                if (menuItem["favorite"]) {
                    return menuItem;
                }
            } else {
                return menuItem;
            }
        }));
    },

    _onSelectionChange (selection, selectionType, selectionSource) {
        if (selectionType === Meta.SelectionType.SELECTION_CLIPBOARD) {
            this._refreshIndicator();
        }
    },

    _refreshIndicator: function () {
        if (PRIVATEMODE) return; // Private mode, do not.

        let that = this;

        Clipboard.get_text(CLIPBOARD_TYPE, function (clipBoard, text) {
            that._processClipboardContent(text);
        });
    },

    _processClipboardContent (text) {
        const that = this;

        if (STRIP_TEXT) {
            text = text.trim();
        }

        if (text !== "" && text) {
            let registry = that.clipItemsRadioGroup.map(function (menuItem) {
                return menuItem.clipContents;
            });

            const itemIndex = registry.indexOf(text);

            if (itemIndex < 0) {
                that._addEntry(text, false, true, false);
                that._removeOldestEntries();
                if (NOTIFY_ON_COPY) {
                    that._showNotification(_("Copied to clipboard"), notif => {
                        notif.addAction(_('Cancel'), Lang.bind(that, that._cancelNotification));
                    });
                }
            }
            else if (itemIndex >= 0 && itemIndex < registry.length - 1) {
                const item = that._findItem(text);
                that._selectMenuItem(item, false);

                if (!item.clipFavorite && MOVE_ITEM_FIRST) {
                    that._moveItemFirst(item);
                }
            }
        }
    },

    _moveItemFirst: function (item) {
        this._removeEntry(item);
        this._addEntry(item.clipContents, item.clipFavorite, item.currentlySelected, false);
    },

    _findItem: function (text) {
        return this.clipItemsRadioGroup.filter(
            item => item.clipContents === text)[0];
    },

    _getCurrentlySelectedItem () {
        return this.clipItemsRadioGroup.find(item => item.currentlySelected);
    },

    _getAllIMenuItems: function (text) {
        return this.historySection._getMenuItems().concat(this.favoritesSection._getMenuItems());
    },

    _setupListener () {
        const metaDisplay = Shell.Global.get().get_display();

        if (typeof metaDisplay.get_selection === 'function') {
            const selection = metaDisplay.get_selection();
            this._setupSelectionTracking(selection);
        }
        else {
            this._setupTimeout();
        }
    },

    _setupSelectionTracking (selection) {
        this.selection = selection;
        this._selectionOwnerChangedId = selection.connect('owner-changed', (selection, selectionType, selectionSource) => {
            this._onSelectionChange(selection, selectionType, selectionSource);
        });
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
        if (typeof ExtensionUtils.openPrefs === 'function') {
            ExtensionUtils.openPrefs();
        } else {
            Util.spawn([
                "gnome-shell-extension-prefs",
                Me.uuid
            ]);
        }
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

    _cancelNotification: function() {
        if (this.clipItemsRadioGroup.length >= 2) {
            let clipSecond = this.clipItemsRadioGroup.length - 2;
            let previousClip = this.clipItemsRadioGroup[clipSecond];
            Clipboard.set_text(CLIPBOARD_TYPE, previousClip.clipContents);
            previousClip.setOrnament(PopupMenu.Ornament.DOT);
            previousClip.icoBtn.visible = false;
            previousClip.currentlySelected = true;
        } else {
            Clipboard.set_text(CLIPBOARD_TYPE, "");
        }
        let clipFirst = this.clipItemsRadioGroup.length - 1;
        this._removeEntry(this.clipItemsRadioGroup[clipFirst]);
    },

    _showNotification: function (message, transformFn) {
        let notification = null;

        this._initNotifSource();

        if (this._notifSource.count === 0) {
            notification = new MessageTray.Notification(this._notifSource, message);
        }
        else {
            notification = this._notifSource.notifications[0];
            notification.update(message, '', { clear: true });
        }

        if (typeof transformFn === 'function') {
            transformFn(notification);
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
        let that = this;
        PRIVATEMODE = this.privateModeMenuItem.state;
        // We hide the history in private ModeTypee because it will be out of sync (selected item will not reflect clipboard)
        this.scrollViewMenuSection.actor.visible = !PRIVATEMODE;
        this.scrollViewFavoritesMenuSection.actor.visible = !PRIVATEMODE;
        // If we get out of private mode then we restore the clipboard to old state
        if (!PRIVATEMODE) {
            let selectList = this.clipItemsRadioGroup.filter((item) => !!item.currentlySelected);
            Clipboard.get_text(CLIPBOARD_TYPE, function (clipBoard, text) {
                            that._updateButtonText(text);
                        });
            if (selectList.length) {
                this._selectMenuItem(selectList[0]);
            } else {
                // Nothing to return to, let's empty it instead
                Clipboard.set_text(CLIPBOARD_TYPE, "");
            }

            this.icon.remove_style_class_name('private-mode');
        } else {
            this._buttonText.set_text('...');
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
        CACHE_ONLY_FAVORITE  = this._settings.get_boolean(Prefs.Fields.CACHE_ONLY_FAVORITE);
        DELETE_ENABLED       = this._settings.get_boolean(Prefs.Fields.DELETE);
        MOVE_ITEM_FIRST      = this._settings.get_boolean(Prefs.Fields.MOVE_ITEM_FIRST);
        NOTIFY_ON_COPY       = this._settings.get_boolean(Prefs.Fields.NOTIFY_ON_COPY);
        ENABLE_KEYBINDING    = this._settings.get_boolean(Prefs.Fields.ENABLE_KEYBINDING);
        MAX_TOPBAR_LENGTH    = this._settings.get_int(Prefs.Fields.TOPBAR_PREVIEW_SIZE);
        TOPBAR_DISPLAY_MODE  = this._settings.get_int(Prefs.Fields.TOPBAR_DISPLAY_MODE_ID);
        STRIP_TEXT           = this._settings.get_boolean(Prefs.Fields.STRIP_TEXT);
    },

    _onSettingsChange: function () {
        var that = this;

        // Load the settings into variables
        that._fetchSettings();

        // Remove old entries in case the registry size changed
        that._removeOldestEntries();

        // Re-set menu-items lables in case preview size changed
        this._getAllIMenuItems().forEach(function (mItem) {
            that._setEntryLabel(mItem);
        });

        //update topbar
        this._updateTopbarLayout();
        if(TOPBAR_DISPLAY_MODE === 1 || TOPBAR_DISPLAY_MODE === 2) {
            Clipboard.get_text(CLIPBOARD_TYPE, function (clipBoard, text) {
                that._updateButtonText(text);
            });
        }

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

    _updateTopbarLayout: function(){
        if(TOPBAR_DISPLAY_MODE === 0){
            this.icon.visible = true;
            this._buttonText.visible = false;
        }
        if(TOPBAR_DISPLAY_MODE === 1){
            this.icon.visible = false;
            this._buttonText.visible = true;
        }
        if(TOPBAR_DISPLAY_MODE === 2){
            this.icon.visible = true;
            this._buttonText.visible = true;
        }
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

    _disconnectSelectionListener () {
        if (!this._selectionOwnerChangedId)
            return;

        this.selection.disconnect(this._selectionOwnerChangedId);
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

        this._getAllIMenuItems().some(function (mItem, i, menuItems){
            if (mItem.currentlySelected) {
                i--;                                 //get the previous index
                if (i < 0) i = menuItems.length - 1; //cycle if out of bound
                let index = i + 1;                   //index to be displayed
                that._showNotification(index + ' / ' + menuItems.length + ': ' + menuItems[i].label.text);
                if (MOVE_ITEM_FIRST) {
                    that._selectEntryWithDelay(menuItems[i]);
                }
                else {
                    that._selectMenuItem(menuItems[i]);
                }
                return true;
            }
            return false;
        });
    },

    _nextEntry: function() {
        let that = this;

        that._clearDelayedSelectionTimeout();

        this._getAllIMenuItems().some(function (mItem, i, menuItems){
            if (mItem.currentlySelected) {
                i++;                                 //get the next index
                if (i === menuItems.length) i = 0;   //cycle if out of bound
                let index = i + 1;                     //index to be displayed
                that._showNotification(index + ' / ' + menuItems.length + ': ' + menuItems[i].label.text);
                if (MOVE_ITEM_FIRST) {
                    that._selectEntryWithDelay(menuItems[i]);
                }
                else {
                    that._selectMenuItem(menuItems[i]);
                }
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
