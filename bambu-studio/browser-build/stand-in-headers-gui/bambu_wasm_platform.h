// Force-included in Bambu Studio's GUI sources (C++): what the desktop toolchains supply and Emscripten's does not.
#pragma once
#ifdef __cplusplus
#include <cstdlib>
#include <string>
#include <wx/string.h>

// libstdc++ (Linux) has a generic std::char_traits<T>; libc++ 19+ (Emscripten, new Xcode) dropped it. Bambu parses
// JSON straight from a wxString (nlohmann::json::parse(wxString&): wide_string_input_adapter<..., wxUniChar>), which
// reads the characters through char_traits<wxUniChar>. The same members libstdc++'s generic template gives.
namespace std {
template <> struct char_traits<wxUniChar> {
    using char_type = wxUniChar;
    using int_type = unsigned int;
    static int_type to_int_type(const char_type &c) { return static_cast<int_type>(c.GetValue()); }
    static char_type to_char_type(const int_type &i) { return char_type(static_cast<wxUniChar::value_type>(i)); }
    static constexpr int_type eof() { return static_cast<int_type>(-1); }
    static bool eq_int_type(const int_type &a, const int_type &b) { return a == b; }
    static bool eq(const char_type &a, const char_type &b) { return a == b; }
    static bool lt(const char_type &a, const char_type &b) { return a.GetValue() < b.GetValue(); }
};
} // namespace std

// tinybvh's GCC branch takes aligned_alloc on __linux__ and MinGW's _aligned_malloc otherwise; Emscripten is
// neither. Its macro passes (alignment, size), as aligned_alloc takes them.
inline void *_aligned_malloc(size_t alignment, size_t size) { return aligned_alloc(alignment, size); }
#endif // __cplusplus

// GLEW on the desktop includes GLU (GLU_INVALID_ENUM in OpenGLManager.cpp); Emscripten's GL/glew.h does not. GLEW
// first, as on the desktop: GL/glu.h pulls GL/gl.h, and a GL/gl.h seen before GLEW hides GLEW's entry points.
#include <GL/glew.h>
#include <GL/glu.h>
