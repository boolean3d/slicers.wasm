// Network for a slicer in a tab (a --pre-js; runs on the page and in every thread). The program's own HTTP stack
// (libcurl + OpenSSL in the wasm, Emscripten's sockets) opens each TCP connection as a WebSocket to
// ws://<host>:<port>/, which no web server answers. Those go to the page host's relay instead
// (<page folder>/relay?to=host:port, relay.mjs), which opens the TCP connection and passes bytes both ways. TLS stays
// end to end inside the wasm (the relay sees only encrypted bytes); the program checks certificates itself.
(function () {
  if (typeof WebSocket === 'undefined' || typeof location === 'undefined' || WebSocket.slicerRelay) return;
  var Native = WebSocket;
  var Relayed = function (url, protocols) {
    var m = /^wss?:\/\/([^\/:?#]+):(\d+)\/?$/.exec(String(url));
    if (m) {
      var u = new URL((typeof Module !== 'undefined' && Module.relayUrl) || 'relay', location.href);
      u.protocol = u.protocol === 'https:' ? 'wss:' : 'ws:';
      u.searchParams.set('to', m[1] + ':' + m[2]);
      url = u.href;
    }
    return protocols === undefined ? new Native(url) : new Native(url, protocols);
  };
  Relayed.prototype = Native.prototype;
  ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED'].forEach(function (k) { Relayed[k] = Native[k]; });
  Relayed.slicerRelay = true;
  globalThis.WebSocket = Relayed;
})();
