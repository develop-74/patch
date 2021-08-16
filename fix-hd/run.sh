#!/bin/sh

f1='JSConfConnection.js'
p1='../../js/vmc'

f2='RTCConnectionClass.js'
p2='../../js/wconf/jmate/lib'

f3='ui.js'
p3='../../skin/zskin/js/wconf'

cp "$f1" "$p1"
echo "Сopy $f1 => $p1"

cp "$f2" "$p2"
echo "Сopy $f2 => $p2"

cp "$f3" "$p3"
echo "Сopy $f3 => $p3"

echo 'Done!'
