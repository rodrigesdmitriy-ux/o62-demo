/* объект 6/2 · theme.js — скрипты главной страницы */

document.documentElement.classList.add('js');
const RM = matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ---------- гейт ---------- */
const gate = document.getElementById('gate');
const noGate = new URLSearchParams(location.search).has('nogate') || localStorage.getItem('o62gate') === '1';
let heroStarted = false;

/* восстановление скролла вручную, страница стартует сверху */
if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
/* мгновенный скролл наверх в обход smooth */
function toTop(){ window.scrollTo({ top: 0, left: 0, behavior: 'instant' }); }

function openDoor(remember){
  if(remember) localStorage.setItem('o62gate','1');
  document.body.classList.remove('locked');
  toTop();
  gate.classList.add('out');
  setTimeout(()=>{ gate.remove(); toTop(); }, 850);
  startHero();
}
if(noGate){
  gate.remove();
  document.body.classList.remove('locked');
  toTop();
}else{
  document.getElementById('gateForm').addEventListener('submit', e=>{e.preventDefault();openDoor(true)});
  document.getElementById('no18').addEventListener('click', ()=>{ location.href = 'https://ya.ru'; });
}

/* ---------- герой: вход (GSAP) ---------- */
function startHero(){
  if(heroStarted) return; heroStarted = true;
  if(!window.gsap || RM) return;
  document.body.classList.add('anim');
  const tl = gsap.timeline({defaults:{ease:'power3.out'}});
  tl.from('.hero-bg img, .hero-bg video',{scale:1.14,duration:2.2,ease:'power2.out'},0)
    .from('header.nav',{y:-26,opacity:0,duration:.9},.2)
    .to('h1 .line>span',{y:0,duration:1.05,stagger:.13,ease:'power4.out'},.5)
    .from('.hrev',{opacity:0,y:22,duration:.75,stagger:.09},.55)
    ;
}
if(noGate) startHero();

/* мягкий параллакс фона за курсором */
if(window.gsap && !RM && matchMedia('(pointer:fine)').matches){
  addEventListener('mousemove', e=>{
    const nx = e.clientX/innerWidth - .5, ny = e.clientY/innerHeight - .5;
    gsap.to('.hero-bg img, .hero-bg video',{x:nx*-14,y:ny*-8,duration:1.4,ease:'power2.out'});
  });
}

