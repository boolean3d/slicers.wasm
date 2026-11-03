// nanodbc spells its strings in ODBC's SQLCHAR (unsigned char; unsigned short with Unicode on) and asks std::char_traits
// for them. libc++ 19 and later (Emscripten 6) has char_traits only for the standard character types; the two ODBC ones
// are given here, with the plain definitions the old generic template had. Force-included for every C++ file (after-project.cmake).
#pragma once
#include <string>
#include <cstring>
#include <cwchar>
namespace std
{
template <class C> struct b3d_odbc_char_traits
{
    using char_type = C; using int_type = int; using off_type = streamoff; using pos_type = streampos; using state_type = mbstate_t;
    static void assign( char_type& a, const char_type& b ) noexcept { a = b; }
    static bool eq( char_type a, char_type b ) noexcept { return a == b; }
    static bool lt( char_type a, char_type b ) noexcept { return a < b; }
    static int compare( const char_type* a, const char_type* b, size_t n ) { for( size_t i = 0; i < n; ++i ) { if( a[i] < b[i] ) return -1; if( b[i] < a[i] ) return 1; } return 0; }
    static size_t length( const char_type* s ) { size_t n = 0; while( s[n] ) ++n; return n; }
    static const char_type* find( const char_type* s, size_t n, const char_type& c ) { for( size_t i = 0; i < n; ++i ) if( s[i] == c ) return s + i; return nullptr; }
    static char_type* move( char_type* d, const char_type* s, size_t n ) { return static_cast<char_type*>( memmove( d, s, n * sizeof( char_type ) ) ); }
    static char_type* copy( char_type* d, const char_type* s, size_t n ) { return static_cast<char_type*>( memcpy( d, s, n * sizeof( char_type ) ) ); }
    static char_type* assign( char_type* s, size_t n, char_type c ) { for( size_t i = 0; i < n; ++i ) s[i] = c; return s; }
    static int_type not_eof( int_type c ) noexcept { return eq_int_type( c, eof() ) ? 0 : c; }
    static char_type to_char_type( int_type c ) noexcept { return static_cast<char_type>( c ); }
    static int_type to_int_type( char_type c ) noexcept { return static_cast<int_type>( c ); }
    static bool eq_int_type( int_type a, int_type b ) noexcept { return a == b; }
    static int_type eof() noexcept { return -1; }
};
template <> struct char_traits<unsigned char> : b3d_odbc_char_traits<unsigned char> {};
template <> struct char_traits<unsigned short> : b3d_odbc_char_traits<unsigned short> {};
}
// nlohmann::json::parse( wxString ) walks the string as wxUniChar (an int-convertible class) and asks std::char_traits for
// it too (its own char_traits<T> primary template derives from std's). Declared here, defined by wx later; the members
// above are instantiated only when used, after wx's header has made the type complete.
class wxUniChar;
namespace std { template <> struct char_traits<wxUniChar> : b3d_odbc_char_traits<wxUniChar> {}; }
