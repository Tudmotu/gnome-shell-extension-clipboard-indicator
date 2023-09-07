import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import St from 'gi://St';

import * as MessageTray from 'resource:///org/gnome/shell/ui/messageTray.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import { Extension, gettext as _ } from 'resource:///org/gnome/shell/extensions/extension.js';

import { Registry, ClipboardEntry } from './registry.js';
import { openConfirmDialog } from './confirmDialog.js';
import { PrefsFields } from './constants.js';

const Clipboard = St.Clipboard.get_default();
const CLIPBOARD_TYPE = St.ClipboardType.CLIPBOARD;

const SETTING_KEY_CLEAR_HISTORY = "clear-history";
const SETTING_KEY_PREV_ENTRY = "prev-entry";
const SETTING_KEY_NEXT_ENTRY = "next-entry";
const SETTING_KEY_TOGGLE_MENU = "toggle-menu";
const INDICATOR_ICON = 'edit-paste-symbolic';

let TIMEOUT_MS           = 1000;
let MAX_REGISTRY_LENGTH  = 15;
let MAX_ENTRY_LENGTH     = 50;
let CACHE_ONLY_FAVORITE  = false;
let DELETE_ENABLED       = true;
let MOVE_ITEM_FIRST      = false;
let ENABLE_KEYBINDING    = true;
let PRIVATEMODE          = false;
let NOTIFY_ON_COPY       = true;
let CONFIRM_ON_CLEAR     = true;
let MAX_TOPBAR_LENGTH    = 15;
let TOPBAR_DISPLAY_MODE  = 1; //0 - only icon, 1 - only clipboard content, 2 - both
let DISABLE_DOWN_ARROW   = false;
let STRIP_TEXT           = false;

export default class ClipboardIndicatorExtension extends Extension {
    enable () {
        this.clipboardIndicator = new ClipboardIndicator({
            settings: this.getSettings(),
            openSettings: this.openPreferences,
            uuid: this.uuid
        });

        Main.panel.addToStatusArea('clipboardIndicator', this.clipboardIndicator, 1);
    }

    disable () {
        this.clipboardIndicator.destroy();
        this.clipboardIndicator = null;
    }
}

