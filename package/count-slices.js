// Counts finished slices for the Boolean3d account this slicer was opened from (one small call per slice, nothing about
// the model). Only when the tab is linked (b3d-slicer-home); a tab opened by itself sends nothing.
// The program says a plate is sliced through its door (status: sliced); this asks it every few seconds while the tab is
// in view and sends one call each time "sliced" turns true. Fire and forget: a failed call is dropped.
(function () {
  if (typeof document === 'undefined' || typeof Module === 'undefined') return;
  var APP = (location.pathname.match(/^\/([a-z]+)\//) || [])[1] || '';
  var was = null, busy = false;
  function link() {
    try {
      var l = JSON.parse(localStorage.getItem('b3d-slicer-home') || 'null');
      return l && l.key && l.anon && /^https?:\/\//.test(l.door || '') ? l : null;
    } catch (e) { return null; }
  }
  function count() {
    var l = link();
    if (!l) return;
    fetch(l.door.replace(/\/functions\/v1\/.*$/, '/rest/v1/rpc/funnel_step'), { method: 'POST', keepalive: true,
      headers: { apikey: l.anon, Authorization: 'Bearer ' + l.anon, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_step: 'sliced', p_about: APP, p_key: l.key }) }).catch(function () {});
  }
  setInterval(function () {
    if (busy || document.hidden || typeof B3DDoor === 'undefined' || !link()) return;
    if (!(Module.wxRunning && Module.wxRunning())) return;
    busy = true;
    Promise.resolve(B3DDoor.act('status')).then(function (s) {
      busy = false;
      if (!s || !s.ok) return;
      var now = !!s.result.sliced;
      if (now && was === false) count();
      was = now;
    }, function () { busy = false; });
  }, 4000);
})();
