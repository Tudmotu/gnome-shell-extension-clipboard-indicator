'use strict';

const { Clutter, Meta, Shell, St, GObject } = imports.gi;
const Mainloop = imports.mainloop;
const MessageTray = imports.ui.messageTray;

const Main = imports.ui.main;
const PanelMenu = imports.ui.panelMenu;
const PopupMenu = imports.ui.popupMenu;

const Gettext = imports.gettext;
const _ = Gettext.domain('clipboard-indicator').gettext;

const Clipboard = St.Clipboard.get_default();
const CLIPBOARD_TYPE = St.ClipboardType.CLIPBOARD;

const SETTING_KEY_CLEAR_HISTORY = 'clear-history';
const SETTING_KEY_PREV_ENTRY = 'prev-entry';
const SETTING_KEY_NEXT_ENTRY = 'next-entry';
const SETTING_KEY_TOGGLE_MENU = 'toggle-menu';
const INDICATOR_ICON = 'edit-paste-symbolic';

const IndicatorName = 'ClipboardIndicator';
const ExtensionUtils = imports.misc.extensionUtils;
const Me = ExtensionUtils.getCurrentExtension();
const Utils = Me.imports.utils;
const ConfirmDialog = Me.imports.confirmDialog;
const Prefs = Me.imports.prefs;

let MAX_REGISTRY_LENGTH;
let MAX_ENTRY_LENGTH;
let CACHE_ONLY_FAVORITES;
let MOVE_ITEM_FIRST;
let ENABLE_KEYBINDING;
let PRIVATEMODE;
let NOTIFY_ON_COPY;
let CONFIRM_ON_CLEAR;
let MAX_TOPBAR_LENGTH;
let TOPBAR_DISPLAY_MODE; //0 - only icon, 1 - only clipbord content, 2 - both
let DISABLE_DOWN_ARROW;
let STRIP_TEXT;

class ClipboardIndicator extends PanelMenu.Button {
  _init() {
    super._init(0, IndicatorName, false);

    this._shortcutsBindingIds = [];

    const hbox = new St.BoxLayout({
      style_class: 'panel-status-menu-box clipboard-indicator-hbox',
    });
    this.icon = new St.Icon({
      icon_name: INDICATOR_ICON,
      style_class: 'system-status-icon clipboard-indicator-icon',
    });
    hbox.add_child(this.icon);
    this._buttonText = new St.Label({
      text: _('Text will be here'),
      y_align: Clutter.ActorAlign.CENTER,
    });
    hbox.add_child(this._buttonText);
    this._downArrow = PopupMenu.arrowIcon(St.Side.BOTTOM);
    hbox.add(this._downArrow);
    this.add_child(hbox);

    this._loadSettings();
    this._buildMenu();
    this._updateTopbarLayout();
  }

  destroy() {
    this._disconnectSettings();
    this._unbindShortcuts();
    this._disconnectSelectionListener();
    this._clearDelayedSelectionTimeout();

    super.destroy();
  }

