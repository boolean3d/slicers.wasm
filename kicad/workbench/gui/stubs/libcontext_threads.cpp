// libcontext for the browser build. KiCad's tools are coroutines (include/tool/coroutine.h) that switch stacks with
// libcontext's assembly, which WebAssembly has no way to do. Here each context is a thread that runs only while it holds
// the baton: one context runs at a time, as with real stack switching; jump_fcontext() hands the baton to the other
// context and waits for it back, make_fcontext() starts a parked thread that calls the function on its first jump,
// release_fcontext() ends a parked thread without unwinding it (libcontext frees a stack the same way).
//
// A thread is a Web Worker with its own copy of the program's JavaScript, so the wx port's JS state (windowMap,
// contextMap, bitmaps, fonts: wx.js, wxgc.js) exists only in the worker of the thread that created it, the program's main
// thread. A tool measuring text or drawing on its own thread reached an empty map ("Cannot read properties of undefined
// (reading 'context')" in createWindowContext, 10-25). So EM_ASM calls made on a coroutine thread are carried out by
// the main thread (the "host"): the linker wraps emscripten_asm_const_{int,double,ptr} (programs.cmake), the wrapper
// hands the call to the host, which waits for the baton with Atomics.waitAsync (a JSPI suspension, so its worker's event
// loop keeps turning: input and page replies arrive) and runs each request in its own JavaScript.
// Whole pieces of work that must run where the wx port's and WebGL's state live (KiCad's OpenGL drawing: the WebGL
// context exists only in the main thread's worker) are handed over the same way: kc_run_on_host (kc_tool_thread.h in
// the KiCad tree) runs a function on the host while the asking tool waits (kicad-crash-1, 10-26: Ctrl+A, rotate and
// delete repaint the board from the selection/edit tool's thread and aborted in WebGL).
// Not covered: EM_ASYNC_JS waits on a coroutine thread (a top-level window made by a tool waits for its canvas in the
// wrong worker), EM_JS functions (glcanvas.cpp; the 3D viewer is not in the spike).
#include <libcontext.h>
#include <emscripten.h>
#include <emscripten/threading.h>
#include <emscripten/console.h>
#include <pthread.h>
#include <mutex>
#include <condition_variable>
#include <atomic>
#include <cstdlib>
#include <cstdarg>
#include <cstdio>
#include <exception>

extern "C" {
int    __real_emscripten_asm_const_int( const char* code, const char* sig, void* args );
double __real_emscripten_asm_const_double( const char* code, const char* sig, void* args );
void*  __real_emscripten_asm_const_ptr( const char* code, const char* sig, void* args );
}

