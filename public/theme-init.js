(function () {
  try {
    var p = localStorage.getItem('onpeer-theme') || 'system';
    var t = p === 'system' ? (window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark') : p;
    document.documentElement.setAttribute('data-theme', t);
  } catch (e) {}
})();