  _buildMenu() {
    Utils.buildClipboardStateFromLog((history, nextId) => {
      this.searchEntry = new St.Entry({
        name: 'searchEntry',
        style_class: 'search-entry',
        can_focus: true,
        hint_text: _('Type here to search...'),
        track_hover: true,
        x_expand: true,
        y_expand: true,
      });

      this.searchEntry
        .get_clutter_text()
        .connect('text-changed', this._onSearchTextChanged.bind(this));

      const entryItem = new PopupMenu.PopupBaseMenuItem({
        reactive: false,
        can_focus: false,
      });
      entryItem.add(this.searchEntry);
      this.menu.addMenuItem(entryItem);

      this.menu.connect('open-state-changed', (self, open) => {
        if (open) {
          global.stage.set_key_focus(this.searchEntry);
          this.searchEntry.set_text('');
        }
      });

      // Create menu sections for items
      // Favorites
      this.favoritesSection = new PopupMenu.PopupMenuSection();

      this.scrollViewFavoritesMenuSection = new PopupMenu.PopupMenuSection();
      const favoritesScrollView = new St.ScrollView({
        style_class: 'ci-history-menu-section',
        overlay_scrollbars: true,
      });
      favoritesScrollView.add_actor(this.favoritesSection.actor);

      this.scrollViewFavoritesMenuSection.actor.add_actor(favoritesScrollView);
      this.menu.addMenuItem(this.scrollViewFavoritesMenuSection);
      this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

      // History
      this.historySection = new PopupMenu.PopupMenuSection();

      this.scrollViewMenuSection = new PopupMenu.PopupMenuSection();
      const historyScrollView = new St.ScrollView({
        style_class: 'ci-history-menu-section',
        overlay_scrollbars: true,
      });
      historyScrollView.add_actor(this.historySection.actor);

      this.scrollViewMenuSection.actor.add_actor(historyScrollView);

      this.menu.addMenuItem(this.scrollViewMenuSection);

      // Add cached items
      this.nextId = nextId;
      this.fastLookupMap = {};
      for (let i = history.length - 1; i >= 0; i--) {
        this._addEntry(history[i], i === history.length - 1, true);
        this._insertEntryIntoFastLookupMap(history[i]);
      }

      // Add separator
      this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

      // Private mode switch
      this.privateModeMenuItem = new PopupMenu.PopupSwitchMenuItem(
        _('Private mode'),
        PRIVATEMODE,
        { reactive: true },
      );
      this.privateModeMenuItem.connect(
        'toggled',
        this._onPrivateModeSwitch.bind(this),
      );
      this.menu.addMenuItem(this.privateModeMenuItem);
      this._onPrivateModeSwitch();

      // Add 'Clear' button which removes all items from cache
      const clearMenuItem = new PopupMenu.PopupMenuItem(_('Clear history'));
      this.menu.addMenuItem(clearMenuItem);
      clearMenuItem.connect('activate', this._removeAll.bind(this));

      // Add 'Settings' menu item to open settings
      const settingsMenuItem = new PopupMenu.PopupMenuItem(_('Settings'));
      this.menu.addMenuItem(settingsMenuItem);
      settingsMenuItem.connect('activate', this._openSettings.bind(this));

      this._setupListener();
    });
  }

  _addEntry(entry, selectEntry, updateClipboard, insertIndex) {
    const menuItem = new PopupMenu.PopupMenuItem('');

    menuItem.entry = entry;
    entry.menuItem = menuItem;

    menuItem.connect(
      'activate',
      this._onMenuItemSelectedAndMenuClose.bind(this),
    );

    this._setEntryLabel(menuItem);

    // Favorite button
    const icon_name = entry.favorite
      ? 'starred-symbolic'
      : 'non-starred-symbolic';
    const iconfav = new St.Icon({
      icon_name: icon_name,
      style_class: 'system-status-icon',
    });

    const icofavBtn = new St.Button({
      style_class: 'ci-action-btn',
      can_focus: true,
      child: iconfav,
      x_align: Clutter.ActorAlign.END,
      x_expand: true,
      y_expand: true,
    });

    menuItem.actor.add_child(icofavBtn);
    icofavBtn.connect('button-press-event', () => {
      this._favoriteToggle(menuItem);
    });

    // Delete button
    const icon = new St.Icon({
      icon_name: 'edit-delete-symbolic', //'mail-attachment-symbolic',
      style_class: 'system-status-icon',
    });

    const icoBtn = new St.Button({
      style_class: 'ci-action-btn',
      can_focus: true,
      child: icon,
      x_align: Clutter.ActorAlign.END,
      x_expand: false,
      y_expand: true,
    });

    menuItem.actor.add_child(icoBtn);
    icoBtn.connect('button-press-event', () => {
      this._removeEntry(menuItem, true);
    });

    if (entry.favorite) {
      this.favoritesSection.addMenuItem(menuItem, insertIndex);
    } else {
      this.historySection.addMenuItem(menuItem, insertIndex);
    }

    if (selectEntry === true) {
      this._selectMenuItem(menuItem, updateClipboard);
    }
  }

  _insertEntryIntoFastLookupMap(entry) {
    if (entry.type === 'text') {
      let entries = this.fastLookupMap[entry.text.length];
      if (!entries) {
        entries = [];
        this.fastLookupMap[entry.text.length] = entries;
      }
      entries.push(entry);
    }
  }

  _fastTextEntryLookup(text) {
    const entries = this.fastLookupMap[text.length];
    if (!entries) {
      return null;
    }

    for (const entry of entries) {
      if (entry.type === 'text' && entry.text === text) {
        return entry;
      }
    }
    return null;
  }

  _removeEntryFromFastLookupMap(entry) {
    if (entry.type === 'text') {
      const entries = this.fastLookupMap[entry.text.length];
      entries.splice(entries.indexOf(entry.text), 1);
    }
  }