namespace libcontext
{
struct REQ;

struct CTX
{
    std::mutex              m;
    std::condition_variable cv;
    bool                    go = false;
    bool                    die = false;
    intptr_t                value = 0;
    void ( *fn )( intptr_t ) = nullptr;
    pthread_t               thread{};
    bool                    owned = false;   // a thread made by make_fcontext (a record made by jump_fcontext is the calling thread's own)
    bool                    coroutine = false;
    std::atomic<int>        signal{ 0 };     // the host's: bit 1 = the baton is back, bit 2 = a request waits
    REQ*                    req = nullptr;   // the host's: the request a coroutine thread posted
};

struct REQ
{
    int         kind;   // 0 int, 1 double, 2 pointer, 3 a function (fn( fnArg ))
    const char* code;
    const char* sig;
    void*       args;
    int         ri = 0;
    double      rd = 0;
    void*       rp = nullptr;
    CTX*        from = nullptr;
    bool        done = false;
    void ( *fn )( void* ) = nullptr;
    void*       fnArg = nullptr;
    std::exception_ptr error;   // kind 3: what the function threw on the host, thrown again on the asking thread
};

enum { SIG_BATON = 1, SIG_REQUEST = 2 };

static thread_local CTX* self = nullptr;
static CTX*              host = nullptr;   // the thread that runs the tools (the program's main thread)
static CTX* current() { if( !self ) self = new CTX(); return self; }

// The host's wait: suspends this wasm stack (JSPI) until the value at flag changes from seen.
// Returns 1 when 3 s passed with no change (the host then says so: a tool that never gives the baton back is a hang).
EM_ASYNC_JS( int, kc_host_wait, ( int* flag, int seen ), {
    var r = Atomics.waitAsync( HEAP32, flag >> 2, seen );
    if( !r.async ) return 0;
    var t = new Promise( function( ok ) { setTimeout( function() { ok( 1 ); }, 3000 ); } );
    return await Promise.race( [ r.value.then( function() { return 0; } ), t ] );
} );
static CTX* last_given = nullptr;   // the coroutine the host handed the baton to last
static long  served = 0;

static void serve( REQ* r )
{
    switch( r->kind )
    {
    case 0: r->ri = __real_emscripten_asm_const_int( r->code, r->sig, r->args ); break;
    case 1: r->rd = __real_emscripten_asm_const_double( r->code, r->sig, r->args ); break;
    case 2: r->rp = __real_emscripten_asm_const_ptr( r->code, r->sig, r->args ); break;
    default:
        try { r->fn( r->fnArg ); }
        catch( ... ) { r->error = std::current_exception(); }
        break;
    }
    { std::lock_guard<std::mutex> l( r->from->m ); r->done = true; }
    r->from->cv.notify_one();
}

static void signal_host( CTX* c, int bit )
{
    c->signal.fetch_or( bit );
    emscripten_futex_wake( &c->signal, 0x7fffffff );
}

// On a coroutine thread: the host carries the call out
static void ask( REQ* r )
{
    r->from = self;
    { std::lock_guard<std::mutex> l( host->m ); host->req = r; }
    signal_host( host, SIG_REQUEST );
    std::unique_lock<std::mutex> l( self->m );
    self->cv.wait( l, [r] { return r->done; } );
}

static void wait_baton( CTX* c )
{
    if( c == host )
    {
        for( ;; )
        {
            int s = c->signal.load();
            if( s & SIG_REQUEST )
            {
                c->signal.fetch_and( ~SIG_REQUEST );
                REQ* r;
                { std::lock_guard<std::mutex> l( c->m ); r = c->req; c->req = nullptr; }
                if( r ) { serve( r ); served++; }
                continue;
            }
            if( s & SIG_BATON )
            {
                c->signal.fetch_and( ~SIG_BATON );
                break;
            }
            if( kc_host_wait( reinterpret_cast<int*>( &c->signal ), s ) )
                emscripten_console_logf( "libcontext: the main thread has waited 3 s for a tool (context %p, thread %lu, %ld requests served so far)",
                        (void*) last_given, (unsigned long) ( last_given ? last_given->thread : 0 ), served );
        }
        std::lock_guard<std::mutex> l( c->m );
        c->go = false;
        return;
    }
    std::unique_lock<std::mutex> l( c->m );
    c->cv.wait( l, [c] { return c->go; } );
    c->go = false;
    if( c->die ) { l.unlock(); pthread_exit( nullptr ); }
}

static void give_baton( CTX* c, intptr_t v )
{
    { std::lock_guard<std::mutex> l( c->m ); c->value = v; c->go = true; }
    if( c == host )
        signal_host( c, SIG_BATON );
    c->cv.notify_one();
}

static void* thread_main( void* p )
{
    CTX* c = static_cast<CTX*>( p );
    self = c;
    wait_baton( c );
    c->fn( c->value );
    abort();   // a context function never returns (libcontext: the program would exit)
    return nullptr;
}

extern "C" {

fcontext_t LIBCONTEXT_CALL_CONVENTION make_fcontext( void* sp, size_t size, void ( *fn )( intptr_t ) )
{
    (void) sp;   // the caller's stack memory stays unused: the thread brings its own
    CTX* c = new CTX();
    c->fn = fn; c->owned = true; c->coroutine = true;
    pthread_attr_t a; pthread_attr_init( &a );
    pthread_attr_setstacksize( &a, size < ( 1u << 20 ) ? ( 1u << 20 ) : size );
    int rc = pthread_create( &c->thread, &a, thread_main, c );
    pthread_attr_destroy( &a );
    if( rc != 0 ) { delete c; return nullptr; }
    return c;
}

intptr_t LIBCONTEXT_CALL_CONVENTION jump_fcontext( fcontext_t* ofc, fcontext_t nfc, intptr_t vp, bool )
{
    CTX* me = current();
    if( !host && !me->coroutine )
        host = me;   // the first thread that enters a coroutine runs the tools: its worker holds the wx port's JS state
    *ofc = me;
    if( me == host )
        last_given = static_cast<CTX*>( nfc );
    give_baton( static_cast<CTX*>( nfc ), vp );
    wait_baton( me );
    return me->value;
}

void LIBCONTEXT_CALL_CONVENTION release_fcontext( fcontext_t ctx )
{
    CTX* c = static_cast<CTX*>( ctx );
    if( !c || c == self || !c->owned )
        return;   // a thread's own record lives as long as the thread
    { std::lock_guard<std::mutex> l( c->m ); c->die = true; c->go = true; }
    c->cv.notify_one();
    pthread_join( c->thread, nullptr );
    delete c;
}

// The wrapped EM_ASM entry points (wasm32 passes the variadic arguments as one pointer to their buffer: va_list is that pointer)
static inline void* arg_buffer( va_list& ap ) { return *reinterpret_cast<void**>( &ap ); }
static inline bool on_coroutine() { return self && self->coroutine && host; }

int __wrap_emscripten_asm_const_int( const char* code, const char* sig, ... )
{
    va_list ap; va_start( ap, sig ); void* args = arg_buffer( ap ); va_end( ap );
    if( !on_coroutine() ) return __real_emscripten_asm_const_int( code, sig, args );
    REQ r{ 0, code, sig, args }; ask( &r ); return r.ri;
}

double __wrap_emscripten_asm_const_double( const char* code, const char* sig, ... )
{
    va_list ap; va_start( ap, sig ); void* args = arg_buffer( ap ); va_end( ap );
    if( !on_coroutine() ) return __real_emscripten_asm_const_double( code, sig, args );
    REQ r{ 1, code, sig, args }; ask( &r ); return r.rd;
}

void* __wrap_emscripten_asm_const_ptr( const char* code, const char* sig, ... )
{
    va_list ap; va_start( ap, sig ); void* args = arg_buffer( ap ); va_end( ap );
    if( !on_coroutine() ) return __real_emscripten_asm_const_ptr( code, sig, args );
    REQ r{ 2, code, sig, args }; ask( &r ); return r.rp;
}

// kc_tool_thread.h: is this a tool (coroutine) thread, and run a function on the main thread while this one waits
bool kc_on_tool_thread() { return on_coroutine(); }

void kc_run_on_host( void ( *fn )( void* ), void* arg )
{
    if( !on_coroutine() ) { fn( arg ); return; }
    REQ r{ 3, nullptr, nullptr, nullptr };
    r.fn = fn; r.fnArg = arg;
    ask( &r );
    if( r.error ) std::rethrow_exception( r.error );
}

// the wx port's hand-over to the main thread (shared wx edit z73: its GL contexts and canvas elements live in the main
// thread's worker; glcanvas.cpp declares this weak and calls it from any other thread)
void wxWasmRunOnMainThread( void ( *fn )( void* ), void* arg ) { kc_run_on_host( fn, arg ); }

}   // extern "C"
}   // namespace libcontext