/* ---------- пылинки в луче света (один rAF, пауза при скрытой вкладке) ---------- */
(function(){
  if(RM) return;
  const cv = document.getElementById('dust'), cx = cv.getContext('2d');
  let W,H,dpr=1;
  /* спрайт-точка рисуется один раз */
  const SP=64, sp=document.createElement('canvas'); sp.width=sp.height=SP;
  (function(){
    const sg=sp.getContext('2d'), gr=sg.createRadialGradient(SP/2,SP/2,0,SP/2,SP/2,SP/2);
    gr.addColorStop(0,'rgba(255,226,184,1)');
    gr.addColorStop(.28,'rgba(240,196,144,.72)');
    gr.addColorStop(.6,'rgba(226,168,110,.20)');
    gr.addColorStop(1,'rgba(226,168,110,0)');
    sg.fillStyle=gr; sg.fillRect(0,0,SP,SP);
  })();
  function resize(){
    dpr = Math.min(2, window.devicePixelRatio || 1);
    W = innerWidth; H = innerHeight;
    cv.width = Math.round(W*dpr); cv.height = Math.round(H*dpr);
    cx.setTransform(dpr,0,0,dpr,0,0);
  }
  resize(); addEventListener('resize',resize);

  /* пыль распределена по высоте секций */
  const blocks = Array.from(document.querySelectorAll('main section'));
  const rects = new Map();
  let rectsDirty = true;
  function measure(){
    const sy = scrollY;
    for(const b of blocks){
      const r = b.getBoundingClientRect();
      rects.set(b, {t: r.top + sy, b: r.bottom + sy, l: r.left, r: r.right, h: Math.max(1, r.height)});
    }
    rectsDirty = false;
  }
  measure();
  addEventListener('resize', ()=>{rectsDirty = true});
  addEventListener('load', ()=>{rectsDirty = true});
  setInterval(()=>{rectsDirty = true}, 4000);

  const N = 96, parts = [];
  const rnd = (a,b)=> a + Math.random()*(b-a);

  function spawn(p, near){
    /* near=true: блок рядом с вьюпортом */
    let pool = blocks;
    if(near){
      const sy = scrollY;
      const vis = blocks.filter(b=>{
        const rc = rects.get(b);
        return rc && rc.b > sy - H*.6 && rc.t < sy + H*1.6;
      });
      if(vis.length) pool = vis;
    }
    /* выбор блока с весом по высоте: равномерная плотность пыли */
    const tot = pool.reduce((s,c)=>{const rc=rects.get(c); return s + (rc ? Math.max(0,rc.b-rc.t) : 0);},0);
    let pick = Math.random()*tot, b = pool[pool.length-1];
    for(const cand of pool){ const rc=rects.get(cand); pick -= rc ? Math.max(0,rc.b-rc.t) : 0; if(pick<=0){b=cand;break;} }
    p.b = b;
    p.u = Math.random();                    /* позиция внутри блока по горизонтали, 0..1 */
    p.v = Math.random();                    /* позиция внутри блока по вертикали, 0..1 */
    p.r = .62 + Math.random()*1.05;         /* радиус ядра */
    p.s = rnd(.000025, .000075);            /* доля высоты блока в мс */
    p.ph = Math.random()*6.28;
    p.a = Math.random()*.30+.28;            /* базовая яркость */
  }
  for(let i=0;i<N;i++){ const p={}; spawn(p,false); parts.push(p); }

  let last = performance.now();
  function tick(t){
    if(!document.hidden){
      const dt = Math.min(64, t - last); last = t;
      if(rectsDirty) measure();
      const sy = scrollY;
      cx.clearRect(0,0,W,H);
      cx.globalCompositeOperation='lighter';
      for(const p of parts){
        p.v -= p.s*dt;                                   /* подъём с поправкой на время кадра */
        p.u += Math.sin(t*.0004+p.ph)*.00012*dt/16;      /* синусный дрейф */
        if(p.v < -.02){ spawn(p, true); p.v = 1.02; }    /* ушла выше блока — рождается снизу */
        const rc = rects.get(p.b);
        if(!rc) continue;
        const x = rc.l + p.u*(rc.r - rc.l);
        const y = rc.t + p.v*rc.h - sy;
        if(y < -12 || y > H+12) continue;                /* вне вьюпорта не рисуем */
        /* свечение в верхней трети блока */
        const glow = Math.max(0, 1-Math.hypot(p.u-.32, p.v-.4)*1.7);
        const d = p.r*3.7;
        cx.globalAlpha = Math.min(1, p.a*(.75+.25*glow));
        cx.drawImage(sp, x-d/2, y-d/2, d, d);
      }
      cx.globalAlpha=1;
    } else last = t;
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
})();

/* ---------- появление секций ---------- */
const ioEls = Array.from(document.querySelectorAll('.io'));
let pending = new Set(ioEls);
const io = new IntersectionObserver(es=>{
  es.forEach(e=>{ if(e.isIntersecting) reveal(e.target); });
},{threshold:.12, rootMargin:'0px 0px -6% 0px'});
function reveal(el){ el.classList.add('in'); io.unobserve(el); pending.delete(el); }
ioEls.forEach(el=>io.observe(el));
/* раскрыть пропущенное IntersectionObserver */
function sweep(){
  sweepRaf = false;
  if(!pending.size) return;
  const vh = innerHeight;
  for(const el of [...pending]){
    const r = el.getBoundingClientRect();
    if(r.height > 0 && r.bottom > vh*.05 && r.top < vh*.97) reveal(el);
  }
}
let sweepRaf = false;
addEventListener('scroll', ()=>{ if(!sweepRaf && pending.size){ sweepRaf = true; requestAnimationFrame(sweep); } }, {passive:true});
/* тап по ещё невидимому блоку раскрывает его на месте */
addEventListener('pointerdown', e=>{
  const el = e.target.closest && e.target.closest('.io:not(.in)');
  if(el) reveal(el);
}, true);
/* контрольный sweep первые секунды после загрузки */
let sweepN = 0;
const sweepIv = setInterval(()=>{ sweep(); if(!pending.size || ++sweepN > 16) clearInterval(sweepIv); }, 500);
setTimeout(sweep, 900);

/* ================= ДЫМ: слои на одном rAF ================= */
(function(){
  var RMq = matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (RMq) return;

  function makePuff(size, warm){
    var c = document.createElement('canvas'); c.width = c.height = size;
    var g = c.getContext('2d');
    var n = 5 + Math.floor(Math.random()*4);
    for (var i=0;i<n;i++){
      var r = size*(.16+Math.random()*.2);
      var x = size/2 + (Math.random()-.5)*size*.4;
      var y = size/2 + (Math.random()-.5)*size*.4;
      var gr = g.createRadialGradient(x,y,0,x,y,r);
      var tone = warm ? '230,202,170' : '210,202,190';
      gr.addColorStop(0, 'rgba('+tone+',.16)');
      gr.addColorStop(.55,'rgba('+tone+',.062)');
      gr.addColorStop(1, 'rgba('+tone+',0)');
      g.fillStyle = gr; g.fillRect(0,0,size,size);
    }
    return c;
  }

  var layers = [];
  function smokeLayer(id, opts){
    var cv = document.getElementById(id);
    if (!cv) return;
    var g = cv.getContext('2d');
    var puffs = [makePuff(256,false), makePuff(256,false), makePuff(256,true), makePuff(256,false)];
    var W, H, dpr = 1, P = [];
    /* размер канваса с учётом devicePixelRatio */
    function rs(){
      dpr = Math.min(2, window.devicePixelRatio || 1);
      W = cv.clientWidth || innerWidth;
      H = cv.clientHeight || innerHeight;
      cv.width = Math.round(W*dpr); cv.height = Math.round(H*dpr);
      g.setTransform(dpr,0,0,dpr,0,0);
    }
    rs(); addEventListener('resize', rs, {passive:true});
    function spawn(init){
      var side = Math.random();
      return { x: opts.emitX(side), y: init ? Math.random()*H : H + 80 + Math.random()*120,
        vx:(Math.random()-.5)*.14, vy:-(.22+Math.random()*.4)*opts.speed,
        r:(60+Math.random()*150)*opts.scale, grow:.10+Math.random()*.12,
        rot:Math.random()*6.28, vr:(Math.random()-.5)*.0035,
        a:0, amax:(.24+Math.random()*.36)*opts.alpha,
        life:0, span:700+Math.random()*500,
        img:puffs[Math.floor(Math.random()*puffs.length)], ph:Math.random()*6.28 };
    }
    /* на узких экранах режем плотность */
    var cnt = Math.max(5, Math.round(opts.count * Math.min(1, innerWidth/1440)));
    for (var i=0;i<cnt;i++) P.push(spawn(true));
    layers.push({cv:cv, g:g, P:P, spawn:spawn, W:function(){return W}, H:function(){return H}});
  }
  var mx = .5;
  addEventListener('mousemove', function(e){ mx = e.clientX/innerWidth; }, {passive:true});

  /* задний слой: плотный, из правой части кадра */
  smokeLayer('smokeBack', {count:24, alpha:.55, scale:1.5, speed:1,
    emitX:function(s){ return s<.62 ? innerWidth*(.55+Math.random()*.45) : innerWidth*Math.random(); }});
  /* передний слой: редкие крупные клубы на всю страницу */
  smokeLayer('smokeFront',{count:13, alpha:.42, scale:2.8, speed:1.15,
    emitX:function(){ return innerWidth*Math.random(); }});
  /* дым в гейте */
  smokeLayer('gateSmoke', {count:12, alpha:.34, scale:2, speed:.8,
    emitX:function(){ return innerWidth*Math.random(); }});

  (function frame(t){
    if (!document.hidden){
      for (var li=0; li<layers.length; li++){
        var L = layers[li];
        if (!L.cv.isConnected) continue;
        var g = L.g, W = L.W(), H = L.H();
        g.clearRect(0,0,W,H);
        g.globalCompositeOperation = 'lighter';
        for (var i=0;i<L.P.length;i++){
          var p = L.P[i];
          p.life++;
          p.x += p.vx + Math.sin(t*.00045 + p.ph)*.22 + (mx-.5)*.5;
          p.y += p.vy; p.r += p.grow; p.rot += p.vr;
          var k = p.life/p.span;
          p.a = k<.18 ? p.amax*(k/.18) : p.amax*Math.max(0, 1-(k-.18)/.82);
          if (p.y < -p.r || k >= 1){ L.P[i] = L.spawn(false); continue; }
          g.save();
          g.translate(p.x, p.y); g.rotate(p.rot);
          g.globalAlpha = p.a;
          g.drawImage(p.img, -p.r, -p.r, p.r*2, p.r*2);
          g.restore();
        }
      }
    }
    requestAnimationFrame(frame);
  })(0);
})();

/* ---------- мобильное меню ---------- */
(function(){
  var burger = document.getElementById('burger');
  var mnav = document.getElementById('mnav');
  if (!burger || !mnav) return;
  var closeBtn = mnav.querySelector('.mnav-x');

  function open(){
    mnav.hidden = false;
    requestAnimationFrame(function(){ mnav.classList.add('show'); });
    document.body.classList.add('mnav-open');
    burger.setAttribute('aria-expanded', 'true');
    var f = mnav.querySelector('.mnav-links a');
    if (f) setTimeout(function(){ f.focus(); }, 80);
  }
  function close(){
    mnav.classList.remove('show');
    document.body.classList.remove('mnav-open');
    burger.setAttribute('aria-expanded', 'false');
    setTimeout(function(){ mnav.hidden = true; }, 260);
    burger.focus();
  }
  function toggle(){ mnav.hidden ? open() : close(); }

  burger.addEventListener('click', toggle);
  /* закрывает тот же бургер */
  if (closeBtn) closeBtn.addEventListener('click', close);
  /* клик по разделу — закрыть и проскроллить */
  mnav.querySelectorAll('.mnav-links a, .mnav-cta').forEach(function(a){
    a.addEventListener('click', function(){ close(); });
  });
  document.addEventListener('keydown', function(e){
    if (e.key === 'Escape' && !mnav.hidden) close();
  });
  /* если растянули окно до десктопа — закрыть */
  addEventListener('resize', function(){
    if (innerWidth > 1100 && !mnav.hidden) close();
  }, { passive: true });
})();

/* ---------- навигация: подложка при скролле ---------- */
const nav = document.getElementById('nav');
addEventListener('scroll', ()=>{ nav.classList.toggle('scrolled', scrollY>40); }, {passive:true});

/* ---------- схема зала: выбор места и счётчики — в assets/js/booking.js ---------- */

/* ---------- табы меню ---------- */
document.querySelectorAll('.tab').forEach(tab=>{
  tab.addEventListener('click', ()=>{
    document.querySelectorAll('.tab').forEach(t=>{t.classList.remove('on');t.setAttribute('aria-selected','false')});
    document.querySelectorAll('.panel').forEach(p=>p.classList.remove('on'));
    tab.classList.add('on'); tab.setAttribute('aria-selected','true');
    document.getElementById(tab.dataset.p).classList.add('on');
  });
});

/* ---------- FAQ ---------- */
document.querySelectorAll('.q-btn').forEach(btn=>{
  btn.addEventListener('click', ()=>{
    const q = btn.parentElement, a = q.querySelector('.q-a'), open = q.classList.contains('open');
    document.querySelectorAll('.q.open').forEach(o=>{ o.classList.remove('open'); o.querySelector('.q-a').style.maxHeight = 0; o.querySelector('.q-btn').setAttribute('aria-expanded','false'); });
    if(!open){ q.classList.add('open'); a.style.maxHeight = a.scrollHeight + 'px'; btn.setAttribute('aria-expanded','true'); }
  });
});

/* ---------- лайтбокс ---------- */
const lb = document.getElementById('lightbox'), lbImg = lb.querySelector('img'), lbCap = lb.querySelector('.lb-cap');
const lbCount = lb.querySelector('.lb-count');
let shots = [...document.querySelectorAll('.g-item')];
const galleryShots = shots.slice();
let cur = 0;
function showShot(i){
  cur = (i + shots.length) % shots.length;
  const el = shots[cur];
  lbImg.src = el.dataset.full || el.querySelector('img').src;
  lbCap.textContent = el.dataset.cap;
  /* один кадр: без стрелок и счётчика */
  lb.classList.toggle('lb-one', shots.length < 2);
  if (lbCount) lbCount.textContent = shots.length > 1 ? (cur + 1) + ' / ' + shots.length : '';
}
function closeLb(){
  lb.classList.remove('open');
  /* вернуть ленту галереи */
  shots = galleryShots.slice();
}
/* открыть лайтбокс со своим списком снимков (вызывается из booking.js) */
window.openShots = function(list, i){ shots = list; showShot(i || 0); lb.classList.add('open'); };
shots.forEach((el,i)=> el.addEventListener('click', ()=>{ showShot(i); lb.classList.add('open'); }));
lb.querySelector('.lb-x').addEventListener('click', closeLb);
lb.querySelector('.lb-prev').addEventListener('click', e=>{e.stopPropagation();showShot(cur-1)});
lb.querySelector('.lb-next').addEventListener('click', e=>{e.stopPropagation();showShot(cur+1)});
lb.addEventListener('click', e=>{ if(e.target===lb) closeLb(); });
/* свайп по кадру */
(function(){
  let x0 = null, y0 = null;
  lb.addEventListener('touchstart', e=>{ const t = e.touches[0]; x0 = t.clientX; y0 = t.clientY; }, {passive:true});
  lb.addEventListener('touchend', e=>{
    if(x0 === null || shots.length < 2) { x0 = null; return; }
    const t = e.changedTouches[0], dx = t.clientX - x0, dy = t.clientY - y0;
    x0 = null;
    if(Math.abs(dx) < 42 || Math.abs(dx) < Math.abs(dy)) return;
    showShot(dx < 0 ? cur + 1 : cur - 1);
  }, {passive:true});
})();
/* фото закрытого объекта открывает галерею места */
document.querySelectorAll('.c-card .ph').forEach(function(ph){
  let list = [];
  try { list = JSON.parse(ph.dataset.shots || '[]') || []; } catch(e){ list = []; }
  const card = ph.closest('.c-card');
  const h3 = card && card.querySelector('h3');
  const ttl = h3 ? h3.textContent.trim() : '';
  const img = ph.querySelector('img');
  if(!list.length && img) list = [{ url: img.currentSrc || img.src, cap: ttl }];
  if(!list.length) return;
  ph.classList.add('has-zoom');
  ph.setAttribute('role', 'button');
  ph.setAttribute('tabindex', '0');
  ph.setAttribute('aria-label', (ttl ? ttl + ': ' : '') + 'смотреть фото');
  const open = () => window.openShots(list.map(s => ({ dataset: { full: s.url, cap: s.cap || ttl } })), 0);
  ph.addEventListener('click', open);
  ph.addEventListener('keydown', e=>{ if(e.key === 'Enter' || e.key === ' '){ e.preventDefault(); open(); } });
});
addEventListener('keydown', e=>{
  if(!lb.classList.contains('open')) return;
  if(e.key==='Escape') closeLb();
  if(e.key==='ArrowLeft') showShot(cur-1);
  if(e.key==='ArrowRight') showShot(cur+1);
});

/* ---------- карта click-to-load ---------- */
document.getElementById('mapFacade').addEventListener('click', function(){
  const shell = document.getElementById('mapShell');
  const addr = this.dataset.addr || 'Москва, Рогожский вал, 6к2';
  const f = document.createElement('iframe');
  f.src = 'https://yandex.ru/map-widget/v1/?text=' + encodeURIComponent(addr) + '&z=16';
  f.loading = 'lazy';
  f.title = 'Карта: ' + addr;
  shell.appendChild(f);
  this.remove();
});

/* ---------- видео-фон hero ---------- */
(function(){
  var video = document.querySelector('.hero-bg video');
  if(!video) return;
  if(matchMedia('(prefers-reduced-motion: reduce)').matches){ video.remove(); return; }
  var mobile = Math.min(screen.width, window.innerWidth) <= 768;
  var assets = (window.O62_BOOT && O62_BOOT.assets) ? O62_BOOT.assets : 'assets';
  var boot = window.O62_BOOT || {};
  var own = (mobile && boot.heroVideoMobile) ? boot.heroVideoMobile : (boot.heroVideo || '');
  var base = assets + '/hero-bg-v2-g' + (mobile ? '-720' : '');
  var list = own
    ? [[own, /\.webm(\?|$)/i.test(own) ? 'video/webm' : 'video/mp4']]
    : [[base + '.webm','video/webm'],[base + '.mp4','video/mp4']];
  list.forEach(function(f){
    var s = document.createElement('source');
    s.src = f[0]; s.type = f[1];
    video.appendChild(s);
  });
  video.addEventListener('canplay', function(){ video.classList.add('is-ready'); });
  video.load();
  var p = video.play(); if(p && p.catch) p.catch(function(){});
})();

/* ================= МОДАЛЬНЫЙ СЛОЙ: заявки (бронь — в assets/js/booking.js) ===== */
(function(){
  var ovl = document.getElementById('ovl');
  var modals = { req: document.getElementById('reqModal') };
  var lastFocus = null;
  function openModal(which){
    lastFocus = document.activeElement;
    ovl.hidden = false;
    Object.keys(modals).forEach(function(k){ modals[k].hidden = (k !== which); });
    document.body.style.overflow = 'hidden';
    var f = modals[which].querySelector('input, button.mo-btn');
    if (f) setTimeout(function(){ f.focus(); }, 60);
  }
  function closeAll(){
    ovl.hidden = true; document.body.style.overflow = '';
    if (lastFocus) lastFocus.focus();
  }
  ovl.addEventListener('click', function(e){ if (e.target === ovl) closeAll(); });
  document.addEventListener('keydown', function(e){ if (e.key === 'Escape' && !ovl.hidden) closeAll(); });
  ovl.querySelectorAll('[data-close]').forEach(function(b){ b.addEventListener('click', closeAll); });

  /* формы заявок */
  document.querySelectorAll('[data-req]').forEach(function(b){
    b.addEventListener('click', function(){
      document.getElementById('reqTitle').textContent = b.dataset.req;
      modals.req.querySelector('[data-step="form"]').hidden = false;
      modals.req.querySelector('[data-step="done"]').hidden = true;
      openModal('req');
    });
  });
  /* сброс ошибки при правке поля */
  ['rName', 'rPhone', 'rAgree'].forEach(function(id){
    var el = document.getElementById(id);
    if (el) el.addEventListener(id === 'rAgree' ? 'change' : 'input', function(){
      document.getElementById('errR').classList.remove('show');
      el.classList.remove('err');
    });
  });
  document.getElementById('reqSend').addEventListener('click', function(){
    var n = document.getElementById('rName').value.trim();
    var c = document.getElementById('rPhone').value.trim();
    var cm = document.getElementById('rComment').value.trim();
    var errBox = document.getElementById('errR');
    document.getElementById('rName').classList.toggle('err', n.length < 2);
    document.getElementById('rPhone').classList.toggle('err', c.length < 5);
    if (n.length < 2 || c.length < 5){
      errBox.textContent = 'Оставьте имя и контакт';
      errBox.classList.add('show'); return;
    }
    var ag = document.getElementById('rAgree');
    if (ag && !ag.checked){
      errBox.textContent = 'Подтвердите согласие с обработкой персональных данных';
      errBox.classList.add('show'); return;
    }
    errBox.classList.remove('show');
    var topic = document.getElementById('reqTitle').textContent;
    /* локальная копия заявки */
    try {
      var reqs = JSON.parse(localStorage.getItem('o62requests') || '[]');
      reqs.push({ topic: topic, name:n, contact:c, comment:cm, ts: Date.now() });
      localStorage.setItem('o62requests', JSON.stringify(reqs));
    } catch(e){}
    function done(ok, msg){
      if (ok){
        modals.req.querySelector('[data-step="form"]').hidden = true;
        modals.req.querySelector('[data-step="done"]').hidden = false;
      } else {
        errBox.textContent = msg || 'Не отправилось. Позвоните нам или напишите в Telegram';
        errBox.classList.add('show');
      }
    }
    /* отправка через CF7, без него — ошибка */
    if (window.O62_BOOT && O62_BOOT.cf7 && O62_BOOT.cf7.url){
      var btn = document.getElementById('reqSend');
      btn.disabled = true;
      var send = function(token){
        var fd = new FormData();
        fd.append('rName', n); fd.append('rPhone', c); fd.append('rComment', cm);
        fd.append('rTopic', topic);
        fd.append('_wpcf7_unit_tag', 'wpcf7-f' + O62_BOOT.cf7.id + '-o1'); /* без метки CF7 6.x отвечает 400 */
        if (token) fd.append('smartToken', token);
        fetch(O62_BOOT.cf7.url, { method:'POST', body: fd })
          .then(function(r){ return r.json(); })
          .then(function(res){
            btn.disabled = false;
            if (res && res.status === 'mail_sent') done(true);
            else if (res && res.status === 'validation_failed') done(false, 'Проверьте поля: имя и контакт обязательны');
            else if (res && res.status === 'spam') done(false, 'Не получилось подтвердить, что вы не робот. Обновите страницу и попробуйте снова');
            else done(false);
          })
          .catch(function(){ btn.disabled = false; done(false); });
      };
      if (window.O62_CAPTCHA) window.O62_CAPTCHA.token().then(send, function(){ send(''); });
      else send('');
    } else {
      done(false);
    }
  });
})();

/* ---------- разворот книги: сгиб на стыке листов на мобильных ---------- */
(function(){
  function place(){
    var l = document.querySelector('.lore .sheet.l'),
        s = document.querySelector('.lore .fold'),
        box = l && l.parentElement;
    if (!l || !s || !box) return;
    if (window.matchMedia('(max-width:768px)').matches){
      var y = l.offsetTop + l.offsetHeight;
      s.style.top = y + 'px';
      box.style.setProperty('--split', y + 'px');
    } else {
      s.style.top = '';
      box.style.removeProperty('--split');
    }
  }
  window.addEventListener('resize', place);
  window.addEventListener('load', place);
  place();
})();
