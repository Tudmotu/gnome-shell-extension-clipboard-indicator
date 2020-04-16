# Basic Makefile

EXT_NAME = clipboard-indicator
UUID = $(EXT_NAME)@tudmotu.com
BUNDLE = $(UUID).shell-extension.zip

all: pack

pack:
	@gnome-extensions pack --force --extra-source=utils.js --extra-source=README.rst --extra-source=LICENSE.rst
	@echo extension packed!

install: pack
	@gnome-extensions install $(BUNDLE) --force
	@echo extension installed!

test_wayland: install
	# https://wiki.gnome.org/Projects/GnomeShell/Extensions/Writing#Extension_Creation
	@dbus-run-session -- gnome-shell --nested --wayland
