============================
Clipboard Indicator
============================

Clipboard Manager extension for Gnome-Shell - Adds a clipboard indicator to the top panel, and caches clipboard history.

Extension page on e.g.o:
https://extensions.gnome.org/extension/779/clipboard-indicator/

Installation
----------------

Installation via git is performed by cloning the repo and Makefile::

    $ git clone https://github.com/Tudmotu/gnome-shell-extension-clipboard-indicator.git
    $ make install
    $ make test

After installing the extension is practically installed yet disabled. In
order to enable it, you need to use gnome-tweak-tool - find the extension,
titled 'Clipboard Indicator', in the 'Extensions' screen and turn it 'On'.
You may need to restart the shell (Alt+F2 and insert 'r' in the prompt) for the
extension to be listed there.
