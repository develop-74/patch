#!/bin/sh

f1='dojo_ROOT.js'
p1='../../js/moderator_panel_js/build/main/nls'

f2='ui_videoview.js'
p2='../../js/wconf'

cp "$f1" "$p1"
echo "Сopy $f1 => $p1"

cp "$f2" "$p2"
echo "Сopy $f2 => $p2"

echo 'Done!'
