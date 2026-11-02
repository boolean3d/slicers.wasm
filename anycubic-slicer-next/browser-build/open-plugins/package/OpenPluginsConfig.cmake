# The browser build's OpenPlugins package: the modules are built in this tree (OpenPluginsWasm.cmake); every asked-for component
# that exists as OpenPlugins::<name> is found.
set(OpenPlugins_FOUND TRUE)
foreach (c IN LISTS OpenPlugins_FIND_COMPONENTS)
    if (TARGET OpenPlugins::${c})
        set(OpenPlugins_${c}_FOUND TRUE)
    else ()
        set(OpenPlugins_${c}_FOUND FALSE)
        if (OpenPlugins_FIND_REQUIRED_${c})
            set(OpenPlugins_FOUND FALSE)
            set(OpenPlugins_NOT_FOUND_MESSAGE "OpenPlugins::${c} is not built for the browser (OpenPluginsWasm.cmake)")
        endif ()
    endif ()
endforeach ()
