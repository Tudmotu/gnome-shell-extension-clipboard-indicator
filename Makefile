MODULES = extension.js confirmDialog.js locale/ metadata.json stylesheet.css LICENSE.rst README.rst prefs.js schemas/ utils.js
INSTALLPATH=~/.local/share/gnome-shell/extensions/clipboard-indicator@tudmotu.com/

all: compile-locales compile-settings

compile-settings:
	glib-compile-schemas --strict --targetdir=schemas/ schemas

compile-locales:
	$(foreach file, $(wildcard locale/*/LC_MESSAGES/*.po), \
		msgfmt $(file) -o $(subst .po,.mo,$(file));)

update-po-files:
	xgettext -L Python --from-code=UTF-8 -k_ -kN_ -o clipboard-indicator.pot *.js
	$(foreach file, $(wildcard locale/*/LC_MESSAGES/*.po), \
		msgmerge $(file) clipboard-indicator.pot -o $(file);)

install: all
	rm -rf $(INSTALLPATH)
	mkdir -p $(INSTALLPATH)
	cp -r $(MODULES) $(INSTALLPATH)/

bundle: all
	zip -r bundle.zip $(MODULES)
