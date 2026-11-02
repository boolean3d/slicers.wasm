// std::char_traits<unsigned char>, which libc++ 19 removed (only char, wchar_t, char8/16/32_t remain).
// Paho MQTT C++ (Snapmaker's src/mqtt) keeps binary payloads as std::basic_string<uint8_t>; desktop builds use
// libstdc++ / older libc++ that still had the generic template. Byte-wise traits, the same as char's.
#pragma once
#ifdef __cplusplus
#include <cstring>
#include <cwchar>
#include <iosfwd>
namespace std {
template <> struct char_traits<unsigned char> {
    using char_type = unsigned char; using int_type = unsigned int; using off_type = streamoff;
    using pos_type = streampos; using state_type = mbstate_t;
    static constexpr void assign(char_type& a, const char_type& b) noexcept { a = b; }
    static constexpr bool eq(char_type a, char_type b) noexcept { return a == b; }
    static constexpr bool lt(char_type a, char_type b) noexcept { return a < b; }
    static constexpr int compare(const char_type* a, const char_type* b, size_t n) noexcept {
        for (size_t i = 0; i < n; ++i) { if (a[i] < b[i]) return -1; if (b[i] < a[i]) return 1; } return 0; }
    static constexpr size_t length(const char_type* s) noexcept { size_t n = 0; while (s[n]) ++n; return n; }
    static constexpr const char_type* find(const char_type* s, size_t n, const char_type& c) noexcept {
        for (size_t i = 0; i < n; ++i) if (s[i] == c) return s + i; return nullptr; }
    static char_type* move(char_type* d, const char_type* s, size_t n) noexcept { return n ? (char_type*)std::memmove(d, s, n) : d; }
    static char_type* copy(char_type* d, const char_type* s, size_t n) noexcept { return n ? (char_type*)std::memcpy(d, s, n) : d; }
    static char_type* assign(char_type* d, size_t n, char_type c) noexcept { return n ? (char_type*)std::memset(d, c, n) : d; }
    static constexpr int_type not_eof(int_type c) noexcept { return eq_int_type(c, eof()) ? ~eof() : c; }
    static constexpr char_type to_char_type(int_type c) noexcept { return char_type(c); }
    static constexpr int_type to_int_type(char_type c) noexcept { return int_type(c); }
    static constexpr bool eq_int_type(int_type a, int_type b) noexcept { return a == b; }
    static constexpr int_type eof() noexcept { return int_type(-1); }
};
}
#endif
