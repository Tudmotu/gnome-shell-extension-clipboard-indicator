MODULES = *.js locale/*/LC_MESSAGES/*.mo metadata.json stylesheet.css LICENSE.rst README.md schemas/
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
	cp -r --parents $(MODULES) $(INSTALLPATH)
	mkdir -p ~/.local/share/glib-2.0/schemas/
	cp schemas/org.gnome.shell.extensions.clipboard-indicator.gschema.xml ~/.local/share/glib-2.0/schemas/
	glib-compile-schemas ~/.local/share/glib-2.0/schemas/

nested-session:
	dbus-run-session -- env MUTTER_DEBUG_NUM_DUMMY_MONITORS=1 \
		MUTTER_DEBUG_DUMMY_MODE_SPECS=2048x1536 \
		MUTTER_DEBUG_DUMMY_MONITOR_SCALES=2 gnome-shell --nested --wayland

bundle: all
	zip -FSr bundle.zip $(MODULES)
