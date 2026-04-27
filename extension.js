import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import St from 'gi://St';

import * as AnimationUtils from 'resource:///org/gnome/shell/misc/animationUtils.js';
import * as MessageTray from 'resource:///org/gnome/shell/ui/messageTray.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import { Extension, gettext as _ } from 'resource:///org/gnome/shell/extensions/extension.js';

import { Registry, ClipboardEntry } from './registry.js';
import { DialogManager } from './confirmDialog.js';
import { PrefsFields } from './constants.js';
import { Keyboard } from './keyboard.js';

const CLIPBOARD_TYPE = St.ClipboardType.CLIPBOARD;

const INDICATOR_ICON = 'edit-paste-symbolic';

let DELAYED_SELECTION_TIMEOUT = 750;
let MAX_REGISTRY_LENGTH       = 15;
let MAX_ENTRY_LENGTH          = 50;
let CACHE_ONLY_FAVORITE       = false;
let DELETE_ENABLED            = true;
let MOVE_ITEM_FIRST           = false;
let ENABLE_KEYBINDING         = true;
let PRIVATEMODE               = false;
let NOTIFY_ON_COPY            = true;
let NOTIFY_ON_CYCLE           = true;
let CONFIRM_ON_CLEAR          = true;
let MAX_TOPBAR_LENGTH         = 15;
let TOPBAR_DISPLAY_MODE       = 1; //0 - only icon, 1 - only clipboard content, 2 - both, 3 - neither
let CLEAR_ON_BOOT             = false;
let PASTE_ON_SELECT           = false;
let DISABLE_DOWN_ARROW        = false;
let STRIP_TEXT                = false;
let KEEP_SELECTED_ON_CLEAR    = false;
let PASTE_BUTTON              = true;
let PINNED_ON_BOTTOM          = false;
let CACHE_IMAGES              = true;
let SHOW_TIMESTAMPS           = true;
let TIMESTAMP_FORMAT          = 0; // 0 = relative, 1 = absolute
let SHOW_CONTENT_ICONS        = true;
let EXCLUDED_APPS             = [];

function formatTimestamp (timestamp, format) {
    if (!timestamp) return '';
    const now = Date.now();
    const diff = now - timestamp;
    const seconds = Math.floor(diff / 1000);

    if (format === 1) {
        // Absolute format
        const date = new Date(timestamp);
        const nowDate = new Date();
        const hours = date.getHours().toString().padStart(2, '0');
        const minutes = date.getMinutes().toString().padStart(2, '0');
        const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                        'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        const day = date.getDate();
        const month = months[date.getMonth()];
        if (date.getFullYear() !== nowDate.getFullYear()) {
            return `${hours}:${minutes} ${day} ${month} ${date.getFullYear()}`;
        }
        return `${hours}:${minutes} ${day} ${month}`;
    }

    // Relative format
    if (seconds < 10) return _('just now');
    if (seconds < 60) return _('%d min ago').replace('%d', Math.floor(seconds / 60) || 1);
    if (seconds < 3600) return _('%d min ago').replace('%d', Math.floor(seconds / 60));
    if (seconds < 86400) return _('%d hr ago').replace('%d', Math.floor(seconds / 3600));
    if (seconds < 604800) return _('%d days ago').replace('%d', Math.floor(seconds / 86400));
    if (seconds < 2592000) return _('%d weeks ago').replace('%d', Math.floor(seconds / 604800));
    if (seconds < 31536000) return _('%d months ago').replace('%d', Math.floor(seconds / 2592000));
    return _('> 1 year ago');
}

let CLEAR_HISTORY_ON_INTERVAL = false;
let CLEAR_HISTORY_INTERVAL    = 60;
let NEXT_HISTORY_CLEAR        = -1;
let CASE_SENSITIVE_SEARCH     = false;
let REGEX_SEARCH              = false;

export default class ClipboardIndicatorExtension extends Extension {
    enable () {
        this.clipboardIndicator = new ClipboardIndicator({
            clipboard: St.Clipboard.get_default(),
            settings: this.getSettings(),
            openSettings: this.openPreferences,
            uuid: this.uuid
        });

        Main.panel.addToStatusArea('clipboardIndicator', this.clipboardIndicator, 1);
    }

    disable () {
        this.clipboardIndicator.destroy();
        this.clipboardIndicator = null;
        EXCLUDED_APPS = [];
    }
}

