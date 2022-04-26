============================
Clipboard Indicator
============================

Clipboard Manager extension for Gnome-Shell - Adds a clipboard indicator to the top panel, and caches clipboard history.

Extension page on e.g.o:
https://extensions.gnome.org/extension/779/clipboard-indicator/

Installation
----------------

Installation via git is performed by cloning the repo into your local gnome-shell extensions directory (usually ~/.local/share/gnome-shell/extensions/)::

    $ git clone https://github.com/Tudmotu/gnome-shell-extension-clipboard-indicator.git <extensions-dir>/clipboard-indicator@tudmotu.com

After cloning the repo, the extension is practically installed yet disabled. In order to enable it, run the following command::

    $ gnome-extensions enable clipboard-indicator@tudmotu.com


GNOME Version Support
--------------------------
With GNOME 40, many internal APIs were replaced which meant the extension had to drop backwards compatibility. Please note that versions v38 and v39 only support GNOME 40 and 41. Version v42 and later only supports GNOME 42 and above.

If you are using a GNOME version earlier than 40 (e.g. 3.38, 3.36, etc), please use v37 of this extension.

Contribution
----------------
Contributions to this project are welcome.

Please follow these guidelines when contributing:

- If you want to contribute code, your best bet is to look for an issue with the label "Up for grabs"
- DO NOT open unsolicited PRs unless they are for updating translations
- Look at the list of previous PRs before you open a PR, if your PR conflicts with another, it will be rejected
- If you have a feature idea, open an issue and discuss it there before implementing. DO NOT open a PR as a platform for discussion

Note: I have very little time to maintain this project, so expect long (months) of response time. Apologies in advance.
