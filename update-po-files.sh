#!/bin/bash
xgettext -L Python --from-code=UTF-8 -k_ -kN_ -o clipboard-indicator.pot *.js
for f in locale/*/LC_MESSAGES/*.po
do
    msgmerge $f clipboard-indicator.pot -o $f
done
