#!/usr/bin/env bash
xgettext -o clipboard-indicator.pot extension.js prefs.js utils.js
find locale/ -name \*.po -exec msgmerge -U {} clipboard-indicator.pot \;
glib-compile-schemas schemas/