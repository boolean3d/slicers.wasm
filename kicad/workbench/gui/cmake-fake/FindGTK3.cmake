# No GTK in a browser tab: PrusaSlicer's Linux GTK hacks are compiled out (__WXGTK__ is not defined on the wasm port).
set(GTK3_FOUND TRUE)
set(GTK3_LIBRARIES "")
set(GTK3_INCLUDE_DIRS "")