const ClipboardIndicator = GObject.registerClass({
    GTypeName: 'ClipboardIndicator'
}, class ClipboardIndicator extends PanelMenu.Button {
    #refreshInProgress = false;

    destroy () {
        this._disconnectSettings();
        this._unbindShortcuts();
        this._disconnectSelectionListener();
        this._clearDelayedSelectionTimeout();
        this.#clearTimeouts();
        this.dialogManager.destroy();
        this.keyboard.destroy();

        super.destroy();
    }

    _init (extension) {
        super._init(0.0, "ClipboardIndicator");
        this.extension = extension;
        this.registry = new Registry(extension);
        this.keyboard = new Keyboard();
        this._settingsChangedId = null;
        this._selectionOwnerChangedId = null;
        this._historyLabel = null;
        this._buttonText = null;
        this._disableDownArrow = null;

        this._shortcutsBindingIds = [];
        this.clipItemsRadioGroup = [];

        let hbox = new St.BoxLayout({
            style_class: 'panel-status-menu-box clipboard-indicator-hbox'
        });

        this.hbox = hbox;

        this.icon = new St.Icon({
            icon_name: INDICATOR_ICON,
            style_class: 'system-status-icon clipboard-indicator-icon'
        });

        this._buttonText = new St.Label({
            text: _('Text will be here'),
            y_align: Clutter.ActorAlign.CENTER
        });

        this._buttonImgPreview = new St.Bin({
            style_class: 'clipboard-indicator-topbar-preview'
        });

        hbox.add_child(this.icon);
        hbox.add_child(this._buttonText);
        hbox.add_child(this._buttonImgPreview);
        this._downArrow = PopupMenu.arrowIcon(St.Side.BOTTOM);
        hbox.add_child(this._downArrow);
        this.add_child(hbox);
        this._createHistoryLabel();
        this._loadSettings();

        if (CLEAR_ON_BOOT) this.registry.clearCacheFolder();

        this.dialogManager = new DialogManager();
        this._buildMenu().then(() => {
            this._updateTopbarLayout();
            this._setupListener();
            this._setupHistoryIntervalClearing();
        });
    }

    #updateIndicatorContent(entry) {
        if (this.preventIndicatorUpdate || (TOPBAR_DISPLAY_MODE !== 1 && TOPBAR_DISPLAY_MODE !== 2)) {
            return;
        }

        if (!entry || PRIVATEMODE) {
            this._buttonImgPreview.destroy_all_children();
            this._buttonText.set_text("...")
        } else {
            if (entry.isText()) {
                this._buttonText.set_text(this._truncate(entry.getStringValue(), MAX_TOPBAR_LENGTH));
                this._buttonImgPreview.destroy_all_children();
            }
            else if (entry.isImage()) {
                this._buttonText.set_text('');
                this._buttonImgPreview.destroy_all_children();
                this.registry.getEntryAsImage(entry).then(img => {
                    img.add_style_class_name('clipboard-indicator-img-preview');
                    img.y_align = Clutter.ActorAlign.CENTER;

                    // icon only renders properly in setTimeout for some arcane reason
                    this._imagePreviewTimeout = setTimeout(() => {
                        this._buttonImgPreview.set_child(img);
                    }, 0);
                });
            }
        }
    }

    async _buildMenu () {
        let that = this;
        const clipHistory = await this._getCache();
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
            y_expand: true,
            primary_icon: new St.Icon({ icon_name: 'edit-find-symbolic' })
        });

        that.searchEntry.get_clutter_text().connect(
            'text-changed',
            that._onSearchTextChanged.bind(that)
        );

        that._entryItem.add_child(that.searchEntry);

        that.menu.connect('open-state-changed', (self, open) => {
            this._setFocusOnOpenTimeout = setTimeout(() => {
                if (open) {
                    if (this.clipItemsRadioGroup.length > 0) {
                        that.searchEntry.set_text('');
                        global.stage.set_key_focus(that.searchEntry);
                    }
                    else {
                        global.stage.set_key_focus(that.privateModeMenuItem);
                    }
                }
            }, 50);
        });

        that.menu.actor.connect('key-press-event', (actor, event) => {
            const modifier = event.get_state();
            const isAlt = modifier & Clutter.ModifierType.MOD1_MASK;
            if (!isAlt) return Clutter.EVENT_PROPAGATE;

            const keyMap = {
                [Clutter.KEY_1]: 0, [Clutter.KEY_2]: 1, [Clutter.KEY_3]: 2,
                [Clutter.KEY_4]: 3, [Clutter.KEY_5]: 4, [Clutter.KEY_6]: 5,
                [Clutter.KEY_7]: 6, [Clutter.KEY_8]: 7, [Clutter.KEY_9]: 8,
            };

            const index = keyMap[event.get_key_symbol()];
            if (index === undefined) return Clutter.EVENT_PROPAGATE;

            const visibleItems = this.clipItemsRadioGroup.filter(m => m.actor.visible);
            if (index < visibleItems.length) {
                this._onMenuItemSelectedAndMenuClose(visibleItems[index], true);
            }

            return Clutter.EVENT_STOP;
        });

        // Create menu sections for items
        // Favorites
        that.favoritesSection = new PopupMenu.PopupMenuSection();

        that.scrollViewFavoritesMenuSection = new PopupMenu.PopupMenuSection();
        this.favoritesScrollView = new St.ScrollView({
            style_class: 'ci-history-menu-section',
            overlay_scrollbars: true
        });
        this.favoritesScrollView.add_child(that.favoritesSection.actor);

        that.scrollViewFavoritesMenuSection.actor.add_child(this.favoritesScrollView);
        this.favoritesSeparator = new PopupMenu.PopupSeparatorMenuItem();

        // Snippets
        that.snippetsSection = new PopupMenu.PopupMenuSection();

        that.scrollViewSnippetsMenuSection = new PopupMenu.PopupMenuSection();
        this.snippetsScrollView = new St.ScrollView({
            style_class: 'ci-history-menu-section',
            overlay_scrollbars: true
        });
        this.snippetsScrollView.add_child(that.snippetsSection.actor);
        that.scrollViewSnippetsMenuSection.actor.add_child(this.snippetsScrollView);
        this.snippetsSeparator = new PopupMenu.PopupSeparatorMenuItem();

        // History
        that.historySection = new PopupMenu.PopupMenuSection();

        that.scrollViewMenuSection = new PopupMenu.PopupMenuSection();
        this.historyScrollView = new St.ScrollView({
            style_class: 'ci-main-menu-section ci-history-menu-section',
            overlay_scrollbars: true
        });
        this.historyScrollView.add_child(that.historySection.actor);

        that.scrollViewMenuSection.actor.add_child(this.historyScrollView);

        // Add separator
        this.historySeparator = new PopupMenu.PopupSeparatorMenuItem();

        // Add sections ordered: Snippets (always on top) > Favorites/History
        that.menu.addMenuItem(that.scrollViewSnippetsMenuSection);
        if (PINNED_ON_BOTTOM) {
            that.menu.addMenuItem(that.scrollViewMenuSection);
            that.menu.addMenuItem(that.scrollViewFavoritesMenuSection);
        }
        else {
            that.menu.addMenuItem(that.scrollViewFavoritesMenuSection);
            that.menu.addMenuItem(that.scrollViewMenuSection);
        }

        // Private mode switch
        that.privateModeMenuItem = new PopupMenu.PopupSwitchMenuItem(
            _("Private mode"), PRIVATEMODE, { reactive: true });
        that.privateModeMenuItem.connect('toggled',
            that._onPrivateModeSwitch.bind(that));
        that.privateModeMenuItem.insert_child_at_index(
            new St.Icon({
                icon_name: 'security-medium-symbolic',
                style_class: 'clipboard-menu-icon',
                y_align: Clutter.ActorAlign.CENTER
            }),
            0
        );
        that.menu.addMenuItem(that.privateModeMenuItem);

        // Add 'Clear' button which removes all items from cache
        this.clearMenuItem = new PopupMenu.PopupMenuItem(_('Clear history'));
        this.clearMenuItem.insert_child_at_index(
            new St.Icon({
                icon_name: 'user-trash-symbolic',
                style_class: 'clipboard-menu-icon',
                y_align: Clutter.ActorAlign.CENTER
            }),
            0
        );

        let timerBox = new St.BoxLayout({
            x_align: Clutter.ActorAlign.END,
            x_expand: true
        });

        this.timerLabel = new St.Label({
            text: '',
            style: 'font-family: monospace;',
            x_align: Clutter.ActorAlign.END,
            x_expand: true
        });

        this.resetTimerButton = new St.Button({
            style_class: 'ci-action-btn',
            can_focus: true,
            child: new St.Icon({
                icon_name: 'view-refresh-symbolic',
                style_class: 'system-status-icon',
                icon_size: 14
            }),
            x_align: Clutter.ActorAlign.END,
            y_align: Clutter.ActorAlign.CENTER,
        });

        this.resetTimerButton.connect('clicked', () => {
            this._scheduleNextHistoryClear();
        });

        timerBox.add_child(this.timerLabel);
        timerBox.add_child(this.resetTimerButton);
        this.clearMenuItem.add_child(timerBox);
        
        this.clearMenuItem.connect('activate', that._removeAll.bind(that));

        // Add 'Settings' menu item to open settings
        this.settingsMenuItem = new PopupMenu.PopupMenuItem(_('Settings'));
        this.settingsMenuItem.insert_child_at_index(
            new St.Icon({
                icon_name: 'preferences-system-symbolic',
                style_class: 'clipboard-menu-icon',
                y_align: Clutter.ActorAlign.CENTER
            }),
            0
        );
        that.menu.addMenuItem(this.settingsMenuItem);
        this.settingsMenuItem.connect('activate', that._openSettings.bind(that));

        // Empty state section
        this.emptyStateSection = new St.BoxLayout({
            style_class: 'clipboard-indicator-empty-state',
            vertical: true
        });
        this.emptyStateSection.add_child(new St.Icon({
            icon_name: INDICATOR_ICON,
            style_class: 'system-status-icon clipboard-indicator-icon',
            x_align: Clutter.ActorAlign.CENTER
        }));
        this.emptyStateSection.add_child(new St.Label({
            text: _('Clipboard is empty'),
            x_align: Clutter.ActorAlign.CENTER
        }));

        // Add cached items
        clipHistory.forEach(entry => this._addEntry(entry));

        if (lastIdx >= 0) {
            that._selectMenuItem(clipItemsArr[lastIdx]);
        }

        this.#showElements();
    }

    #hideElements() {
        if (this.menu.box.contains(this._entryItem)) this.menu.box.remove_child(this._entryItem);
        if (this.menu.box.contains(this.favoritesSeparator)) this.menu.box.remove_child(this.favoritesSeparator);
        if (this.menu.box.contains(this.snippetsSeparator)) this.menu.box.remove_child(this.snippetsSeparator);
        if (this.menu.box.contains(this.historySeparator)) this.menu.box.remove_child(this.historySeparator);
        if (this.menu.box.contains(this.clearMenuItem)) this.menu.box.remove_child(this.clearMenuItem);
        if (this.menu.box.contains(this.emptyStateSection)) this.menu.box.remove_child(this.emptyStateSection);
    }

    #showElements() {
        if (this.clipItemsRadioGroup.length > 0) {
            if (this.menu.box.contains(this._entryItem) === false) {
                this.menu.box.insert_child_at_index(this._entryItem, 0);
            }
            if (this.menu.box.contains(this.clearMenuItem) === false) {
                this.menu.box.insert_child_below(this.clearMenuItem, this.settingsMenuItem);
            }
            if (this.menu.box.contains(this.emptyStateSection) === true) {
                this.menu.box.remove_child(this.emptyStateSection);
            }

            if (this.snippetsSection._getMenuItems().length > 0) {
                if (this.menu.box.contains(this.snippetsSeparator) === false) {
                    this.menu.box.insert_child_above(this.snippetsSeparator, this.scrollViewSnippetsMenuSection.actor);
                }
            }
            else if (this.menu.box.contains(this.snippetsSeparator) === true) {
                this.menu.box.remove_child(this.snippetsSeparator);
            }

            if (this.favoritesSection._getMenuItems().length > 0) {
                if (this.menu.box.contains(this.favoritesSeparator) === false) {
                    this.menu.box.insert_child_above(this.favoritesSeparator, this.scrollViewFavoritesMenuSection.actor);
                }
            }
            else if (this.menu.box.contains(this.favoritesSeparator) === true) {
                this.menu.box.remove_child(this.favoritesSeparator);
            }

            if (this.historySection._getMenuItems().length > 0) {
                if (this.menu.box.contains(this.historySeparator) === false) {
                    this.menu.box.insert_child_above(this.historySeparator, this.scrollViewMenuSection.actor);
                }
            }
            else if (this.menu.box.contains(this.historySeparator) === true) {
                this.menu.box.remove_child(this.historySeparator);
            }
        }
        else if (this.menu.box.contains(this.emptyStateSection) === false) {
            this.#renderEmptyState();
        }
    }

    #renderEmptyState () {
        this.#hideElements();
        this.menu.box.insert_child_at_index(this.emptyStateSection, 0);
    }

    /* When text change, this function will check, for each item of the
    historySection and favoritesSestion, if it should be visible or not (based on words contained
    in the clipContents attribute of the item). It doesn't destroy or create
    items. It the entry is empty, the section is restored with all items
    set as visible. */
    _onSearchTextChanged () {

        // Text to be searched converted to lowercase if search is case insensitive
        let searchedText = this.searchEntry.get_text();
        if (!CASE_SENSITIVE_SEARCH) searchedText = searchedText.toLowerCase();

        if(searchedText === '') {
            this._getAllIMenuItems().forEach(function(mItem){
                mItem.actor.visible = true;
            });
        }
        else {
            this._getAllIMenuItems().forEach(function(mItem){
                // Clip content converted to lowercase if search is case insensitive
                let text = mItem.clipContents;
                if (!CASE_SENSITIVE_SEARCH) text = text.toLowerCase();

                let isMatching = false;
                if (REGEX_SEARCH){
                    /* Regex flags:
                       - 'm' for multiline matching (when multiline content is copied)
                       - 'i' for case insensitive matching when search is not set to case sensitive
                    */
                    let text_regex = new RegExp(searchedText, 'm' + (CASE_SENSITIVE_SEARCH ? '' : 'i'));
                    isMatching = text_regex.test(text);
                }else{
                    isMatching = text.indexOf(searchedText) >= 0;
                }
                mItem.actor.visible = isMatching
            });
        }
    }

    _truncate (string, length) {
        let shortened = string.replace(/\s+/g, ' ');

        let chars = [...shortened]
        if (chars.length > length)
            shortened = chars.slice(0, length - 1).join('') + '...';

        return shortened;
    }

    _setEntryLabel (menuItem) {
        const { entry } = menuItem;
        if (entry.isText()) {
            menuItem.label.set_text(this._truncate(entry.getStringValue(), MAX_ENTRY_LENGTH));
        }
        else if (entry.isImage()) {
            this.registry.getEntryAsImage(entry).then(img => {
                img.add_style_class_name('clipboard-menu-img-preview');
                if (menuItem.previewImage) {
                    menuItem.remove_child(menuItem.previewImage);
                }
                menuItem.previewImage = img;
                menuItem.insert_child_below(img, menuItem.label);
            });
        }
    }

    _updateTimestampLabel (menuItem) {
        if (!menuItem.timestampLabel) return;
        if (!SHOW_TIMESTAMPS) {
            menuItem.timestampLabel.hide();
            return;
        }
        menuItem.timestampLabel.show();
        menuItem.timestampLabel.set_text(formatTimestamp(menuItem.entry.timestamp, TIMESTAMP_FORMAT));
    }

    _findNextMenuItem (currentMenutItem) {
        let currentIndex = this.clipItemsRadioGroup.indexOf(currentMenutItem);

        // for only one item
        if(this.clipItemsRadioGroup.length === 1) {
            return null;
        }

        // when focus is in middle of the displayed list
        for (let i = currentIndex - 1; i >= 0; i--) {
            let menuItem = this.clipItemsRadioGroup[i];
            if (menuItem.actor.visible) {
                return menuItem;
            }
        }

        // when focus is at the last element of the displayed list
        let beforeMenuItem = this.clipItemsRadioGroup[currentIndex + 1];
        if(beforeMenuItem.actor.visible){
          return beforeMenuItem; 
        }

        return null;
    }

    #selectNextMenuItem (menuItem) {
        let nextMenuItem = this._findNextMenuItem(menuItem);

        if (nextMenuItem) {
            nextMenuItem.actor.grab_key_focus();
        } else {
            this.privateModeMenuItem.actor.grab_key_focus();
        }
    }

    _addEntry (entry, autoSelect, autoSetClip) {
        let menuItem = new PopupMenu.PopupMenuItem('');

        menuItem.menu = this.menu;
        menuItem.entry = entry;
        menuItem.clipContents = entry.getStringValue();
        menuItem.radioGroup = this.clipItemsRadioGroup;
        menuItem.buttonPressId = menuItem.connect('activate',
            autoSet => this._onMenuItemSelectedAndMenuClose(menuItem, autoSet));
        menuItem.connect('key-focus-in', () => {
            let viewToScroll;
            if (menuItem.entry.isSnippet()) {
                viewToScroll = this.snippetsScrollView;
            } else if (menuItem.entry.isFavorite()) {
                viewToScroll = this.favoritesScrollView;
            } else {
                viewToScroll = this.historyScrollView;
            }
            AnimationUtils.ensureActorVisibleInScrollView(viewToScroll, menuItem);
        });
        menuItem.actor.connect('key-press-event', (actor, event) => {
            switch (event.get_key_symbol()) {
                case Clutter.KEY_Delete:
                    this.#selectNextMenuItem(menuItem);
                    this._removeEntry(menuItem, 'delete');
                    break;
                case Clutter.KEY_p:
                    this.#selectNextMenuItem(menuItem);
                    this._favoriteToggle(menuItem);
                    break;
                case Clutter.KEY_s:
                    this.#selectNextMenuItem(menuItem);
                    this._snippetToggle(menuItem);
                    break;
                case Clutter.KEY_v:
                    this.#pasteItem(menuItem);
                    break;
                case Clutter.KEY_KP_Enter:
                case Clutter.KEY_Return:
                    if (PASTE_ON_SELECT) {
                        this.#pasteItem(menuItem);
                    }
                    this._onMenuItemSelectedAndMenuClose(menuItem, true);
                    break;
            }
        })

        this._setEntryLabel(menuItem);

        // Timestamp label
        menuItem.timestampLabel = new St.Label({
            style_class: 'ci-timestamp-label',
            text: '',
            y_align: Clutter.ActorAlign.CENTER
        });
        menuItem.actor.insert_child_below(menuItem.timestampLabel, menuItem.label);
        this._updateTimestampLabel(menuItem);

        this.clipItemsRadioGroup.push(menuItem);

        // Favorite button
        let iconfav = new St.Icon({
            icon_name: 'view-pin-symbolic',
            style_class: 'system-status-icon'
        });

        let icofavBtn = new St.Button({
            style_class: 'ci-pin-btn ci-action-btn',
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

        // Paste button
        menuItem.pasteBtn = new St.Button({
            style_class: 'ci-action-btn',
            can_focus: true,
            child: new St.Icon({
                icon_name: 'edit-paste-symbolic',
                style_class: 'system-status-icon'
            }),
            x_align: Clutter.ActorAlign.END,
            x_expand: false,
            y_expand: true,
            visible: PASTE_BUTTON
        });

        menuItem.pasteBtn.connect('clicked',
            () => this.#pasteItem(menuItem)
        );

        menuItem.actor.add_child(menuItem.pasteBtn);

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

        // Snippet button
        let iconSnip = new St.Icon({
            icon_name: 'bookmark-new-symbolic',
            style_class: 'system-status-icon'
        });

        let snipBtn = new St.Button({
            style_class: 'ci-snippet-btn ci-action-btn',
            can_focus: true,
            child: iconSnip,
            x_align: Clutter.ActorAlign.END,
            x_expand: false,
            y_expand: true
        });

        menuItem.snipBtn = snipBtn;
        menuItem.snipIcon = iconSnip;
        menuItem.snippetPressId = snipBtn.connect('clicked',
            () => this._snippetToggle(menuItem)
        );
        menuItem.actor.add_child(snipBtn);
        this._setSnippetIcon(menuItem);

        if (entry.isSnippet()) {
            this.snippetsSection.addMenuItem(menuItem, 0);
        } else if (entry.isFavorite()) {
            this.favoritesSection.addMenuItem(menuItem, 0);
        } else {
            this.historySection.addMenuItem(menuItem, 0);
        }

        if (autoSelect === true) {
            this._selectMenuItem(menuItem, autoSetClip);
        }
        else {
            menuItem.setOrnament(PopupMenu.Ornament.NONE);
        }

        this.#showElements();
    }

    _favoriteToggle (menuItem) {
        menuItem.entry.favorite = menuItem.entry.isFavorite() ? false : true;
        this._moveItemFirst(menuItem);
        this._updateCache();
        this.#showElements();
    }

    _snippetToggle (menuItem) {
        const isSnippet = !menuItem.entry.isSnippet();
        menuItem.entry.setSnippet(isSnippet);
        menuItem.snipIcon.set_icon_name(
            isSnippet ? 'bookmark-filled-symbolic' : 'bookmark-new-symbolic'
        );
        this._moveItemFirst(menuItem);
        this._updateCache();
        this.#showElements();
    }

    _setSnippetIcon (menuItem) {
        if (!menuItem.snipIcon) return;
        menuItem.snipIcon.set_icon_name(
            menuItem.entry.isSnippet() ? 'bookmark-filled-symbolic' : 'bookmark-new-symbolic'
        );
    }

    _confirmRemoveAll () {
        const title = _("Clear all?");
        const message = _("Are you sure you want to delete all clipboard items?");
        const sub_message = _("This operation cannot be undone.");

        this.dialogManager.open(title, message, sub_message, _("Clear"), _("Cancel"), () => {
            this._clearHistory();
        }
      );
    }

    _clearHistory (invokedAutomatically = false) {
        // Don't remove pinned items
        this.historySection._getMenuItems().forEach(mItem => {
            if (KEEP_SELECTED_ON_CLEAR === false || !mItem.currentlySelected) {
                if (mItem.entry.isSnippet()) return;
                this._removeEntry(mItem, 'delete');
            }
        });

        if (!invokedAutomatically) {
            this._showNotification(_("Clipboard history cleared"));
        }
        else {
            this._showNotification(_("Clipboard history cleared automatically"));
        }
    }

    _removeAll () {
        if (PRIVATEMODE) return;
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

        if (menuItem.entry.isImage()) {
            this.registry.deleteEntryFile(menuItem.entry);
        }

        this._updateCache();
        this.#showElements();
    }

    _removeOldestEntries () {
        let that = this;

        let clipItemsRadioGroupNoFavorite = that.clipItemsRadioGroup.filter(
            item => item.entry.isFavorite() === false && item.entry.isSnippet() === false);

        const origSize = clipItemsRadioGroupNoFavorite.length;

        while (clipItemsRadioGroupNoFavorite.length > MAX_REGISTRY_LENGTH) {
            let oldestNoFavorite = clipItemsRadioGroupNoFavorite.shift();
            that._removeEntry(oldestNoFavorite);

            clipItemsRadioGroupNoFavorite = that.clipItemsRadioGroup.filter(
            item => item.entry.isFavorite() === false && item.entry.isSnippet() === false);
        }

        if (clipItemsRadioGroupNoFavorite.length < origSize) {
            that._updateCache();
        }
    }

    _onMenuItemSelected (menuItem, autoSet) {
        for (let otherMenuItem of menuItem.radioGroup) {
            let clipContents = menuItem.clipContents;

            if (otherMenuItem === menuItem && clipContents) {
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
    }

    _selectMenuItem (menuItem, autoSet) {
        this._onMenuItemSelected(menuItem, autoSet);
        this.#updateIndicatorContent(menuItem.entry);
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

    _getCache () {
        return this.registry.read();
    }

    #addToCache (entry) {
        const entries = this.clipItemsRadioGroup
            .map(menuItem => menuItem.entry)
            .filter(entry => CACHE_ONLY_FAVORITE == false || entry.isFavorite())
            .concat([entry]);
        this.registry.write(entries);
    }

    _updateCache () {
        const entries = this.clipItemsRadioGroup
            .map(menuItem => menuItem.entry)
            .filter(entry => CACHE_ONLY_FAVORITE == false || entry.isFavorite());

        this.registry.write(entries);
    }

    async _onSelectionChange (selection, selectionType, selectionSource) {
        if (selectionType === Meta.SelectionType.SELECTION_CLIPBOARD) {
            this._refreshIndicator();
        }
    }

    async _refreshIndicator () {
        if (PRIVATEMODE) return; // Private mode, do not.

        const focussedWindow = Shell.Global.get().display.focusWindow;
        const wmClass = focussedWindow?.get_wm_class();
        
        if (wmClass && EXCLUDED_APPS.includes(wmClass)) return; // Excluded app, do not.

        if (this.#refreshInProgress) return;
        this.#refreshInProgress = true;

        try {
            const result = await this.#getClipboardContent();

            if (result) {
                // Duplicate detection: skip if identical to latest entry
                if (this.clipItemsRadioGroup.length > 0) {
                    const latestEntry = this.clipItemsRadioGroup[this.clipItemsRadioGroup.length - 1].entry;
                    if (latestEntry.equals(result)) {
                        this.#refreshInProgress = false;
                        return;
                    }
                }

                for (let menuItem of this.clipItemsRadioGroup) {
                    if (menuItem.entry.equals(result)) {
                        this._selectMenuItem(menuItem, false);

                        if (!menuItem.entry.isFavorite() && MOVE_ITEM_FIRST) {
                            this._moveItemFirst(menuItem);
                        }

                        return;
                    }
                }

                this.#addToCache(result);
                this._addEntry(result, true, false);
                this._removeOldestEntries();
                if (NOTIFY_ON_COPY) {
                    this._showNotification(_("Copied to clipboard"), notif => {
                        notif.addAction(_('Cancel'), this._cancelNotification);
                    });
                }
            }
        }
        catch (e) {
            console.error('Clipboard Indicator: Failed to refresh indicator');
            console.error(e);
        }
        finally {
            this.#refreshInProgress = false;
        }
    }

    _moveItemFirst (item) {
        this._removeEntry(item);
        this._addEntry(item.entry, item.currentlySelected, false);
        this._updateCache();
    }

    _findItem (text) {
        return this.clipItemsRadioGroup.filter(
            item => item.clipContents === text)[0];
    }

    _getCurrentlySelectedItem () {
        return this.clipItemsRadioGroup.find(item => item.currentlySelected);
    }

    _getAllIMenuItems () {
        return this.snippetsSection._getMenuItems().concat(this.historySection._getMenuItems()).concat(this.favoritesSection._getMenuItems());
    }

    _setupListener () {
        const metaDisplay = Shell.Global.get().get_display();
        const selection = metaDisplay.get_selection();
        this._setupSelectionTracking(selection);
    }

    _setupSelectionTracking (selection) {
        this.selection = selection;
        this._selectionOwnerChangedId = selection.connect('owner-changed', (selection, selectionType, selectionSource) => {
            this._onSelectionChange(selection, selectionType, selectionSource);
        });
    }

    _setupHistoryIntervalClearing() {
        this._fetchSettings();

        if (this._intervalSettingChangedId) {
            this.extension.settings.disconnect(this._intervalSettingChangedId);
            this._intervalSettingChangedId = null;
        }
        if (this._intervalToggleChangedId) {
            this.extension.settings.disconnect(this._intervalToggleChangedId);
            this._intervalToggleChangedId = null;
        }
        if (this._historyClearTimeoutId) {
            clearTimeout(this._historyClearTimeoutId);
            this._historyClearTimeoutId = null;
        }

        this._intervalSettingChangedId = this.extension.settings.connect(
            `changed::${PrefsFields.CLEAR_HISTORY_INTERVAL}`,
            this._onHistoryIntervalClearSettingsChanged.bind(this)
        );
        this._intervalToggleChangedId = this.extension.settings.connect(
            `changed::${PrefsFields.CLEAR_HISTORY_ON_INTERVAL}`,
            this._onHistoryIntervalClearSettingsChanged.bind(this)
        );


        
        if (!CLEAR_HISTORY_ON_INTERVAL) {
            this._updateIntervalTimer();
            return;
        }

        const currentTime = Math.ceil(new Date().getTime() / 1000);

        if (NEXT_HISTORY_CLEAR === -1) { //new timer
            this._scheduleNextHistoryClear();
        }
        else if (NEXT_HISTORY_CLEAR < currentTime) { //timer expired
            this._clearHistory(true);
            this._scheduleNextHistoryClear();
        }
        else { //timer already set, but not expired
            const timeoutMs = (NEXT_HISTORY_CLEAR - currentTime) * 1000;
            this._historyClearTimeoutId = setTimeout(() => {
                this._clearHistory(true);
                this._scheduleNextHistoryClear();
            }, timeoutMs);
            this._timerIntervalId = setInterval(() => {
                this._updateIntervalTimer();
            }, 1000);
        }
    }

    _onHistoryIntervalClearSettingsChanged(_settings, key) {
        this._fetchSettings();
        if (key === PrefsFields.CLEAR_HISTORY_INTERVAL) {
            this._scheduleNextHistoryClear();
        }
        else if (key === PrefsFields.CLEAR_HISTORY_ON_INTERVAL) {
            if (CLEAR_HISTORY_ON_INTERVAL) {
                this._resetHistoryClearTimer();
                this._setupHistoryIntervalClearing();
            } else {
                this._resetHistoryClearTimer();
            }
        }
    }

    _scheduleNextHistoryClear() {
        this._fetchSettings();

        clearInterval(this._timerIntervalId);
        if (this._historyClearTimeoutId) {
            clearTimeout(this._historyClearTimeoutId);
            this._historyClearTimeoutId = null;
        }

        if(!CLEAR_HISTORY_ON_INTERVAL) {
            this._resetHistoryClearTimer();
            return;
        }

        const currentTime = Math.ceil(new Date().getTime() / 1000);
        NEXT_HISTORY_CLEAR = currentTime + CLEAR_HISTORY_INTERVAL * 60;
        const timeoutMs = (NEXT_HISTORY_CLEAR - currentTime) * 1000;

        this.extension.settings.set_int(PrefsFields.NEXT_HISTORY_CLEAR, NEXT_HISTORY_CLEAR);
        
        this._updateIntervalTimer();
        this._timerIntervalId = setInterval(() => {
            this._updateIntervalTimer();
        }, 1000);

        this._historyClearTimeoutId = setTimeout(() => {
            this._clearHistory(true);
            this._scheduleNextHistoryClear();
        }, timeoutMs);
    }

    _resetHistoryClearTimer() {
        //basically just reset and stop the timer
        if (this._historyClearTimeoutId) {
            clearTimeout(this._historyClearTimeoutId);
            this._historyClearTimeoutId = null;
        }
        clearInterval(this._timerIntervalId);
        this._timerIntervalId = null;
        this._updateIntervalTimer();
        this.extension.settings.set_int(PrefsFields.NEXT_HISTORY_CLEAR, -1);
    }

    _updateIntervalTimer() {
        this._fetchSettings();
        this.resetTimerButton.visible = CLEAR_HISTORY_ON_INTERVAL;
        this.timerLabel.visible = CLEAR_HISTORY_ON_INTERVAL;
        if (!CLEAR_HISTORY_ON_INTERVAL) return;


        let currentTime = Math.ceil(new Date().getTime() / 1000);
        let timeLeft = NEXT_HISTORY_CLEAR - currentTime;

        if (timeLeft <= 0) {
            this.timerLabel.set_text('');
            return;
        }

        let hours = Math.floor(timeLeft / 3600);
        let minutes = Math.floor((timeLeft % 3600) / 60);
        let seconds = Math.floor(timeLeft % 60);

        let formattedTime = '';
        if (hours > 0) {
            formattedTime += `${hours}h `;
        }
        if (minutes > 0) {
            formattedTime += `${minutes}m `;
        }
        formattedTime += `${seconds}s`;
        this.timerLabel.set_text(formattedTime);
    }

    _openSettings () {
        this.extension.openSettings();
    }

    _initNotifSource () {
        if (!this._notifSource) {
            this._notifSource = new MessageTray.Source({
                title: 'Clipboard Indicator',
                'icon-name': INDICATOR_ICON
            });

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
        const dndOn = () =>
            !Main.panel.statusArea.dateMenu._indicator._settings.get_boolean(
                'show-banners',
            );
        if (PRIVATEMODE || dndOn()) {
            return;
        }

        let notification = null;

        this._initNotifSource();

        if (this._notifSource.count === 0) {
            notification = new MessageTray.Notification({
                source: this._notifSource,
                body: message,
                'is-transient': true
            });
        }
        else {
            notification = this._notifSource.notifications[0];
            notification.body = message;
            notification.clearActions();
        }

        if (typeof transformFn === 'function') {
            transformFn(notification);
        }

        this._notifSource.addNotification(notification);
    }

    _createHistoryLabel () {
        this._historyLabel = new St.Label({
            style_class: 'ci-notification-label',
            text: ''
        });

        global.stage.add_child(this._historyLabel);

        this._historyLabel.hide();
    }

    togglePrivateMode () {
        this.privateModeMenuItem.toggle();
    }

    _onPrivateModeSwitch () {
        let that = this;
        PRIVATEMODE = this.privateModeMenuItem.state;
        // We hide the history in private ModeTypee because it will be out of sync (selected item will not reflect clipboard)
        this.scrollViewMenuSection.actor.visible = !PRIVATEMODE;
        this.scrollViewFavoritesMenuSection.actor.visible = !PRIVATEMODE;
        this.scrollViewSnippetsMenuSection.actor.visible = !PRIVATEMODE;
        // If we get out of private mode then we restore the clipboard to old state
        if (!PRIVATEMODE) {
            let selectList = this.clipItemsRadioGroup.filter((item) => !!item.currentlySelected);

            if (selectList.length) {
                this._selectMenuItem(selectList[0]);
            } else {
                // Nothing to return to, let's empty it instead
                this.#clearClipboard();
            }

            this.#getClipboardContent().then(entry => {
                if (!entry) return;
                this.#updateIndicatorContent(entry);
            }).catch(e => console.error(e));

            this.hbox.remove_style_class_name('private-mode');
            this.#showElements();
        } else {
            this.hbox.add_style_class_name('private-mode');
            this.#updateIndicatorContent(null);
            this.#hideElements();
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
        MAX_REGISTRY_LENGTH         = settings.get_int(PrefsFields.HISTORY_SIZE);
        MAX_ENTRY_LENGTH            = settings.get_int(PrefsFields.PREVIEW_SIZE);
        CACHE_ONLY_FAVORITE         = settings.get_boolean(PrefsFields.CACHE_ONLY_FAVORITE);
        DELETE_ENABLED              = settings.get_boolean(PrefsFields.DELETE);
        MOVE_ITEM_FIRST             = settings.get_boolean(PrefsFields.MOVE_ITEM_FIRST);
        NOTIFY_ON_COPY              = settings.get_boolean(PrefsFields.NOTIFY_ON_COPY);
        NOTIFY_ON_CYCLE             = settings.get_boolean(PrefsFields.NOTIFY_ON_CYCLE);
        CONFIRM_ON_CLEAR            = settings.get_boolean(PrefsFields.CONFIRM_ON_CLEAR);
        ENABLE_KEYBINDING           = settings.get_boolean(PrefsFields.ENABLE_KEYBINDING);
        MAX_TOPBAR_LENGTH           = settings.get_int(PrefsFields.TOPBAR_PREVIEW_SIZE);
        TOPBAR_DISPLAY_MODE         = settings.get_int(PrefsFields.TOPBAR_DISPLAY_MODE_ID);
        CLEAR_ON_BOOT               = settings.get_boolean(PrefsFields.CLEAR_ON_BOOT);
        PASTE_ON_SELECT             = settings.get_boolean(PrefsFields.PASTE_ON_SELECT);
        DISABLE_DOWN_ARROW          = settings.get_boolean(PrefsFields.DISABLE_DOWN_ARROW);
        STRIP_TEXT                  = settings.get_boolean(PrefsFields.STRIP_TEXT);
        KEEP_SELECTED_ON_CLEAR      = settings.get_boolean(PrefsFields.KEEP_SELECTED_ON_CLEAR);
        PASTE_BUTTON                = settings.get_boolean(PrefsFields.PASTE_BUTTON);
        PINNED_ON_BOTTOM            = settings.get_boolean(PrefsFields.PINNED_ON_BOTTOM);
        CACHE_IMAGES                = settings.get_boolean(PrefsFields.CACHE_IMAGES);
        EXCLUDED_APPS               = settings.get_strv(PrefsFields.EXCLUDED_APPS);
        CLEAR_HISTORY_ON_INTERVAL   = settings.get_boolean(PrefsFields.CLEAR_HISTORY_ON_INTERVAL);
        CLEAR_HISTORY_INTERVAL      = settings.get_int(PrefsFields.CLEAR_HISTORY_INTERVAL);
        NEXT_HISTORY_CLEAR          = settings.get_int(PrefsFields.NEXT_HISTORY_CLEAR);
        CASE_SENSITIVE_SEARCH       = settings.get_boolean(PrefsFields.CASE_SENSITIVE_SEARCH);
        REGEX_SEARCH                = settings.get_boolean(PrefsFields.REGEX_SEARCH);
        SHOW_TIMESTAMPS             = settings.get_boolean(PrefsFields.SHOW_TIMESTAMPS);
        TIMESTAMP_FORMAT            = settings.get_int(PrefsFields.TIMESTAMP_FORMAT);
        SHOW_CONTENT_ICONS          = settings.get_boolean(PrefsFields.SHOW_CONTENT_ICONS);
    }

    async _onSettingsChange () {
        try {
            var that = this;

            // Load the settings into variables
            that._fetchSettings();

            // Remove old entries in case the registry size changed
            that._removeOldestEntries();

            // Re-set menu-items lables in case preview size changed
            this._getAllIMenuItems().forEach(function (mItem) {
                that._setEntryLabel(mItem);
                that._updateTimestampLabel(mItem);
                mItem.pasteBtn.visible = PASTE_BUTTON;
            });

            //update topbar
            this._updateTopbarLayout();
            that.#updateIndicatorContent(await this.#getClipboardContent());

            // Bind or unbind shortcuts
            if (ENABLE_KEYBINDING)
                that._bindShortcuts();
            else
                that._unbindShortcuts();
        } catch (e) {
            console.error('Clipboard Indicator: Failed to update registry');
            console.error(e);
        }
    }

    _bindShortcuts () {
        this._unbindShortcuts();
        this._bindShortcut(PrefsFields.BINDING_CLEAR_HISTORY, this._removeAll);
        this._bindShortcut(PrefsFields.BINDING_PREV_ENTRY, this._previousEntry);
        this._bindShortcut(PrefsFields.BINDING_NEXT_ENTRY, this._nextEntry);
        this._bindShortcut(PrefsFields.BINDING_TOGGLE_MENU, this._toggleMenu);
        this._bindShortcut(PrefsFields.BINDING_PRIVATE_MODE, this.togglePrivateMode);
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
            this._buttonImgPreview.visible = false;
            this.show();
        }
        if(TOPBAR_DISPLAY_MODE === 1){
            this.icon.visible = false;
            this._buttonText.visible = true;
            this._buttonImgPreview.visible = true;
            this.show();
        }
        if(TOPBAR_DISPLAY_MODE === 2){
            this.icon.visible = true;
            this._buttonText.visible = true;
            this._buttonImgPreview.visible = true;
            this.show();
        }
        if (TOPBAR_DISPLAY_MODE === 3) {
            this.hide();
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
        
        if (this._intervalSettingChangedId) {
            this.extension.settings.disconnect(this._intervalSettingChangedId);
            this._intervalSettingChangedId = null;
        }

        if (this._intervalToggleChangedId) {
            this.extension.settings.disconnect(this._intervalToggleChangedId);
            this._intervalToggleChangedId = null;
        }
        
        if (this._historyClearTimeoutId) {
            clearTimeout(this._historyClearTimeoutId);
            this._historyClearTimeoutId = null;
        }
    }

    _disconnectSelectionListener () {
        if (!this._selectionOwnerChangedId)
            return;

        this.selection.disconnect(this._selectionOwnerChangedId);
    }

    _clearDelayedSelectionTimeout () {
        if (this._delayedSelectionTimeoutId) {
            clearInterval(this._delayedSelectionTimeoutId);
        }
    }

    _selectEntryWithDelay (entry) {
        let that = this;
        that._selectMenuItem(entry, false);

        that._delayedSelectionTimeoutId = setTimeout(function () {
            that._selectMenuItem(entry);  //select the item
            that._delayedSelectionTimeoutId = null;
        }, DELAYED_SELECTION_TIMEOUT);
    }

    _previousEntry () {
        if (PRIVATEMODE) return;
        let that = this;

        that._clearDelayedSelectionTimeout();

        this._getAllIMenuItems().some(function (mItem, i, menuItems){
            if (mItem.currentlySelected) {
                i--;                                 //get the previous index
                if (i < 0) i = menuItems.length - 1; //cycle if out of bound
                let index = i + 1;                   //index to be displayed
                
                if(NOTIFY_ON_CYCLE) {
                    that._showNotification(index + ' / ' + menuItems.length + ': ' + menuItems[i].entry.getStringValue());
                }
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
        if (PRIVATEMODE) return;
        let that = this;

        that._clearDelayedSelectionTimeout();

        this._getAllIMenuItems().some(function (mItem, i, menuItems){
            if (mItem.currentlySelected) {
                i++;                                 //get the next index
                if (i === menuItems.length) i = 0;   //cycle if out of bound
                let index = i + 1;                     //index to be displayed

                if(NOTIFY_ON_CYCLE) {
                    that._showNotification(index + ' / ' + menuItems.length + ': ' + menuItems[i].entry.getStringValue());
                }
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

    #pasteItem (menuItem) {
        this.menu.close();
        const currentlySelected = this._getCurrentlySelectedItem();
        this.preventIndicatorUpdate = true;
        this.#updateClipboard(menuItem.entry);
        this._pastingKeypressTimeout = setTimeout(() => {
            if (this.keyboard.purpose === Clutter.InputContentPurpose.TERMINAL) {
                this.keyboard.press(Clutter.KEY_Control_L);
                this.keyboard.press(Clutter.KEY_Shift_L);
                this.keyboard.press(Clutter.KEY_Insert);
                this.keyboard.release(Clutter.KEY_Insert);
                this.keyboard.release(Clutter.KEY_Shift_L);
                this.keyboard.release(Clutter.KEY_Control_L);
            }
            else {
                this.keyboard.press(Clutter.KEY_Shift_L);
                this.keyboard.press(Clutter.KEY_Insert);
                this.keyboard.release(Clutter.KEY_Insert);
                this.keyboard.release(Clutter.KEY_Shift_L);
            }

            this._pastingResetTimeout = setTimeout(() => {
                this.preventIndicatorUpdate = false;
                this.#updateClipboard(currentlySelected.entry);
            }, 50);
        }, 50);
    }

    #clearTimeouts () {
        if (this._imagePreviewTimeout) clearTimeout(this._imagePreviewTimeout);
        if (this._setFocusOnOpenTimeout) clearTimeout(this._setFocusOnOpenTimeout);
        if (this._pastingKeypressTimeout) clearTimeout(this._pastingKeypressTimeout);
        if (this._pastingResetTimeout) clearTimeout(this._pastingResetTimeout);
        if (this._historyClearTimeoutId) clearTimeout(this._historyClearTimeoutId);
        if (this._timerIntervalId) clearInterval(this._timerIntervalId);
    }

    #clearClipboard () {
        this.extension.clipboard.set_text(CLIPBOARD_TYPE, "");
        this.#updateIndicatorContent(null);
    }

    #updateClipboard (entry) {
        this.extension.clipboard.set_content(CLIPBOARD_TYPE, entry.mimetype(), entry.asBytes());
        this.#updateIndicatorContent(entry);
    }

    async #getClipboardContent () {
        const mimetypes = [
            "text/plain;charset=utf-8",
            "UTF8_STRING",
            "text/plain",
            "STRING",
            'image/gif',
            'image/png',
            'image/jpg',
            'image/jpeg',
            'image/webp',
            'image/svg+xml',
            'text/html',
        ];

        for (let type of mimetypes) {
            let result = await new Promise(resolve => this.extension.clipboard.get_content(CLIPBOARD_TYPE, type, (clipBoard, bytes) => {
                if (bytes === null || bytes.get_size() === 0) {
                    resolve(null);
                    return;
                }

                // HACK: workaround for GNOME 2nd+ copy mangling mimetypes https://gitlab.gnome.org/GNOME/gnome-shell/-/issues/8233
                // In theory GNOME or XWayland should auto-convert this back to UTF8_STRING for legacy apps when it's needed https://gitlab.gnome.org/GNOME/gtk/-/merge_requests/5300
                if (type === "UTF8_STRING") {
                    type = "text/plain;charset=utf-8";
                }
                
                const entry = new ClipboardEntry(type, bytes.get_data(), false);
                if (CACHE_IMAGES && entry.isImage()) {
                    this.registry.writeEntryFile(entry);
                }
                resolve(entry);
            }));

            if (result) {
                if (!CACHE_IMAGES && result.isImage()) {
                    return null;
                }
                else {
                    return result;
                }
            }
        }

        return null;
    }
});
