#!/bin/bash
xgettext -L Python --from-code=UTF-8 -k_ -kN_ -o ./po/clipboard-indicator.pot *.js
for f in ./po/*.po
do
    msgmerge $f ./po/clipboard-indicator.pot -o $f
done