const ClipboardIndicator = GObject.registerClass({
    GTypeName: 'ClipboardIndicator'
}, class ClipboardIndicator extends PanelMenu.Button {
    constructor (extension) {
        super();
        this.extension = extension;
        this.registry = new Registry(extension);
        this._loadSettings();
        this._buildMenu();
        this._updateTopbarLayout();
        this._setupListener();
    }

    destroy () {
        this._disconnectSettings();
        this._unbindShortcuts();
        this._clearClipboardTimeout();
        this._disconnectSelectionListener();
        this._clearLabelTimeout();
        this._clearDelayedSelectionTimeout();

        super.destroy();
    }

    _init () {
        super._init(0.0, "ClipboardIndicator");
        this._settingsChangedId = null;
        this._clipboardTimeoutId = null;
        this._selectionOwnerChangedId = null;
        this._historyLabelTimeoutId = null;
        this._historyLabel = null;
        this._buttonText = null;
        this._disableDownArrow = null;

        this._shortcutsBindingIds = [];
        this.clipItemsRadioGroup = [];

        let hbox = new St.BoxLayout({
            style_class: 'panel-status-menu-box clipboard-indicator-hbox'
        });
        this.icon = new St.Icon({
            icon_name: INDICATOR_ICON,
            style_class: 'system-status-icon clipboard-indicator-icon'
        });

        this._buttonText = new St.Label({
            text: _('Text will be here'),
            y_align: Clutter.ActorAlign.CENTER
        });

        hbox.add_child(this.icon);
        hbox.add_child(this._buttonText);
        this._downArrow = PopupMenu.arrowIcon(St.Side.BOTTOM);
        hbox.add(this._downArrow);
        this.add_child(hbox);
        this._createHistoryLabel();
    }

    #updateIndicatorContent(entry) {
        log(`Updating indicator content: ${entry.toString()}`);
        if (!entry || PRIVATEMODE){
            this._buttonText.set_text("...")
        } else {
            this._buttonText.set_text(this._truncate(entry.toString(), MAX_TOPBAR_LENGTH));
        }
    }

    _buildMenu () {
        let that = this;
        this._getCache(clipHistory => {
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
                track_hover: true,
                x_expand: true,
                y_expand: true
            });

            that.searchEntry.get_clutter_text().connect(
                'text-changed',
                that._onSearchTextChanged.bind(that)
            );

            that._entryItem.add(that.searchEntry);

            that.menu.addMenuItem(that._entryItem);

            that.menu.connect('open-state-changed', (self, open) => {
                let a = setInterval(() => {
                    if (open) {
                        that.searchEntry.set_text('');
                        global.stage.set_key_focus(that.searchEntry);
                    }
                    clearInterval(a);
                }, 50);
            });

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
            clipHistory.forEach(entry => this._addEntry(entry));

            // Add separator
            that.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

            // Private mode switch
            that.privateModeMenuItem = new PopupMenu.PopupSwitchMenuItem(
                _("Private mode"), PRIVATEMODE, { reactive: true });
            that.privateModeMenuItem.connect('toggled',
                that._onPrivateModeSwitch.bind(that));
            that.menu.addMenuItem(that.privateModeMenuItem);
            that._onPrivateModeSwitch();

            // Add 'Clear' button which removes all items from cache
            let clearMenuItem = new PopupMenu.PopupMenuItem(_('Clear history'));
            that.menu.addMenuItem(clearMenuItem);
            clearMenuItem.connect('activate', that._removeAll.bind(that));

            // Add 'Settings' menu item to open settings
            let settingsMenuItem = new PopupMenu.PopupMenuItem(_('Settings'));
            that.menu.addMenuItem(settingsMenuItem);
            settingsMenuItem.connect('activate', that._openSettings.bind(that));

            if (lastIdx >= 0) {
                that._selectMenuItem(clipItemsArr[lastIdx]);
            }
        });
    }

    /* When text change, this function will check, for each item of the
    historySection and favoritesSestion, if it should be visible or not (based on words contained
    in the clipContents attribute of the item). It doesn't destroy or create
    items. It the entry is empty, the section is restored with all items
    set as visible. */
    _onSearchTextChanged () {
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
    }

    _truncate (string, length) {
        let shortened = string.replace(/\s+/g, ' ');

        if (shortened.length > length)
            shortened = shortened.substring(0,length-1) + '...';

        return shortened;
    }

    _setEntryLabel (menuItem) {
        let buffer = menuItem.clipContents;
        menuItem.label.set_text(this._truncate(buffer, MAX_ENTRY_LENGTH));
    }

    _addEntry (entry, autoSelect, autoSetClip) {
        let menuItem = new PopupMenu.PopupMenuItem('');

        menuItem.menu = this.menu;
        menuItem.entry = entry;
        menuItem.clipContents = entry.toString();
        menuItem.clipFavorite = entry.isFavorite();
        menuItem.radioGroup = this.clipItemsRadioGroup;
        menuItem.buttonPressId = menuItem.connect('activate',
            autoSet => this._onMenuItemSelectedAndMenuClose(menuItem, autoSet));

        this._setEntryLabel(menuItem);
        this.clipItemsRadioGroup.push(menuItem);

        // Favorite button
        let icon_name = entry.isFavorite() ? 'starred-symbolic' : 'non-starred-symbolic';
        let iconfav = new St.Icon({
            icon_name: icon_name,
            style_class: 'system-status-icon'
        });

        let icofavBtn = new St.Button({
            style_class: 'ci-action-btn',
            can_focus: true,
            child: iconfav,
            x_align: Clutter.ActorAlign.END,
            x_expand: true,
            y_expand: true
        });

        menuItem.actor.add_child(icofavBtn);
        menuItem.icofavBtn = icofavBtn;
        menuItem.favoritePressId = icofavBtn.connect('clicked',
            () => this._favoriteToggle(menuItem)
        );

        // Delete button
        let icon = new St.Icon({
            icon_name: 'edit-delete-symbolic', //'mail-attachment-symbolic',
            style_class: 'system-status-icon'
        });

        let icoBtn = new St.Button({
            style_class: 'ci-action-btn',
            can_focus: true,
            child: icon,
            x_align: Clutter.ActorAlign.END,
            x_expand: false,
            y_expand: true
        });

        menuItem.actor.add_child(icoBtn);
        menuItem.icoBtn = icoBtn;
        menuItem.deletePressId = icoBtn.connect('clicked',
            () => this._removeEntry(menuItem, 'delete')
        );

        if (entry.isFavorite()) {
            this.favoritesSection.addMenuItem(menuItem, 0);
        } else {
            this.historySection.addMenuItem(menuItem, 0);
        }

        if (autoSelect === true)
            this._selectMenuItem(menuItem, autoSetClip);

        if (TOPBAR_DISPLAY_MODE === 1 || TOPBAR_DISPLAY_MODE === 2) {
            this.#updateIndicatorContent(entry);
        }

        this._updateCache();
    }

    _favoriteToggle (menuItem) {
        menuItem.clipFavorite = menuItem.clipFavorite ? false : true;
        this._moveItemFirst(menuItem);

        this._updateCache();
    }

    _confirmRemoveAll () {
        const title = _("Clear all?");
        const message = _("Are you sure you want to delete all clipboard items?");
        const sub_message = _("This operation cannot be undone.");

        openConfirmDialog(title, message, sub_message, _("Clear"), _("Cancel"), () => {
            let that = this;
            that._clearHistory();
        }
      );
    }

    _clearHistory () {
        let that = this;
        // We can't actually remove all items, because the clipboard still
        // has data that will be re-captured on next refresh, so we remove
        // all except the currently selected item
        // Don't remove favorites here
        that.historySection._getMenuItems().forEach(function (mItem) {
            if (!mItem.currentlySelected) {
                let idx = that.clipItemsRadioGroup.indexOf(mItem);
                mItem.destroy();
                that.clipItemsRadioGroup.splice(idx, 1);
            }
        });
        that._updateCache();
        that._showNotification(_("Clipboard history cleared"));
    }

    _removeAll () {
        var that = this;

        if (CONFIRM_ON_CLEAR) {
            that._confirmRemoveAll();
        } else {
            that._clearHistory();
        }
    }

    _removeEntry (menuItem, event) {
        let itemIdx = this.clipItemsRadioGroup.indexOf(menuItem);

        if(event === 'delete' && menuItem.currentlySelected) {
            this.#clearClipboard();
        }

        menuItem.destroy();
        this.clipItemsRadioGroup.splice(itemIdx,1);

        this._updateCache();
    }

    _removeOldestEntries () {
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
    }

    _onMenuItemSelected (menuItem, autoSet) {
        for (let otherMenuItem of menuItem.radioGroup) {
            let clipContents = menuItem.clipContents;

            if (otherMenuItem === menuItem && clipContents) {
                menuItem.setOrnament(PopupMenu.Ornament.DOT);
                menuItem.currentlySelected = true;
                if (autoSet !== false)
                    menuItem.#updateClipboard(menuItem.entry);
            }
            else {
                otherMenuItem.setOrnament(PopupMenu.Ornament.NONE);
                otherMenuItem.currentlySelected = false;
            }
        }
    }

    _selectMenuItem (menuItem, autoSet) {
        this._onMenuItemSelected(menuItem, autoSet);
        if(TOPBAR_DISPLAY_MODE === 1 || TOPBAR_DISPLAY_MODE === 2) {
            this.#updateIndicatorContent(menuItem.entry);
        }
    }

    _onMenuItemSelectedAndMenuClose (menuItem, autoSet) {
        for (let otherMenuItem of menuItem.radioGroup) {
            let clipContents = menuItem.clipContents;

            if (menuItem === otherMenuItem && clipContents) {
                menuItem.setOrnament(PopupMenu.Ornament.DOT);
                menuItem.currentlySelected = true;
                if (autoSet !== false)
                    this.#updateClipboard(menuItem.entry);
            }
            else {
                otherMenuItem.setOrnament(PopupMenu.Ornament.NONE);
                otherMenuItem.currentlySelected = false;
            }
        }

        menuItem.menu.close();
    }

    _getCache (cb) {
        return this.registry.read(cb);
    }

    _updateCache () {
        let json = this.clipItemsRadioGroup
            .map(menuItem => menuItem.entry)
            .filter(entry => CACHE_ONLY_FAVORITE == false || entry.isFavorite());

        this.registry.write(json);
    }

    _onSelectionChange (selection, selectionType, selectionSource) {
        if (selectionType === Meta.SelectionType.SELECTION_CLIPBOARD) {
            this._refreshIndicator();
        }
    }

    _refreshIndicator () {
        if (PRIVATEMODE) return; // Private mode, do not.

        let that = this;

        Clipboard.get_text(CLIPBOARD_TYPE, (clipBoard, text) => {
            if (text !== null) {
                log(`Clipboard Indicator: ${text}`);
                that._processClipboardContent(text);
            }
            else {
                const mimetypes = [
                    'image/png', 'image/jpg', 'image/gif', 'image/svg+xml', 'image/webp'
                ];

                for (let type of mimetypes) {
                    let result;

                    Clipboard.get_content(CLIPBOARD_TYPE, type, (clipBoard, bytes) => {
                        if (result || bytes === null) {
                            return;
                        }

                        log(`Clipboard Indicator: ${type}`);
                        log(`Object: ${bytes.constructor.name}`);
                        log(`Data: ${bytes.get_data().constructor.name}`);
                        log('Size: ', bytes.get_data().length);

                        result = new ClipboardEntry(type, bytes.get_data(), false);

                        for (let menuItem of this.clipItemsRadioGroup) {
                            if (menuItem.entry.equals(result)) return;
                        }

                        this._addEntry(result);
                    });
                }
            }
        });
    }

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
                const entry = new ClipboardEntry(
                    'text/plain', new TextEncoder().encode(text), false
                );
                that._addEntry(entry, true, false);
                that._removeOldestEntries();
                if (NOTIFY_ON_COPY) {
                    that._showNotification(_("Copied to clipboard"), notif => {
                        notif.addAction(_('Cancel'), that._cancelNotification.bind(that));
                    });
                }
            }
            else if (itemIndex >= 0 && itemIndex < registry.length) {
                const item = that._findItem(text);
                that._selectMenuItem(item, false);

                if (!item.clipFavorite && MOVE_ITEM_FIRST) {
                    that._moveItemFirst(item);
                }
            }
        }
    }

    _moveItemFirst (item) {
        this._removeEntry(item);
        this._addEntry(item.entry, item.currentlySelected, false);
    }

    _findItem (text) {
        return this.clipItemsRadioGroup.filter(
            item => item.clipContents === text)[0];
    }

    _getCurrentlySelectedItem () {
        return this.clipItemsRadioGroup.find(item => item.currentlySelected);
    }

    _getAllIMenuItems () {
        return this.historySection._getMenuItems().concat(this.favoritesSection._getMenuItems());
    }

    _setupListener () {
        const metaDisplay = Shell.Global.get().get_display();

        if (typeof metaDisplay.get_selection === 'function') {
            const selection = metaDisplay.get_selection();
            this._setupSelectionTracking(selection);
        }
        else {
            this._setupTimeout();
        }
    }

    _setupSelectionTracking (selection) {
        this.selection = selection;
        this._selectionOwnerChangedId = selection.connect('owner-changed', (selection, selectionType, selectionSource) => {
            this._onSelectionChange(selection, selectionType, selectionSource);
        });
    }

    _setupTimeout () {
        let that = this;

        this._clipboardTimeoutId = setInterval(function () {
            that._refreshIndicator();
        }, TIMEOUT_MS);
    }

    _openSettings () {
        this.extension.openSettings();
    }

    _initNotifSource () {
        if (!this._notifSource) {
            this._notifSource = new MessageTray.Source('ClipboardIndicator',
                                    INDICATOR_ICON);
            this._notifSource.connect('destroy', () => {
                this._notifSource = null;
            });
            Main.messageTray.add(this._notifSource);
        }
    }

    _cancelNotification () {
        if (this.clipItemsRadioGroup.length >= 2) {
            let clipSecond = this.clipItemsRadioGroup.length - 2;
            let previousClip = this.clipItemsRadioGroup[clipSecond];
            this.#updateClipboard(previousClip.entry);
            previousClip.setOrnament(PopupMenu.Ornament.DOT);
            previousClip.icoBtn.visible = false;
            previousClip.currentlySelected = true;
        } else {
            this.#clearClipboard();
        }
        let clipFirst = this.clipItemsRadioGroup.length - 1;
        this._removeEntry(this.clipItemsRadioGroup[clipFirst]);
    }

    _showNotification (message, transformFn) {
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
        this._notifSource.showNotification(notification);
    }

    _createHistoryLabel () {
        this._historyLabel = new St.Label({
            style_class: 'ci-notification-label',
            text: ''
        });

        global.stage.add_actor(this._historyLabel);

        this._historyLabel.hide();
    }

    _onPrivateModeSwitch () {
        let that = this;
        PRIVATEMODE = this.privateModeMenuItem.state;
        // We hide the history in private ModeTypee because it will be out of sync (selected item will not reflect clipboard)
        this.scrollViewMenuSection.actor.visible = !PRIVATEMODE;
        this.scrollViewFavoritesMenuSection.actor.visible = !PRIVATEMODE;
        // If we get out of private mode then we restore the clipboard to old state
        if (!PRIVATEMODE) {
            let selectList = this.clipItemsRadioGroup.filter((item) => !!item.currentlySelected);

            this.#getClipboardContent().then(entry => {
                this.#updateIndicatorContent(entry);
            });

            if (selectList.length) {
                this._selectMenuItem(selectList[0]);
            } else {
                // Nothing to return to, let's empty it instead
                this.#clearClipboard();
            }

            this.icon.remove_style_class_name('private-mode');
        } else {
            this._buttonText.set_text('...');
            this.icon.add_style_class_name('private-mode');
        }
    }

    _loadSettings () {
        this._settingsChangedId = this.extension.settings.connect('changed',
            this._onSettingsChange.bind(this));

        this._fetchSettings();

        if (ENABLE_KEYBINDING)
            this._bindShortcuts();
    }

    _fetchSettings () {
        const { settings } = this.extension;
        TIMEOUT_MS           = settings.get_int(PrefsFields.INTERVAL);
        MAX_REGISTRY_LENGTH  = settings.get_int(PrefsFields.HISTORY_SIZE);
        MAX_ENTRY_LENGTH     = settings.get_int(PrefsFields.PREVIEW_SIZE);
        CACHE_ONLY_FAVORITE  = settings.get_boolean(PrefsFields.CACHE_ONLY_FAVORITE);
        DELETE_ENABLED       = settings.get_boolean(PrefsFields.DELETE);
        MOVE_ITEM_FIRST      = settings.get_boolean(PrefsFields.MOVE_ITEM_FIRST);
        NOTIFY_ON_COPY       = settings.get_boolean(PrefsFields.NOTIFY_ON_COPY);
        CONFIRM_ON_CLEAR     = settings.get_boolean(PrefsFields.CONFIRM_ON_CLEAR);
        ENABLE_KEYBINDING    = settings.get_boolean(PrefsFields.ENABLE_KEYBINDING);
        MAX_TOPBAR_LENGTH    = settings.get_int(PrefsFields.TOPBAR_PREVIEW_SIZE);
        TOPBAR_DISPLAY_MODE  = settings.get_int(PrefsFields.TOPBAR_DISPLAY_MODE_ID);
        DISABLE_DOWN_ARROW   = settings.get_boolean(PrefsFields.DISABLE_DOWN_ARROW);
        STRIP_TEXT           = settings.get_boolean(PrefsFields.STRIP_TEXT);
    }

    async _onSettingsChange () {
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
            that.#updateIndicatorContent(await this.#getClipboardContent());
        }

        // Bind or unbind shortcuts
        if (ENABLE_KEYBINDING)
            that._bindShortcuts();
        else
            that._unbindShortcuts();
    }

    _bindShortcuts () {
        this._unbindShortcuts();
        this._bindShortcut(SETTING_KEY_CLEAR_HISTORY, this._removeAll);
        this._bindShortcut(SETTING_KEY_PREV_ENTRY, this._previousEntry);
        this._bindShortcut(SETTING_KEY_NEXT_ENTRY, this._nextEntry);
        this._bindShortcut(SETTING_KEY_TOGGLE_MENU, this._toggleMenu);
    }

    _unbindShortcuts () {
        this._shortcutsBindingIds.forEach(
            (id) => Main.wm.removeKeybinding(id)
        );

        this._shortcutsBindingIds = [];
    }

    _bindShortcut (name, cb) {
        var ModeType = Shell.hasOwnProperty('ActionMode') ?
            Shell.ActionMode : Shell.KeyBindingMode;

        Main.wm.addKeybinding(
            name,
            this.extension.settings,
            Meta.KeyBindingFlags.NONE,
            ModeType.ALL,
            cb.bind(this)
        );

        this._shortcutsBindingIds.push(name);
    }

    _updateTopbarLayout () {
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
        if(!DISABLE_DOWN_ARROW) {
            this._downArrow.visible = true;
        } else {
            this._downArrow.visible = false;
        }
    }

    _disconnectSettings () {
        if (!this._settingsChangedId)
            return;

        this.extension.settings.disconnect(this._settingsChangedId);
        this._settingsChangedId = null;
    }

    _clearClipboardTimeout () {
        if (!this._clipboardTimeoutId)
            return;

        clearInterval(this._clipboardTimeoutId);
        this._clipboardTimeoutId = null;
    }

    _disconnectSelectionListener () {
        if (!this._selectionOwnerChangedId)
            return;

        this.selection.disconnect(this._selectionOwnerChangedId);
    }

    _clearLabelTimeout () {
        if (!this._historyLabelTimeoutId)
            return;

        clearInterval(this._historyLabelTimeoutId);
        this._historyLabelTimeoutId = null;
    }

    _clearDelayedSelectionTimeout () {
        if (this._delayedSelectionTimeoutId) {
            clearInterval(this._delayedSelectionTimeoutId);
        }
    }

    _selectEntryWithDelay (entry) {
        let that = this;
        that._selectMenuItem(entry, false);

        that._delayedSelectionTimeoutId = setInterval(function () {
            that._selectMenuItem(entry);  //select the item
            that._delayedSelectionTimeoutId = null;
            return false;
        }, TIMEOUT_MS * 0.75);
    }

    _previousEntry () {
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
    }

    _nextEntry () {
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
    }

    _toggleMenu () {
        this.menu.toggle();
    }

    #clearClipboard () {
        Clipboard.set_text(CLIPBOARD_TYPE, "");
    }

    #updateClipboard (entry) {
        Clipboard.set_content(CLIPBOARD_TYPE, entry.mimetype(), entry.asBytes());
    }

    async #getClipboardContent () {
        const mimetypes = [
            'text/plain',
            'image/png',
            'image/jpg',
            'image/gif',
            'image/svg+xml',
            'image/webp'
        ];

        for (let type of mimetypes) {
            let result = await new Promise(resolve => Clipboard.get_content(CLIPBOARD_TYPE, type, (clipBoard, bytes) => {
                if (bytes === null) {
                    resolve(null);
                    return;
                }

                log(`Clipboard Indicator: ${type}`);
                log(`Object: ${bytes.constructor.name}`);
                log(`Data: ${bytes.get_data().constructor.name}`);
                log('Size: ', bytes.get_data().length);

                resolve(new ClipboardEntry(type, bytes.get_data(), false));
            }));

            if (result) return result;
        }

        return null;
    }
});
