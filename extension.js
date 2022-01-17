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
const writeRegistry = Utils.writeRegistry;
const readRegistry = Utils.readRegistry;

let MAX_REGISTRY_LENGTH;
let MAX_ENTRY_LENGTH;
let CACHE_ONLY_FAVORITE;
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
    this.clipItemsRadioGroup = [];

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

    this._setupListener();
  }

  destroy() {
    this._disconnectSettings();
    this._unbindShortcuts();
    this._disconnectSelectionListener();
    this._clearDelayedSelectionTimeout();

    super.destroy();
  }

  _updateButtonText(content) {
    if (!content || PRIVATEMODE) {
      this._buttonText.set_text('...');
    } else {
      this._buttonText.set_text(this._truncate(content, MAX_TOPBAR_LENGTH));
    }
  }

  _buildMenu() {
    this._getCache((clipHistory) => {
      const lastIdx = clipHistory.length - 1;
      const clipItemsArr = this.clipItemsRadioGroup;

      /* This create the search entry, which is add to a menuItem.
            The searchEntry is connected to the function for research.
            The menu itself is connected to some shitty hack in order to
            grab the focus of the keyboard. */
      this._entryItem = new PopupMenu.PopupBaseMenuItem({
        reactive: false,
        can_focus: false,
      });
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

      this._entryItem.add(this.searchEntry);

      this.menu.addMenuItem(this._entryItem);

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
      clipHistory.forEach((buffer) => {
        if (typeof buffer === 'string') {
          // Old cache format
          this._addEntry(buffer);
        } else {
          this._addEntry(buffer['contents'], buffer['favorite']);
        }
      });

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

      if (lastIdx >= 0) {
        this._selectMenuItem(clipItemsArr[lastIdx]);
      }
    });
  }

  /* When text change, this function will check, for each item of the
    historySection and favoritesSestion, if it should be visible or not (based on words contained
    in the clipContents attribute of the item). It doesn't destroy or create
    items. It the entry is empty, the section is restored with all items
    set as visible. */
  _onSearchTextChanged() {
    const searchedText = this.searchEntry.get_text().toLowerCase();

    if (searchedText === '') {
      this._getAllIMenuItems().forEach((mItem) => {
        mItem.actor.visible = true;
      });
    } else {
      this._getAllIMenuItems().forEach((mItem) => {
        const text = mItem.clipContents.toLowerCase();
        const isMatching = text.indexOf(searchedText) >= 0;
        mItem.actor.visible = isMatching;
      });
    }
  }

  _truncate(string, length) {
    let shortened = string.replace(/\s+/g, ' ');

    if (shortened.length > length) {
      shortened = shortened.substring(0, length - 1) + '...';
    }

    return shortened;
  }

  _setEntryLabel(menuItem) {
    const buffer = menuItem.clipContents;
    menuItem.label.set_text(this._truncate(buffer, MAX_ENTRY_LENGTH));
  }

  _addEntry(buffer, favorite, autoSelect, autoSetClip) {
    const menuItem = new PopupMenu.PopupMenuItem('');

    menuItem.menu = this.menu;
    menuItem.clipContents = buffer;
    menuItem.clipFavorite = favorite;
    menuItem.radioGroup = this.clipItemsRadioGroup;
    menuItem._onMenuItemSelected = this._onMenuItemSelected;

    menuItem.connect(
      'activate',
      this._onMenuItemSelectedAndMenuClose.bind(menuItem),
    );

    this._setEntryLabel(menuItem);
    this.clipItemsRadioGroup.push(menuItem);

    // Favorite button
    const icon_name = favorite ? 'starred-symbolic' : 'non-starred-symbolic';
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
      this._removeEntry(menuItem, 'delete');
    });

    if (favorite) {
      this.favoritesSection.addMenuItem(menuItem, 0);
    } else {
      this.historySection.addMenuItem(menuItem, 0);
    }

    if (autoSelect === true) {
      this._selectMenuItem(menuItem, autoSetClip);
    }

    if (TOPBAR_DISPLAY_MODE === 1 || TOPBAR_DISPLAY_MODE === 2) {
      this._updateButtonText(buffer);
    }

    this._updateCache();
  }

  _favoriteToggle(menuItem) {
    menuItem.clipFavorite = !menuItem.clipFavorite;
    this._moveItemFirst(menuItem);

    this._updateCache();
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
    // We can't actually remove all items, because the clipboard still
    // has data that will be re-captured on next refresh, so we remove
    // all except the currently selected item
    // Don't remove favorites here
    this.historySection._getMenuItems().forEach((mItem) => {
      if (!mItem.currentlySelected) {
        const idx = this.clipItemsRadioGroup.indexOf(mItem);
        mItem.destroy();
        this.clipItemsRadioGroup.splice(idx, 1);
      }
    });
    this._updateCache();
    this._showNotification(_('Clipboard history cleared'));
  }

  _removeAll() {
    if (CONFIRM_ON_CLEAR) {
      this._confirmRemoveAll();
    } else {
      this._clearHistory();
    }
  }

  _removeEntry(menuItem, event) {
    const itemIdx = this.clipItemsRadioGroup.indexOf(menuItem);

    if (event === 'delete' && menuItem.currentlySelected) {
      Clipboard.set_text(CLIPBOARD_TYPE, '');
    }

    menuItem.destroy();
    this.clipItemsRadioGroup.splice(itemIdx, 1);

    this._updateCache();
  }

  _removeOldestEntries() {
    let clipItemsRadioGroupNoFavorite = this.clipItemsRadioGroup.filter(
      (item) => item.clipFavorite === false,
    );

    while (clipItemsRadioGroupNoFavorite.length > MAX_REGISTRY_LENGTH) {
      const oldestNoFavorite = clipItemsRadioGroupNoFavorite.shift();
      this._removeEntry(oldestNoFavorite);

      clipItemsRadioGroupNoFavorite = this.clipItemsRadioGroup.filter(
        (item) => item.clipFavorite === false,
      );
    }

    this._updateCache();
  }

  _onMenuItemSelected(autoSet) {
    this.radioGroup.forEach((menuItem) => {
      const clipContents = this.clipContents;

      if (menuItem === this && clipContents) {
        this.setOrnament(PopupMenu.Ornament.DOT);
        this.currentlySelected = true;
        if (autoSet !== false) {
          Clipboard.set_text(CLIPBOARD_TYPE, clipContents);
        }
      } else {
        menuItem.setOrnament(PopupMenu.Ornament.NONE);
        menuItem.currentlySelected = false;
      }
    });
  }

  _selectMenuItem(menuItem, autoSet) {
    const fn = this._onMenuItemSelected.bind(menuItem);
    fn(autoSet);
    if (TOPBAR_DISPLAY_MODE === 1 || TOPBAR_DISPLAY_MODE === 2) {
      this._updateButtonText(menuItem.label.text);
    }
  }

  _onMenuItemSelectedAndMenuClose(autoSet) {
    this._onMenuItemSelected(autoSet);
    this.menu.close();
  }

  _getCache(cb) {
    return readRegistry(cb);
  }

  _updateCache() {
    const registry = this.clipItemsRadioGroup.map((menuItem) => {
      return {
        contents: menuItem.clipContents,
        favorite: menuItem.clipFavorite,
      };
    });

    writeRegistry(
      registry.filter((menuItem) => {
        if (CACHE_ONLY_FAVORITE) {
          if (menuItem['favorite']) {
            return menuItem;
          }
        } else {
          return menuItem;
        }
      }),
    );
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

    if (text !== '' && text) {
      const registry = this.clipItemsRadioGroup.map((menuItem) => {
        return menuItem.clipContents;
      });

      const itemIndex = registry.indexOf(text);

      if (itemIndex < 0) {
        this._addEntry(text, false, true, false);
        this._removeOldestEntries();
        if (NOTIFY_ON_COPY) {
          this._showNotification(_('Copied to clipboard'), (notif) => {
            notif.addAction(_('Cancel'), this._cancelNotification.bind(this));
          });
        }
      } else if (itemIndex >= 0 && itemIndex < registry.length - 1) {
        const item = this._findItem(text);
        this._selectMenuItem(item, false);

        if (!item.clipFavorite && MOVE_ITEM_FIRST) {
          this._moveItemFirst(item);
        }
      }
    }
  }

  _moveItemFirst(item) {
    this._removeEntry(item);
    this._addEntry(
      item.clipContents,
      item.clipFavorite,
      item.currentlySelected,
      false,
    );
  }

  _findItem(text) {
    return this.clipItemsRadioGroup.filter(
      (item) => item.clipContents === text,
    )[0];
  }

  _getAllIMenuItems(text) {
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
  }

  _openSettings() {
    ExtensionUtils.openPrefs();
  }

  _initNotifSource() {
    if (!this._notifSource) {
      this._notifSource = new MessageTray.Source(
        'ClipboardIndicator',
        INDICATOR_ICON,
      );
      this._notifSource.connect('destroy', () => {
        this._notifSource = null;
      });
      Main.messageTray.add(this._notifSource);
    }
  }

  _cancelNotification() {
    if (this.clipItemsRadioGroup.length >= 2) {
      const clipSecond = this.clipItemsRadioGroup.length - 2;
      const previousClip = this.clipItemsRadioGroup[clipSecond];
      Clipboard.set_text(CLIPBOARD_TYPE, previousClip.clipContents);
      previousClip.setOrnament(PopupMenu.Ornament.DOT);
      previousClip.currentlySelected = true;
    } else {
      Clipboard.set_text(CLIPBOARD_TYPE, '');
    }
    const clipFirst = this.clipItemsRadioGroup.length - 1;
    this._removeEntry(this.clipItemsRadioGroup[clipFirst]);
  }

  _showNotification(message, transformFn) {
    let notification = null;

    this._initNotifSource();

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
    // We hide the history in private ModeTypee because it will be out of sync (selected item will not reflect clipboard)
    this.scrollViewMenuSection.actor.visible = !PRIVATEMODE;
    this.scrollViewFavoritesMenuSection.actor.visible = !PRIVATEMODE;
    // If we get out of private mode then we restore the clipboard to old state
    if (!PRIVATEMODE) {
      const selectList = this.clipItemsRadioGroup.filter(
        (item) => !!item.currentlySelected,
      );
      const that = this;
      Clipboard.get_text(CLIPBOARD_TYPE, (clipBoard, text) => {
        this._updateButtonText(text);
      });
      if (selectList.length) {
        this._selectMenuItem(selectList[0]);
      } else {
        // Nothing to return to, let's empty it instead
        Clipboard.set_text(CLIPBOARD_TYPE, '');
      }

      this.icon.remove_style_class_name('private-mode');
    } else {
      this._buttonText.set_text('...');
      this.icon.add_style_class_name('private-mode');
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
    CACHE_ONLY_FAVORITE = Prefs.Settings.get_boolean(
      Prefs.Fields.CACHE_ONLY_FAVORITE,
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
  }

  _onSettingsChange() {
    // Load the settings into variables
    this._fetchSettings();

    // Remove old entries in case the registry size changed
    this._removeOldestEntries();

    // Re-set menu-items lables in case preview size changed
    this._getAllIMenuItems().forEach((mItem) => {
      this._setEntryLabel(mItem);
    });

    //update topbar
    this._updateTopbarLayout();
    if (TOPBAR_DISPLAY_MODE === 1 || TOPBAR_DISPLAY_MODE === 2) {
      Clipboard.get_text(CLIPBOARD_TYPE, (clipBoard, text) => {
        this._updateButtonText(text);
      });
    }

    // Bind or unbind shortcuts
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
    this._bindShortcut(SETTING_KEY_TOGGLE_MENU, this._toggleMenu);
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
    this._settingsChangedId = null;
  }

  _clearDelayedSelectionTimeout() {
    if (this._delayedSelectionTimeoutId) {
      Mainloop.source_remove(this._delayedSelectionTimeoutId);
    }
  }

  _selectEntryWithDelay(entry) {
    this._selectMenuItem(entry, false);
    this._delayedSelectionTimeoutId = Mainloop.timeout_add(1000, () => {
      this._selectMenuItem(entry); //select the item

      this._delayedSelectionTimeoutId = null;
      return false;
    });
  }

  _previousEntry() {
    this._clearDelayedSelectionTimeout();

    this._getAllIMenuItems().some((mItem, i, menuItems) => {
      if (mItem.currentlySelected) {
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

    this._getAllIMenuItems().some((mItem, i, menuItems) => {
      if (mItem.currentlySelected) {
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

  _toggleMenu() {
    this.menu.toggle();
  }
}
const ClipboardIndicatorObj = GObject.registerClass(ClipboardIndicator);

function init() {
  ExtensionUtils.initTranslations(IndicatorName);
}

let clipboardIndicator;

function enable() {
  clipboardIndicator = new ClipboardIndicatorObj();
  Main.panel.addToStatusArea(IndicatorName, clipboardIndicator, 1);
}

function disable() {
  clipboardIndicator.destroy();
  clipboardIndicator = undefined;
}