  _updateButtonText(menuItem) {
    if (
      !(TOPBAR_DISPLAY_MODE === 1 || TOPBAR_DISPLAY_MODE === 2) ||
      (menuItem && menuItem.entry.type !== 'text')
    ) {
      return;
    }

    if (PRIVATEMODE) {
      this._buttonText.set_text('...');
    } else if (menuItem) {
      this._buttonText.set_text(
        this._truncated(menuItem.entry.text, MAX_TOPBAR_LENGTH),
      );
    } else {
      this._buttonText.set_text('');
    }
  }

  _setEntryLabel(menuItem) {
    const entry = menuItem.entry;
    if (entry.type === 'text') {
      menuItem.label.set_text(this._truncated(entry.text, MAX_ENTRY_LENGTH));
    }
  }

  _favoriteToggle(menuItem) {
    const entry = menuItem.entry;
    const wasSelected = this.currentlySelectedMenuItem === menuItem;

    this._removeEntry(menuItem);
    entry.favorite = !entry.favorite;
    this._addEntry(entry, wasSelected, true, 0);

    if (CACHE_ONLY_FAVORITES) {
      if (entry.favorite) {
        entry.id = this.nextId++;

        Utils.storeTextEntry(entry.text);
        Utils.updateFavoriteStatus(entry.id, true);
      } else {
        Utils.deleteTextEntry(entry.id);
        delete entry.id;
      }
    } else {
      Utils.updateFavoriteStatus(entry.id, entry.favorite);
      Utils.moveEntryToEnd(entry.id);
    }
  }

  _removeAll() {
    if (CONFIRM_ON_CLEAR) {
      this._confirmRemoveAll();
    } else {
      this._clearHistory();
    }
  }

  _confirmRemoveAll() {
    const title = _('Clear all?');
    const message = _('Are you sure you want to delete all clipboard items?');
    const sub_message = _('This operation cannot be undone.');

    ConfirmDialog.openConfirmDialog(
      title,
      message,
      sub_message,
      _('Clear'),
      _('Cancel'),
      () => {
        this._clearHistory();
      },
    );
  }

  _clearHistory() {
    if (
      this.currentlySelectedMenuItem &&
      !this.currentlySelectedMenuItem.entry.favorite
    ) {
      this._resetSelectedMenuItem();
    }
    this.historySection.removeAll();

    // Rebuild the lookup map from scratch since presumably people have fewer favorites than actual
    // items.
    this.fastLookupMap = {};
    this.favoritesSection._getMenuItems().forEach((item) => {
      this._insertEntryIntoFastLookupMap(item.entry);
    });

    Utils.resetDatabase(this._currentStateBuilder.bind(this));
  }

  _removeEntry(menuItem, fullyDelete) {
    if (fullyDelete) {
      this._removeEntryFromFastLookupMap(menuItem.entry);

      if (menuItem.entry.id) {
        Utils.deleteTextEntry(menuItem.entry.id);
      }
    }

    if (menuItem === this.currentlySelectedMenuItem) {
      this._resetSelectedMenuItem();
    }
    menuItem.destroy();
  }

  _pruneOldestEntries() {
    // Favorites don't count, so only look at historySection
    const items = this.historySection._getMenuItems();
    let i = items.length - 1;
    while (i >= MAX_REGISTRY_LENGTH) {
      this._removeEntry(items[i--], true);
    }

    // TODO prune by num bytes

    Utils.maybePerformLogCompaction(this._currentStateBuilder.bind(this));
  }

  _selectMenuItem(menuItem, updateClipboard) {
    if (this.currentlySelectedMenuItem) {
      this.currentlySelectedMenuItem.setOrnament(PopupMenu.Ornament.NONE);
    }
    this.currentlySelectedMenuItem = menuItem;

    menuItem.setOrnament(PopupMenu.Ornament.DOT);
    this._updateButtonText(menuItem);
    if (updateClipboard !== false && menuItem.entry.type === 'text') {
      Clipboard.set_text(CLIPBOARD_TYPE, menuItem.entry.text);
    }
  }

  _onMenuItemSelectedAndMenuClose(menuItem) {
    this._selectMenuItem(menuItem);
    this.menu.close();
  }

  _resetSelectedMenuItem() {
    this.currentlySelectedMenuItem = undefined;
    this._updateButtonText();
    Clipboard.set_text(CLIPBOARD_TYPE, '');
  }

