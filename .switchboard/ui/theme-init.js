// Runs before first paint (classic script in <head>): applies the saved theme so nothing flashes.
// <html data-theme data-mode>, mode "system" follows the OS.
(function () {
  var THEMES = { glass: ['dark', 'light'], hearth: ['dark', 'light'], soft: ['dark', 'light'], graphite: ['dark', 'light'], aurora: ['dark'], signal: ['dark'] };
  var s = {};
  try { s = JSON.parse(localStorage.getItem('sb.appearance') || '{}') || {}; } catch (e) { s = {}; }
  var theme = THEMES[s.theme] ? s.theme : 'hearth'; // owner: Hearth is the default appearance
  var pref = s.mode === 'light' || s.mode === 'dark' ? s.mode : 'system';
  var want = pref === 'system' ? (window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches === false ? 'light' : 'dark') : pref;
  var mode = THEMES[theme].indexOf(want) >= 0 ? want : THEMES[theme][0];
  document.documentElement.setAttribute('data-theme', theme);
  document.documentElement.setAttribute('data-mode', mode);
})();
