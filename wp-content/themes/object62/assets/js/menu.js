(function(){
  var tabs = document.querySelectorAll('.mtab');
  var panels = document.querySelectorAll('.mpanel');
  function activate(id, focus){
    tabs.forEach(function(t){
      var on = t.dataset.p === id;
      t.classList.toggle('on', on);
      t.setAttribute('aria-selected', on ? 'true' : 'false');
      t.tabIndex = on ? 0 : -1;
      if (on && focus) t.focus();
    });
    panels.forEach(function(p){ p.classList.toggle('on', p.id === id); });
  }
  tabs.forEach(function(t, i){
    t.addEventListener('click', function(){ activate(t.dataset.p); });
    t.addEventListener('keydown', function(e){
      var d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
      if (!d) return;
      e.preventDefault();
      var n = (i + d + tabs.length) % tabs.length;
      activate(tabs[n].dataset.p, true);
    });
  });
  /* открыть нужный таб по ?tab= */
  var q = new URLSearchParams(location.search).get('tab');
  if (q && document.getElementById('mt-' + q)) activate('mt-' + q);
})();