  /* When text change, this function will check, for each item of the
  historySection and favoritesSestion, if it should be visible or not (based on words contained
  in the clipContents attribute of the item). It doesn't destroy or create
  items. It the entry is empty, the section is restored with all items
  set as visible. */
  _onSearchTextChanged() {
    const searchedText = this.searchEntry.get_text().toLowerCase();

    if (searchedText === '') {
      this._getAllMenuItems().forEach((mItem) => {
        mItem.actor.visible = true;
      });
    } else {
      this._getAllMenuItems().forEach((mItem) => {
        const text = mItem.entry.text.toLowerCase();
        const isMatching = text.indexOf(searchedText) >= 0;
        mItem.actor.visible = isMatching;
      });
    }
  }

  _onSelectionChange(selection, selectionType, selectionSource) {
    if (selectionType === Meta.SelectionType.SELECTION_CLIPBOARD) {
      this._refreshIndicator();
    }
  }

  _refreshIndicator() {
    if (PRIVATEMODE) return; // Private mode, do not.

    Clipboard.get_text(CLIPBOARD_TYPE, (clipBoard, text) => {
      this._processClipboardContent(text);
    });
  }

  _processClipboardContent(text) {
    if (STRIP_TEXT) {
      text = text.trim();
    }
    if (!text) {
      return;
    }

    let entry = this._fastTextEntryLookup(text);
    if (entry) {
      this._selectMenuItem(entry.menuItem, false);
      if (MOVE_ITEM_FIRST) {
        let menu;
        if (entry.favorite) {
          menu = this.favoritesSection;
        } else {
          menu = this.historySection;
        }
        menu.moveMenuItem(entry.menuItem, 0);

        if (entry.id) {
          Utils.moveEntryToEnd(entry.id);
        }
      }
    } else {
      entry = {
        id: CACHE_ONLY_FAVORITES ? undefined : this.nextId++,
        type: 'text',
        text,
        favorite: false,
      };
      this._addEntry(entry, true, false, 0);

      this._insertEntryIntoFastLookupMap(entry);
      if (!CACHE_ONLY_FAVORITES) {
        Utils.storeTextEntry(text);
      }
      this._pruneOldestEntries();

      if (NOTIFY_ON_COPY) {
        this._showNotification(_('Copied to clipboard'), (notif) => {
          notif.addAction(_('Cancel'), this._cancelNotification.bind(this));
        });
      }
    }
  }

  _currentStateBuilder() {
    let state = this._getAllMenuItems();
    if (CACHE_ONLY_FAVORITES) {
      state = state.filter((item) => item.entry.favorite);
    }
    state = state.map((item) => item.entry);
    state.reverse();

    this.nextId = 1;
    for (const entry of state) {
      entry.id = this.nextId++;
    }

    return state;
  }

  _getAllMenuItems() {
    return this.historySection
      ._getMenuItems()
      .concat(this.favoritesSection._getMenuItems());
  }

  _setupListener() {
    const metaDisplay = Shell.Global.get().get_display();
    this._setupSelectionTracking(metaDisplay.get_selection());
  }

  _setupSelectionTracking(selection) {
    this.selection = selection;
    this._selectionOwnerChangedId = selection.connect(
      'owner-changed',
      (selection, selectionType, selectionSource) => {
        this._onSelectionChange(selection, selectionType, selectionSource);
      },
    );
  }

  _disconnectSelectionListener() {
    if (!this._selectionOwnerChangedId) {
      return;
    }

    this.selection.disconnect(this._selectionOwnerChangedId);
    this._selectionOwnerChangedId = undefined;
  }

  _openSettings() {
    ExtensionUtils.openPrefs();
  }

  _initNotifSource() {
    if (this._notifSource) {
      return;
    }

    this._notifSource = new MessageTray.Source(
      'ClipboardIndicator',
      INDICATOR_ICON,
    );
    this._notifSource.connect('destroy', () => {
      this._notifSource = undefined;
    });
    Main.messageTray.add(this._notifSource);
  }

  _cancelNotification() {
    this._removeEntry(this.currentlySelectedMenuItem, true);
    const nextItem = this.historySection.firstMenuItem;
    if (nextItem) {
      this._selectMenuItem(nextItem, true);
    }
  }

