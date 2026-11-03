# Python's bundled expat as its own archive for the browser link: its exported names carry the PyExpat_ prefix (pyexpat_namespace.h)
# but one internal helper does not and clashes with the expat KiCad and wx link; renamed here. -> /w/prefix-py/lib/libpyexpat.a
set -e
cd /w/kdeps/src/Python-3.12.11/build-wasm
F="$(grep '^LIBEXPAT_CFLAGS=' Makefile | sed 's/^LIBEXPAT_CFLAGS=//; s/\$(srcdir)/../g; s/\$(PY_STDMODULE_CFLAGS)//; s/\$(CCSHARED)//') -O2 -pthread -fwasm-exceptions -sSUPPORT_LONGJMP=wasm -I../Include -I. -D_INTERNAL_trim_to_complete_utf8_characters=PyExpat_INTERNAL_trim_to_complete_utf8_characters -w"
rm -rf pyexpat-obj && mkdir pyexpat-obj
for f in ../Modules/expat/xmlparse.c ../Modules/expat/xmlrole.c ../Modules/expat/xmltok.c; do emcc $F -c $f -o pyexpat-obj/$(basename $f .c).o; done
rm -f /w/prefix-py/lib/libpyexpat.a && emar rcs /w/prefix-py/lib/libpyexpat.a pyexpat-obj/*.o
echo PYEXPAT-OK
