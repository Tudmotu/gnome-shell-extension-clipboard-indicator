============================
Clipboard Indicator - Forked
============================

Clipboard Manager extension for Gnome-Shell - Adds a clipboard indicator to the top panel, and caches clipboard history.

I will keep this mod-extension while Mutter PR 1812 is not merge(https://gitlab.gnome.org/GNOME/mutter/-/merge_requests/1812), after that I will make a Pull Request to master. 

Features
----------------
1º) Support for images. (enable by default.)

2º) Max history is 2000 (Not recommended more than 200 for low-end PC)

Installation
----------------

Installation via terminal::

    $ mkdir ~/.local/share/gnome-shell/extensions/clipboard-indicator@ruiguilherme.com

    $ git clone https://github.com/RuiGuilherme/gnome-shell-extension-clipboard-indicator.git ~/.local/share/gnome-shell/extensions/clipboard-indicator@ruiguilherme.com

reload gnome-shell pressing Alt + F2 and entering r::

    $ gnome-extensions enable clipboard-indicator@ruiguilherme.com
    
Known issue
----------------
Enable png images may not work without this patch: https://gitlab.gnome.org/GNOME/mutter/-/merge_requests/1812 you need to wait mutter merge ir or apply, compile and install by yourself. - YOU CAN ENABLE OR DISABLE PNG IMAGES ON SETTINGS MENU.