  _showNotification(message, transformFn) {
    this._initNotifSource();

    let notification;
    if (this._notifSource.count === 0) {
      notification = new MessageTray.Notification(this._notifSource, message);
    } else {
      notification = this._notifSource.notifications[0];
      notification.update(message, '', { clear: true });
    }

    if (typeof transformFn === 'function') {
      transformFn(notification);
    }

    notification.setTransient(true);
    this._notifSource.showNotification(notification);
  }

  _onPrivateModeSwitch() {
    PRIVATEMODE = this.privateModeMenuItem.state;

    // We hide the history in private ModeTypee because it will be out of sync
    // (selected item will not reflect clipboard)
    this.scrollViewMenuSection.actor.visible = !PRIVATEMODE;
    this.scrollViewFavoritesMenuSection.actor.visible = !PRIVATEMODE;

    if (PRIVATEMODE) {
      this.icon.add_style_class_name('private-mode');
      this._updateButtonText();
    } else {
      this.icon.remove_style_class_name('private-mode');
      if (this.currentlySelectedMenuItem) {
        this._selectMenuItem(this.currentlySelectedMenuItem, true);
      } else {
        this._resetSelectedMenuItem();
      }
    }
  }

  _loadSettings() {
    this._settingsChangedId = Prefs.Settings.connect(
      'changed',
      this._onSettingsChange.bind(this),
    );

    this._fetchSettings();

    if (ENABLE_KEYBINDING) {
      this._bindShortcuts();
    }
  }

  _fetchSettings() {
    MAX_REGISTRY_LENGTH = Prefs.Settings.get_int(Prefs.Fields.HISTORY_SIZE);
    MAX_ENTRY_LENGTH = Prefs.Settings.get_int(Prefs.Fields.PREVIEW_SIZE);
    CACHE_ONLY_FAVORITES = Prefs.Settings.get_boolean(
      Prefs.Fields.CACHE_ONLY_FAVORITES,
    );
    MOVE_ITEM_FIRST = Prefs.Settings.get_boolean(Prefs.Fields.MOVE_ITEM_FIRST);
    NOTIFY_ON_COPY = Prefs.Settings.get_boolean(Prefs.Fields.NOTIFY_ON_COPY);
    CONFIRM_ON_CLEAR = Prefs.Settings.get_boolean(
      Prefs.Fields.CONFIRM_ON_CLEAR,
    );
    ENABLE_KEYBINDING = Prefs.Settings.get_boolean(
      Prefs.Fields.ENABLE_KEYBINDING,
    );
    MAX_TOPBAR_LENGTH = Prefs.Settings.get_int(
      Prefs.Fields.TOPBAR_PREVIEW_SIZE,
    );
    TOPBAR_DISPLAY_MODE = Prefs.Settings.get_int(
      Prefs.Fields.TOPBAR_DISPLAY_MODE_ID,
    );
    DISABLE_DOWN_ARROW = Prefs.Settings.get_boolean(
      Prefs.Fields.DISABLE_DOWN_ARROW,
    );
    STRIP_TEXT = Prefs.Settings.get_boolean(Prefs.Fields.STRIP_TEXT);
    PRIVATEMODE = false; // TODO remove
  }

  _onSettingsChange() {
    const prevCacheOnlyFavorites = CACHE_ONLY_FAVORITES;

    this._fetchSettings();

    if (CACHE_ONLY_FAVORITES !== prevCacheOnlyFavorites) {
      if (CACHE_ONLY_FAVORITES) {
        this._getAllMenuItems().forEach((item) => {
          if (!item.entry.favorite) {
            Utils.deleteTextEntry(item.entry.id);
            delete item.entry.id;
          }
        });
      } else {
        let items = this._getAllMenuItems();
        for (let i = items.length - 1; i >= 0; i--) {
          const entry = items[i].entry;
          if (!entry.favorite) {
            entry.id = this.nextId++;
            Utils.storeTextEntry(entry.text);
          }
        }
      }
    }

    // Remove old entries in case the registry size changed
    this._pruneOldestEntries();

    // Re-set menu-items labels in case preview size changed
    this._getAllMenuItems().forEach((item) => {
      this._setEntryLabel(item);
    });

    this._updateTopbarLayout();
    if (this.currentlySelectedMenuItem) {
      this._updateButtonText(this.currentlySelectedMenuItem);
    }

    if (ENABLE_KEYBINDING) {
      this._bindShortcuts();
    } else {
      this._unbindShortcuts();
    }
  }

