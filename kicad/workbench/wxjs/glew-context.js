// --js-library: glewInit fails when no GL context is current, as desktop GLEW does (glewInit with no context returns
// GLEW_ERROR_NO_GL_VERSION). Emscripten's stub always says GLEW_OK, so Bambu/Orca's OpenGLManager::init_gl, reached
// from a settings change (GCodeViewer::get_renderer) before the 3D view has made its context, went on to
// glewGetExtension and threw "Cannot read properties of undefined (reading 'getSupportedExtensions')": the program
// stopped on the start screen (whenever the settings change came before the 3D view's first paint). With this,
// init_gl returns false there and runs again once the 3D view has its context, as on desktop.
addToLibrary({
  glewInit__deps: ['$GL'],
  glewInit: () => (GL.currentContext ? 0 : 1),
});
