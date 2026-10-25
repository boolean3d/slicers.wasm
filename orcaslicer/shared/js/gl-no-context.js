// --pre-js: an OpenGL call made while no GL context is current does nothing, as on desktop (libGL/libglvnd send
// calls with no current context to no-op stubs). Emscripten's GL functions read GLctx, which is undefined until the
// 3D view has made its context, so such a call threw and stopped the program. Seen in Orca 2.3.2 o6s (1 start in 2):
// MainFrame::on_config_changed -> Plater::set_bed_shape -> PartPlate::generate_plate_name_texture ->
// GLTexture::generate_from_text_string -> glPixelStorei "Cannot read properties of undefined (reading 'pixelStorei')"
// on a settings change before the 3D view's first paint. On desktop the texture stays 0 there and
// PartPlate::render_plate_name_texture makes it again on the first draw (id == 0); with this the browser does the same.
// Every gl* / emscripten_gl* import is wrapped once, just before the program is instantiated (main thread and threads).
Module['instantiateWasm'] = (info, done) => {
  const env = info.env;
  for (const k of Object.keys(env)) {
    const f = env[k];
    if (!/^(emscripten_)?gl[A-Z]/.test(k) || typeof f !== 'function' || f.b3dNoCtx) continue;
    const g = function (...a) { return GL.currentContext ? f.apply(this, a) : 0; };
    g.b3dNoCtx = true;
    env[k] = g;
  }
  if (ENVIRONMENT_IS_PTHREAD) { done(new WebAssembly.Instance(wasmModule, info), wasmModule); return {}; }
  wasmBinaryFile ??= findWasmBinary();
  instantiateAsync(wasmBinary, wasmBinaryFile, info).then((r) => done(r.instance, r.module), (e) => { err(`wasm instantiate failed: ${e}`); throw e; });
  return {};
};