  _bindShortcuts() {
    this._unbindShortcuts();
    this._bindShortcut(SETTING_KEY_CLEAR_HISTORY, this._removeAll);
    this._bindShortcut(SETTING_KEY_PREV_ENTRY, this._previousEntry);
    this._bindShortcut(SETTING_KEY_NEXT_ENTRY, this._nextEntry);
    this._bindShortcut(SETTING_KEY_TOGGLE_MENU, () => this.menu.toggle());
  }

  _unbindShortcuts() {
    this._shortcutsBindingIds.forEach((id) => Main.wm.removeKeybinding(id));

    this._shortcutsBindingIds = [];
  }

  _bindShortcut(name, cb) {
    const ModeType = Shell.hasOwnProperty('ActionMode')
      ? Shell.ActionMode
      : Shell.KeyBindingMode;

    Main.wm.addKeybinding(
      name,
      Prefs.Settings,
      Meta.KeyBindingFlags.NONE,
      ModeType.ALL,
      cb.bind(this),
    );

    this._shortcutsBindingIds.push(name);
  }

  _updateTopbarLayout() {
    if (TOPBAR_DISPLAY_MODE === 0) {
      this.icon.visible = true;
      this._buttonText.visible = false;
    }
    if (TOPBAR_DISPLAY_MODE === 1) {
      this.icon.visible = false;
      this._buttonText.visible = true;
    }
    if (TOPBAR_DISPLAY_MODE === 2) {
      this.icon.visible = true;
      this._buttonText.visible = true;
    }
    this._downArrow.visible = !DISABLE_DOWN_ARROW;
  }

  _disconnectSettings() {
    if (!this._settingsChangedId) {
      return;
    }

    Prefs.Settings.disconnect(this._settingsChangedId);
    this._settingsChangedId = undefined;
  }

  _previousEntry() {
    this._clearDelayedSelectionTimeout();

    this._getAllMenuItems().some((mItem, i, menuItems) => {
      if (mItem === this.currentlySelectedMenuItem) {
        i--; //get the previous index
        if (i < 0) {
          i = menuItems.length - 1;
        } //cycle if out of bound
        const index = i + 1; //index to be displayed
        this._showNotification(
          index + ' / ' + menuItems.length + ': ' + menuItems[i].label.text,
        );
        if (MOVE_ITEM_FIRST) {
          this._selectEntryWithDelay(menuItems[i]);
        } else {
          this._selectMenuItem(menuItems[i]);
        }
        return true;
      }
      return false;
    });
  }

  _nextEntry() {
    this._clearDelayedSelectionTimeout();

    this._getAllMenuItems().some((mItem, i, menuItems) => {
      if (mItem === this.currentlySelectedMenuItem) {
        i++; //get the next index
        if (i === menuItems.length) {
          i = 0;
        } //cycle if out of bound
        const index = i + 1; //index to be displayed
        this._showNotification(
          index + ' / ' + menuItems.length + ': ' + menuItems[i].label.text,
        );
        if (MOVE_ITEM_FIRST) {
          this._selectEntryWithDelay(menuItems[i]);
        } else {
          this._selectMenuItem(menuItems[i]);
        }
        return true;
      }
      return false;
    });
  }

  _selectEntryWithDelay(entry) {
    this._selectMenuItem(entry, false);
    this._delayedSelectionTimeoutId = Mainloop.timeout_add(1000, () => {
      this._selectMenuItem(entry); //select the item

      this._delayedSelectionTimeoutId = null;
      return false;
    });
  }

  _clearDelayedSelectionTimeout() {
    if (this._delayedSelectionTimeoutId) {
      Mainloop.source_remove(this._delayedSelectionTimeoutId);
    }
  }

  _truncated(string, length) {
    // TODO optimize

    // Remove new lines and extra spaces so the text fits nicely on one line
    let shortened = string.replace(/\s+/g, ' ');

    if (shortened.length > length) {
      shortened = shortened.substring(0, length - 3) + '...';
    }

    return shortened;
  }
}
const ClipboardIndicatorObj = GObject.registerClass(ClipboardIndicator);

function init() {
  ExtensionUtils.initTranslations(IndicatorName);
}

let clipboardIndicator;

function enable() {
  Utils.init();

  clipboardIndicator = new ClipboardIndicatorObj();
  Main.panel.addToStatusArea(IndicatorName, clipboardIndicator, 1);
}

function disable() {
  clipboardIndicator.destroy();
  clipboardIndicator = undefined;
}
