# TEST ONLY: headers of elegoo-link 46c7b814 (the commit Elegoo v1.5.3.5 fetched), no library yet.
add_library(elegoolink::elegoolink INTERFACE IMPORTED)
set_target_properties(elegoolink::elegoolink PROPERTIES INTERFACE_INCLUDE_DIRECTORIES "/w/el/include")
set(elegoolink_FOUND TRUE)
