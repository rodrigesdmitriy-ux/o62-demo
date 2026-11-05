/* Свой курсор, только для мыши */
(function () {
  if (!window.matchMedia) return;
  if (!matchMedia('(hover:hover) and (pointer:fine)').matches) return;
  if (matchMedia('(prefers-reduced-motion:reduce)').matches) return;

  var root = document.createElement('div');
  root.className = 'o62-cursor';
  root.setAttribute('aria-hidden', 'true');
  root.innerHTML = '<i class="o62-cursor-dot"></i>' +
    '<i class="o62-cursor-frame"><b></b><b></b><b></b><b></b></i>';
  document.body.appendChild(root);
  document.documentElement.classList.add('has-o62-cursor');

  var dot = root.firstChild;
  var frame = root.lastChild;
  var x = innerWidth / 2, y = innerHeight / 2, fx = x, fy = y, raf = 0;

  var HOT = 'a,button,[role="button"],summary,label,select,.bk-chip,.cs-toggle,[data-focus-slot]';
  var TEXT = 'input:not([type="button"]):not([type="submit"]):not([type="checkbox"]):not([type="radio"]),textarea';

  function loop() {
    fx += (x - fx) * 0.2;
    fy += (y - fy) * 0.2;
    frame.style.transform = 'translate3d(' + fx + 'px,' + fy + 'px,0)';
    raf = (Math.abs(x - fx) + Math.abs(y - fy) > 0.3) ? requestAnimationFrame(loop) : 0;
  }

  addEventListener('pointermove', function (e) {
    if (e.pointerType && e.pointerType !== 'mouse') return;
    x = e.clientX; y = e.clientY;
    dot.style.transform = 'translate3d(' + x + 'px,' + y + 'px,0)';
    root.classList.add('on');
    if (!raf) raf = requestAnimationFrame(loop);

    var t = e.target;
    var el = t && t.closest ? t : null;
    root.classList.toggle('hot', !!(el && el.closest(HOT)));
    // в полях ввода прячем
    root.classList.toggle('off', !!(el && el.closest(TEXT)));
  }, { passive: true });

  addEventListener('pointerdown', function () { root.classList.add('press'); }, { passive: true });
  addEventListener('pointerup', function () { root.classList.remove('press'); }, { passive: true });
  addEventListener('mouseleave', function () { root.classList.remove('on'); }, { passive: true });
  addEventListener('blur', function () { root.classList.remove('on'); });
})();
