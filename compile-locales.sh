#!/bin/bash

for f in locale/*/LC_MESSAGES/*.po
do
    out=${f/.po/.mo}
    msgfmt $f -o $out
done
