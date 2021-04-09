============================
Clipboard Indicator - Forked
============================

Clipboard Manager extension for Gnome-Shell - Adds a clipboard indicator to the top panel, and caches clipboard history.

Extension page on e.g.o:  Not yet!

Support only Gnome Shell >= 40; Not work with 3.38 or lower.

Installation
----------------

Installation via terminal::

    $ mkdir ~/.local/share/gnome-shell/extensions/clipboard-indicator@tudmotu.com

    $ git clone https://github.com/RuiGuilherme/gnome-shell-extension-clipboard-indicator.git ~/.local/share/gnome-shell/extensions/clipboard-indicator@tudmotu.com

reload gnome-shell pressing Alt + F2 and entering r::

    $ gnome-extensions enable clipboard-indicator@tudmotu.com
    
Known issue
----------------
Enable png images may not work without this patch: https://gitlab.gnome.org/GNOME/mutter/-/merge_requests/1812 you need to wait mutter merge ir or apply, compile and install by yourself.

Contributing
----------------
Contributions, issues and feature requests are welcome!
