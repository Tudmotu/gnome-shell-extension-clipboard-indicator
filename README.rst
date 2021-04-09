============================
Clipboard Indicator - Forked
============================

Clipboard Manager extension for Gnome-Shell - Adds a clipboard indicator to the top panel, and caches clipboard history.

Extension page on e.g.o:  Not yet!

Support only FOR Gnome Shell 40+; 

For Gnome Shell 3.38 or lower check Release Tag version 37 or most old. (No support for images.)

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

Contributing
----------------
Contributions, issues and feature requests are welcome!
