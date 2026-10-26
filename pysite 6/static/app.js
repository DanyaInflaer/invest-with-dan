(function () {

  'use strict';

    /* безопасная подпись под графиком: только текстовые узлы, без разбора HTML */
    function readoutFill(host, parts) {
      while (host.firstChild) host.removeChild(host.firstChild);
      parts.forEach(function (p) {
        var sp = document.createElement('span'); sp.className = p[0];
        if (p.length > 2) {
          sp.appendChild(document.createTextNode(p[1] + ' '));
          var b = document.createElement('b'); b.textContent = p[2]; sp.appendChild(b);
        } else sp.textContent = p[1];
        host.appendChild(sp);
      });
    }

  var D = JSON.parse(document.getElementById('site-data').textContent);
  var NS = 'http://www.w3.org/2000/svg';
  var redrawers = [];          // функции, которые перерисовывают графики при изменении ширины окна
  var chartForcers = [];                    // функции, которые дорисовывают отложенные графики
  var SKIP_DRAW = false;                    // true, пока «вилка» пересчитывает калькуляторы: графики не перерисовываем
  var SC = { shift: {}, current: 'base' };   // выбранный сценарий и его сдвиги (п. п.)
  var extrasReady = false;     // становится true, когда готов раздел «Ипотека подробнее»

  /* ---------- форматирование ---------- */
  var fmt0 = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 });
  var fmtN = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 });
  var fmt1 = new Intl.NumberFormat('ru-RU', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  function rub(x) { return fmt0.format(Math.round(x)).replace(/ | /g, ' ') + ' ₽'; }
  function pct(x) { return fmtN.format(x) + '%'; }

  function el(tag, attrs, parent) {
    var n = document.createElementNS(NS, tag);
    for (var k in attrs) { if (Object.prototype.hasOwnProperty.call(attrs, k)) n.setAttribute(k, attrs[k]); }
    if (parent) parent.appendChild(n);
    return n;
  }

  /* ---------- общий каркас графика ---------- */
  function frame(host, cfg) {
    host.textContent = '';
    var W = Math.max(280, Math.floor(host.clientWidth || 640));
    var H = W < 520 ? 250 : 300;
    var m = { l: cfg.leftPad || 40, r: cfg.rightPad || 16, t: 14, b: 28 };
    var pw = W - m.l - m.r, ph = H - m.t - m.b;
    var svg = el('svg', { viewBox: '0 0 ' + W + ' ' + H, width: W, height: H, role: 'img', 'aria-label': cfg.aria, tabindex: 0 }, host);
    var Y = function (v) { return m.t + ph * (1 - (v - cfg.min) / (cfg.max - cfg.min)); };
    for (var v = cfg.min; v <= cfg.max + 1e-9; v += cfg.step) {
      el('line', { x1: m.l, x2: W - m.r, y1: Y(v), y2: Y(v), 'class': 'grid' }, svg);
      var t = el('text', { x: m.l - 8, y: Y(v) + 4, 'text-anchor': 'end', 'class': 'tick' }, svg);
      t.textContent = cfg.fmtTick ? cfg.fmtTick(v) : fmt0.format(v);
    }
    return { svg: svg, W: W, H: H, m: m, pw: pw, ph: ph, Y: Y };
  }

  function xLabels(f, labels, X) {
    var skip = Math.max(1, Math.ceil(labels.length / (f.W < 480 ? 5 : 10)));
    labels.forEach(function (l, i) {
      if (i % skip !== 0 && i !== labels.length - 1) return;
      var t = el('text', { x: X(i), y: f.H - 8, 'text-anchor': 'middle', 'class': 'tick' }, f.svg);
      t.textContent = l;
    });
  }

  function bindPick(f, n, X, get, set) {
    var rect = el('rect', { x: f.m.l - 10, y: f.m.t, width: f.pw + 20, height: f.ph + 20, fill: 'transparent' }, f.svg);
    function fromEvent(e) {
      var r = f.svg.getBoundingClientRect();
      var x = (e.clientX - r.left) * (f.W / r.width);
      var best = 0, bd = 1e9;
      for (var i = 0; i < n; i++) { var d = Math.abs(X(i) - x); if (d < bd) { bd = d; best = i; } }
      set(best);
    }
    rect.addEventListener('pointermove', fromEvent);
    rect.addEventListener('pointerdown', fromEvent);
    f.svg.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowLeft') { set(Math.max(0, get() - 1)); e.preventDefault(); }
      if (e.key === 'ArrowRight') { set(Math.min(n - 1, get() + 1)); e.preventDefault(); }
      if (e.key === 'Home') { set(0); e.preventDefault(); }
      if (e.key === 'End') { set(n - 1); e.preventDefault(); }
    });
  }

  /* ---------- график 1: ставка и инфляция ---------- */
  var rateIdx = D.rate.labels.length - 1;
  var rateReadout = document.getElementById('readout-rate');

  function drawRate() {
    var host = document.getElementById('chart-rate');
    var n = D.rate.labels.length;
    var f = frame(host, { min: 0, max: 18, step: 3, rightPad: 48, aria: 'График: ключевая ставка и инфляция по месяцам, декабрь 2025 – сентябрь 2026' });
    var X = function (i) { return f.m.l + f.pw * i / (n - 1); };
    xLabels(f, D.rate.labels, X);

    function path(vals) { return vals.map(function (v, i) { return (i ? 'L' : 'M') + X(i).toFixed(1) + ' ' + f.Y(v).toFixed(1); }).join(' '); }
    // ставка рисуется ступенькой: она меняется только на заседаниях
    var step = D.rate.key.map(function (v, i) {
      return i === 0 ? 'M' + X(0).toFixed(1) + ' ' + f.Y(v).toFixed(1)
        : 'L' + X(i).toFixed(1) + ' ' + f.Y(D.rate.key[i - 1]).toFixed(1) + ' L' + X(i).toFixed(1) + ' ' + f.Y(v).toFixed(1);
    }).join(' ');
    el('path', { d: step, 'class': 's1' }, f.svg);
    el('path', { d: path(D.rate.infl), 'class': 's2' }, f.svg);

    var last = n - 1;
    var l1 = el('text', { x: X(last) + 8, y: f.Y(D.rate.key[last]) + 4, 'class': 'endl1' }, f.svg);
    l1.textContent = fmtN.format(D.rate.key[last]);
    var l2 = el('text', { x: X(last) + 8, y: f.Y(D.rate.infl[last]) + 4, 'class': 'endl2' }, f.svg);
    l2.textContent = fmtN.format(D.rate.infl[last]);

    var cur = el('line', { y1: f.m.t, y2: f.m.t + f.ph, 'class': 'cursor' }, f.svg);
    var d1 = el('circle', { r: 5, 'class': 'dot1' }, f.svg);
    var d2 = el('circle', { r: 5, 'class': 'dot2' }, f.svg);

    function show(i) {
      rateIdx = i;
      cur.setAttribute('x1', X(i)); cur.setAttribute('x2', X(i));
      d1.setAttribute('cx', X(i)); d1.setAttribute('cy', f.Y(D.rate.key[i]));
      d2.setAttribute('cx', X(i)); d2.setAttribute('cy', f.Y(D.rate.infl[i]));
      var gap = D.rate.key[i] - D.rate.infl[i];
      readoutFill(rateReadout, [
        ['rd', String(D.rate.full[i])],
        ['r1', 'Ставка', pct(D.rate.key[i])],
        ['r2', 'Инфляция', pct(D.rate.infl[i])],
        ['rd', 'Разрыв ' + fmtN.format(gap) + ' п. п.']
      ]);
    }
    bindPick(f, n, X, function () { return rateIdx; }, show);
    show(rateIdx);
  }

  /* ---------- график 2: зарплаты ---------- */
  var wageIdx = D.wage.values.length - 1;
  var wageReadout = document.getElementById('readout-wage');

  function drawWage() {
    var host = document.getElementById('chart-wage');
    var vals = D.wage.values, n = vals.length;
    var f = frame(host, { min: 0, max: 150, step: 50, rightPad: 16, aria: 'График: средняя начисленная зарплата по месяцам, октябрь 2025 – июль 2026' });
    var slot = f.pw / n, bw = Math.min(46, slot * 0.62);
    var X = function (i) { return f.m.l + slot * (i + 0.5); };
    xLabels(f, D.wage.labels, X);
    var bars = [];
    vals.forEach(function (v, i) {
      if (v === null) {
        el('rect', { x: X(i) - bw / 2, y: f.Y(30), width: bw, height: f.Y(0) - f.Y(30), rx: 2, 'class': 'bar-gap' }, f.svg);
        bars.push(null);
      } else {
        bars.push(el('rect', { x: X(i) - bw / 2, y: f.Y(v), width: bw, height: f.Y(0) - f.Y(v), rx: 2, 'class': 'bar-rect' }, f.svg));
      }
    });
    function show(i) {
      wageIdx = i;
      bars.forEach(function (b, j) { if (b) b.setAttribute('class', 'bar-rect' + (j === i ? ' on' : '')); });
      var v = vals[i];
      readoutFill(wageReadout, [['rd', String(D.wage.full[i])],
        v === null ? ['rd', 'значение не найдено в источниках'] : ['r1', 'Зарплата', rub(v * 1000)]]);
    }
    bindPick(f, n, X, function () { return wageIdx; }, show);
    show(wageIdx);
  }

  /* ---------- вкладки графиков ---------- */
  var tabRate = document.getElementById('tab-rate');
  var tabWage = document.getElementById('tab-wage');
  var panelRate = document.getElementById('panel-rate');
  var panelWage = document.getElementById('panel-wage');

  function selectTab(which) {
    var isRate = which === 'rate';
    tabRate.setAttribute('aria-selected', isRate); tabWage.setAttribute('aria-selected', !isRate);
    tabRate.tabIndex = isRate ? 0 : -1; tabWage.tabIndex = isRate ? -1 : 0;
    panelRate.hidden = !isRate; panelWage.hidden = isRate;
    redraw();
  }
  tabRate.addEventListener('click', function () { selectTab('rate'); });
  tabWage.addEventListener('click', function () { selectTab('wage'); });
  [tabRate, tabWage].forEach(function (t) {
    t.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        var toWage = t === tabRate;
        selectTab(toWage ? 'wage' : 'rate');
        (toWage ? tabWage : tabRate).focus();
        e.preventDefault();
      }
    });
  });

  function redraw() {
    if (!panelRate.hidden) drawRate();
    if (!panelWage.hidden) drawWage();
  }
  redraw();
  var lastW = window.innerWidth;
  window.addEventListener('resize', function () {
    if (window.innerWidth !== lastW) { lastW = window.innerWidth; redraw(); redrawers.forEach(function (fn) { fn(); }); }
  });

  /* ---------- калькулятор вклада ---------- */
  var dAmount = document.getElementById('dep-amount');
  var dMonths = document.getElementById('dep-months');
  var dMonthsOut = document.getElementById('dep-months-out');
  var dRate = document.getElementById('dep-rate');
  var dRateHint = document.getElementById('dep-rate-hint');
  var dCap = document.getElementById('dep-cap');
  var rateEdited = false;

  function num(input, fallback) {
    var v = parseFloat(String(input.value).replace(',', '.'));
    return isFinite(v) && v >= 0 ? v : fallback;
  }
  function monthsText(m) {
    if (m % 12 === 0) { var y = m / 12; return y + (y === 1 ? ' год' : y < 5 ? ' года' : ' лет'); }
    return m + ' мес.';
  }
  function bucketFor(m) {
    for (var i = 0; i < D.depositRates.length; i++) { if (m <= D.depositRates[i].upto_months) return D.depositRates[i]; }
    return D.depositRates[D.depositRates.length - 1];
  }

  function calcDeposit() {
    var P = num(dAmount, 0), m = parseInt(dMonths.value, 10), r = num(dRate, 0);
    dMonthsOut.textContent = monthsText(m);
    var b = bucketFor(m);
    if (!rateEdited) { r = Math.max(0, b.rate + (SC.shift.dep || 0)); dRate.value = Math.round(r * 100) / 100; }
    dRateHint.textContent = rateEdited ? '' : 'средняя максимальная для срока: ' + b.label;
    var final = dCap.checked ? P * Math.pow(1 + r / 100 / 12, m) : P * (1 + r / 100 * m / 12);
    var income = final - P;
    var real = final / Math.pow(1 + D.inflation / 100, m / 12) - P;
    document.getElementById('dep-income').textContent = rub(income);
    document.getElementById('dep-final').textContent = rub(final);
    document.getElementById('dep-real').textContent = (real < 0 ? '−' : '') + rub(Math.abs(real));
    document.getElementById('dep-real-label').textContent = 'Доход с учётом инфляции ' + fmtN.format(D.inflation) + '%';
    document.getElementById('dep-warn').textContent =
      r > D.keyRate ? 'Ставка выше ключевой (' + pct(D.keyRate) + '). Такие предложения обычно действуют на ограниченный срок или при условиях.' : '';
  }
  dRate.addEventListener('input', function () { rateEdited = true; calcDeposit(); });
  [dAmount, dMonths, dCap].forEach(function (i) { i.addEventListener('input', calcDeposit); });
  dMonths.addEventListener('input', function () { /* ставка подстраивается под срок, пока её не меняли вручную */ });
  calcDeposit();

  /* ---------- калькулятор ипотеки ---------- */
  var mPrice = document.getElementById('mor-price');
  var mDown = document.getElementById('mor-down');
  var mDownOut = document.getElementById('mor-down-out');
  var mYears = document.getElementById('mor-years');
  var mYearsOut = document.getElementById('mor-years-out');
  var mPreset = document.getElementById('mor-preset');
  var mRate = document.getElementById('mor-rate');

  function yearsText(y) { return y + (y === 1 ? ' год' : (y >= 2 && y <= 4) ? ' года' : ' лет'); }

  function calcMortgage() {
    var price = num(mPrice, 0), down = parseInt(mDown.value, 10), years = parseInt(mYears.value, 10), rate = num(mRate, 0);
    mDownOut.textContent = down + '% (' + rub(price * down / 100) + ')';
    mYearsOut.textContent = yearsText(years);
    var loan = price * (1 - down / 100), n = years * 12, i = rate / 100 / 12;
    var pay = loan === 0 ? 0 : (i === 0 ? loan / n : loan * i / (1 - Math.pow(1 + i, -n)));
    var over = pay * n - loan;
    document.getElementById('mor-pay').textContent = rub(pay);
    document.getElementById('mor-loan').textContent = rub(loan);
    document.getElementById('mor-over').textContent = rub(over);
    document.getElementById('mor-share').textContent = fmt1.format(pay / D.avgWage * 100) + '%';
    updateMortgageExtras();
  }
  mPreset.addEventListener('change', function () {
    if (mPreset.value !== 'custom') { mRate.value = mPreset.value; }
    calcMortgage();
  });
  mRate.addEventListener('input', function () {
    var match = false;
    Array.prototype.forEach.call(mPreset.options, function (o) { if (o.value !== 'custom' && parseFloat(o.value) === parseFloat(mRate.value)) { mPreset.value = o.value; match = true; } });
    if (!match) mPreset.value = 'custom';
    calcMortgage();
  });
  [mPrice, mDown, mYears].forEach(function (i) { i.addEventListener('input', calcMortgage); });
  calcMortgage();


  /* ---------- калькулятор инфляции ---------- */
  var pAmount = document.getElementById('pw-amount');
  var pYears = document.getElementById('pw-years');
  var pYearsOut = document.getElementById('pw-years-out');
  var pRate = document.getElementById('pw-rate');

  function calcPower() {
    var A = num(pAmount, 0), years = parseInt(pYears.value, 10), r = num(pRate, 0);
    pYearsOut.textContent = yearsText(years);
    var k = Math.pow(1 + r / 100, years);
    var worth = A / k;
    document.getElementById('pw-worth').textContent = rub(worth);
    document.getElementById('pw-loss').textContent = rub(A - worth) + ' (' + fmt1.format(A === 0 ? 0 : (1 - 1 / k) * 100) + '%)';
    document.getElementById('pw-need').textContent = rub(A * k);
  }
  [pAmount, pYears, pRate].forEach(function (i) { i.addEventListener('input', calcPower); });
  calcPower();


  /* ======================================================================
     Общие помощники для новых блоков
     ====================================================================== */
  function $(id) { return document.getElementById(id); }

  function compact(v) {
    var a = Math.abs(v);
    if (a >= 1e6) return (v / 1e6).toFixed(a >= 1e7 ? 0 : 1).replace('.', ',').replace(/,0$/, '') + ' млн';
    if (a >= 1e3) return Math.round(v / 1e3) + ' тыс';
    return String(Math.round(v));
  }
  function niceScale(maxV) {
    if (!(maxV > 0)) return { max: 1, step: 0.25 };
    var raw = maxV / 4, pow = Math.pow(10, Math.floor(Math.log(raw) / Math.LN10)), n = raw / pow;
    var step = (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * pow;
    return { max: Math.ceil(maxV / step) * step, step: step };
  }
  function termText(m) {
    var y = Math.floor(m / 12), r = m % 12, s = y ? yearsText(y) : '';
    if (r) s += (s ? ' ' : '') + r + ' мес.';
    return s || '0 мес.';
  }

  // График с несколькими линиями и подсказкой по годам. Возвращает функцию отрисовки.
  function multiChart(hostId, readoutId) {
    var host = $(hostId), readout = $(readoutId), idx = null, last = null;
    var visible = !('IntersectionObserver' in window);     // рисуем график, когда до него доскроллили (экономит время загрузки)
    if (!visible) {
      new IntersectionObserver(function (entries, ob) {
        if (entries.some(function (e) { return e.isIntersecting; })) { visible = true; ob.disconnect(); if (last) draw(); }
      }, { rootMargin: '500px' }).observe(host);
    }
    chartForcers.push(function () { visible = true; if (last) draw(); });   // перед печатью рисуем все графики
    function draw(cfg) {
      last = cfg || last;
      if (!last || SKIP_DRAW || !visible) return;
      cfg = last;
      var n = cfg.labels.length;
      if (idx === null || idx > n - 1) idx = n - 1;
      var maxV = 0;
      cfg.series.forEach(function (s) { s.values.forEach(function (v) { if (v > maxV) maxV = v; }); });
      var sc = niceScale(maxV);
      var f = frame(host, { min: 0, max: sc.max, step: sc.step, leftPad: 58, rightPad: 16, fmtTick: compact, aria: cfg.aria });
      var X = function (i) { return f.m.l + f.pw * (n <= 1 ? 0 : i / (n - 1)); };
      xLabels(f, cfg.labels, X);
      cfg.series.forEach(function (s) {
        var d = s.values.map(function (v, i) { return (i ? 'L' : 'M') + X(i).toFixed(1) + ' ' + f.Y(v).toFixed(1); }).join(' ');
        el('path', { d: d, 'class': s.cls }, f.svg);
      });
      var cur = el('line', { y1: f.m.t, y2: f.m.t + f.ph, 'class': 'cursor' }, f.svg);
      var dots = cfg.series.map(function (s) { return el('circle', { r: 4.5, 'class': 'dot' + s.cls.slice(1) }, f.svg); });
      function show(i) {
        idx = i;
        cur.setAttribute('x1', X(i)); cur.setAttribute('x2', X(i));
        var parts = [['rd', String(cfg.full[i])]];
        cfg.series.forEach(function (s, k) {
          dots[k].setAttribute('cx', X(i)); dots[k].setAttribute('cy', f.Y(s.values[i]));
          parts.push(['r' + s.cls.slice(1), s.name, rub(s.values[i])]);
        });
        readoutFill(readout, parts);
      }
      bindPick(f, n, X, function () { return idx; }, show);
      show(idx);
    }
    return draw;
  }

  /* ======================================================================
     Инвестиционный калькулятор
     ====================================================================== */
  var drawInvest = multiChart('chart-invest', 'readout-invest');
  var iPreset = $('inv-preset'), iRate = $('inv-rate');

  function calcInvest() {
    var P0 = num($('inv-start'), 0), C0 = num($('inv-monthly'), 0), years = parseInt($('inv-years').value, 10);
    var r = num(iRate, 0) / 100, inf = num($('inv-infl'), 0) / 100, indexed = $('inv-index').checked;
    $('inv-years-out').textContent = yearsText(years);
    var m = r / 12, bal = P0, put = P0, c = C0;
    var labels = ['0'], full = ['сейчас'], capS = [P0], putS = [P0], realS = [P0];
    for (var k = 1; k <= years * 12; k++) {
      bal = bal * (1 + m) + c;
      put += c;
      if (k % 12 === 0) {
        var y = k / 12;
        labels.push(String(y)); full.push('через ' + yearsText(y));
        capS.push(bal); putS.push(put); realS.push(bal / Math.pow(1 + inf, y));
        if (indexed) c *= 1 + inf;
      }
    }
    var eff = Math.pow(1 + m, 12) - 1;
    $('inv-final').textContent = rub(bal);
    $('inv-invested').textContent = rub(put);
    $('inv-income').textContent = rub(bal - put);
    $('inv-real').textContent = rub(realS[realS.length - 1]);
    var rr = ((1 + eff) / (1 + inf) - 1) * 100;
    $('inv-realrate').textContent = fmtN.format(rr) + '%';
    drawInvest({
      labels: labels, full: full,
      series: [
        { name: 'Капитал', cls: 's1', values: capS },
        { name: 'Вложено', cls: 's2', values: putS },
        { name: 'В сегодняшних ценах', cls: 's3', values: realS }
      ],
      aria: 'График роста капитала по годам: капитал, вложенные деньги и капитал в сегодняшних ценах'
    });
  }
  iPreset.addEventListener('change', function () {
    if (iPreset.value !== 'custom') iRate.value = iPreset.value;
    calcInvest();
  });
  iRate.addEventListener('input', function () {
    var match = false;
    Array.prototype.forEach.call(iPreset.options, function (o) {
      if (o.value !== 'custom' && parseFloat(o.value) === parseFloat(iRate.value)) { iPreset.value = o.value; match = true; }
    });
    if (!match) iPreset.value = 'custom';
    calcInvest();
  });
  ['inv-start', 'inv-monthly', 'inv-years', 'inv-infl', 'inv-index'].forEach(function (id) { $(id).addEventListener('input', calcInvest); });
  redrawers.push(function () { calcInvest(); });

  /* ======================================================================
     Ипотека подробнее: сравнение программ и досрочное погашение
     ====================================================================== */
  var drawPrepay = multiChart('chart-prepay', 'readout-prepay');

  function annuityPay(loan, n, i) {
    if (loan <= 0 || n <= 0) return 0;
    return i === 0 ? loan / n : loan * i / (1 - Math.pow(1 + i, -n));
  }

  // Помесячный расчёт: платёж по графику не меняется, доплаты сокращают срок.
  function simulate(loan, i, pay, extraMonthly, extraOnce, onceMonth) {
    var bal = loan, m = 0, interest = 0, paid = 0, yp = 0, yi = 0, rows = [];
    while (bal > 0.005 && m < 1200) {
      m++;
      var intr = bal * i, princ = Math.max(pay - intr, 0);
      var extra = extraMonthly + (m === onceMonth ? extraOnce : 0);
      var pr = Math.min(bal, princ + extra);
      interest += intr; paid += intr + pr; yp += intr + pr; yi += intr; bal -= pr;
      if (m % 12 === 0 || bal <= 0.005) { rows.push({ paid: yp, interest: yi, balance: Math.max(bal, 0) }); yp = 0; yi = 0; }
    }
    return { months: m, interest: interest, paid: paid, rows: rows };
  }

  function cell(tag, text, cls) {
    var c = document.createElement(tag);
    c.textContent = text;
    if (cls) c.className = cls;
    return c;
  }

  function updateMortgageExtras() {
    if (!extrasReady) return;
    var price = num(mPrice, 0), down = parseInt(mDown.value, 10), years = parseInt(mYears.value, 10), rate = num(mRate, 0);
    var loan = price * (1 - down / 100), n = years * 12, i = rate / 100 / 12, pay = annuityPay(loan, n, i);

    // сравнение программ
    $('compare-cond').textContent = 'Жильё ' + rub(price) + ', взнос ' + down + '%, срок ' + yearsText(years) + ', сумма кредита ' + rub(loan) + '.';
    var body = $('compare-body');
    body.textContent = '';
    D.mortgagePresets.forEach(function (p) {
      var pm = annuityPay(loan, n, p.rate / 100 / 12), tr = document.createElement('tr');
      if (Math.abs(p.rate - rate) < 1e-9) tr.className = 'pinned';
      var th = cell('th', p.label, 'c-name'); th.setAttribute('scope', 'row');
      tr.appendChild(th);
      tr.appendChild(cell('td', pct(p.rate), 'num'));
      tr.appendChild(cell('td', rub(pm), 'num'));
      tr.appendChild(cell('td', rub(pm * n - loan), 'num'));
      tr.appendChild(cell('td', rub(pm * n), 'num'));
      body.appendChild(tr);
    });

    // досрочное погашение
    var onceYear = $('pp-once-year');
    onceYear.max = Math.max(1, years);
    if (parseInt(onceYear.value, 10) > years) onceYear.value = years;
    var oy = parseInt(onceYear.value, 10);
    $('pp-once-year-out').textContent = yearsText(oy);
    var xm = num($('pp-monthly'), 0), xo = num($('pp-once'), 0);
    var base = simulate(loan, i, pay, 0, 0, 0), ext = simulate(loan, i, pay, xm, xo, oy * 12);

    $('pp-cond').textContent = 'Ставка ' + pct(rate) + ', платёж по графику ' + rub(pay) + ' в месяц. Параметры кредита берутся из калькулятора ипотеки выше.';
    $('pp-term').textContent = termText(ext.months);
    $('pp-faster').textContent = base.months > ext.months ? termText(base.months - ext.months) : 'не меняется';
    $('pp-saved').textContent = rub(Math.max(base.interest - ext.interest, 0));
    $('pp-total').textContent = rub(ext.paid);

    var L = base.rows.length, labels = [], full = [], a = [loan], b = [loan];
    for (var y = 0; y <= L; y++) { labels.push(String(y)); full.push(y ? 'через ' + yearsText(y) : 'сейчас'); }
    for (var k = 0; k < L; k++) {
      a.push(ext.rows[k] ? ext.rows[k].balance : 0);
      b.push(base.rows[k].balance);
    }
    drawPrepay({
      labels: labels, full: full,
      series: [
        { name: 'С досрочным', cls: 's1', values: a },
        { name: 'Без досрочного', cls: 's2', values: b }
      ],
      aria: 'График остатка долга по годам с досрочным погашением и без него'
    });

    var sb = $('schedule-body');
    sb.textContent = '';
    ext.rows.forEach(function (r, k) {
      var tr = document.createElement('tr'), th = cell('th', String(k + 1), 'c-name');
      th.setAttribute('scope', 'row');
      tr.appendChild(th);
      tr.appendChild(cell('td', rub(r.paid), 'num'));
      tr.appendChild(cell('td', rub(r.interest), 'num'));
      tr.appendChild(cell('td', rub(r.balance), 'num'));
      sb.appendChild(tr);
    });
  }
  ['pp-monthly', 'pp-once', 'pp-once-year'].forEach(function (id) { $(id).addEventListener('input', updateMortgageExtras); });
  redrawers.push(updateMortgageExtras);

  extrasReady = true;
  calcInvest();
  updateMortgageExtras();

  /* ======================================================================
     Сохранение всех расчётов в PDF (через окно печати браузера)
     ====================================================================== */
  function textOf(n) { return (n.textContent || '').replace(/\s+/g, ' ').trim(); }
  function labelText(label) {
    var c = label.cloneNode(true);
    Array.prototype.forEach.call(c.querySelectorAll('output,.hint'), function (n) { n.remove(); });
    return textOf(c).replace(/[:,]\s*$/, '');
  }
  function fieldValue(field) {
    var inp = field.querySelector('input,select');
    if (!inp) return '';
    if (inp.type === 'checkbox') return inp.checked ? 'да' : 'нет';
    var out = field.querySelector('label output');
    if (out) return textOf(out);
    if (inp.tagName === 'SELECT') return inp.options[inp.selectedIndex].text;
    var v = parseFloat(inp.value);
    return isFinite(v) ? fmtN.format(v) : inp.value;
  }
  function div(cls) { var d = document.createElement('div'); d.className = cls; return d; }
  function rowTable(cls, pairs) {
    var t = document.createElement('table'), tb = document.createElement('tbody');
    t.className = cls;
    pairs.forEach(function (p) {
      var tr = document.createElement('tr');
      tr.appendChild(cell('td', p[0]));
      tr.appendChild(cell('td', p[1], 'v'));
      tb.appendChild(tr);
    });
    t.appendChild(tb);
    return t;
  }

  function buildReport() {
    var root = $('report');
    root.textContent = '';
    var head = div('rp-head');
    var h1 = document.createElement('h1'); h1.textContent = 'Мои расчёты';
    head.appendChild(h1);
    var when = new Date().toLocaleString('ru-RU', { dateStyle: 'long', timeStyle: 'short' });
    var p1 = document.createElement('p'); p1.textContent = (D.team ? D.team + ' · ' : '') + when;
    var p2 = document.createElement('p');
    p2.textContent = 'Исходные данные: ключевая ставка ' + pct(D.keyRate) + ', инфляция за год ' + pct(D.inflation) + '.' + (D.asOf ? ' Данные на ' + D.asOf + '.' : '') +
      (SC.current !== 'base' && D.scenarios[SC.current] ? ' Сценарий: ' + D.scenarios[SC.current].label.toLowerCase() + '.' : '');
    head.appendChild(p1); head.appendChild(p2);
    root.appendChild(head);

    Array.prototype.forEach.call(document.querySelectorAll('[data-report]'), function (node) {
      var sec = div('rp-sec');
      var h3 = node.querySelector('h3');
      var title = node.getAttribute('data-title') || (h3 ? textOf(h3) : '');
      var h = document.createElement('h2'); h.textContent = title; sec.appendChild(h);

      if (node.tagName === 'FORM') {
        var ins = [], outs = [];
        Array.prototype.forEach.call(node.querySelectorAll('.field'), function (f) {
          var lab = f.querySelector('label');
          if (lab) ins.push([labelText(lab), fieldValue(f)]);
        });
        Array.prototype.forEach.call(node.querySelectorAll('.result > div'), function (r) {
          outs.push([textOf(r.querySelector('dt')), textOf(r.querySelector('dd'))]);
        });
        var s1 = div('sub-title'); s1.textContent = 'Исходные данные'; sec.appendChild(s1);
        sec.appendChild(rowTable('rp-in', ins));
        var s2 = div('sub-title'); s2.textContent = 'Результат'; sec.appendChild(s2);
        if (outs.length) sec.appendChild(rowTable('rp-out', outs));
        var inner = node.querySelector('table');          // таблица результата внутри формы (сравнение вложений)
        if (inner) { var ic = inner.cloneNode(true); ic.removeAttribute('id'); sec.appendChild(ic); }
      } else if (node.tagName === 'TABLE') {
        var tc = node.cloneNode(true);
        tc.removeAttribute('id');
        sec.classList.add('rp-wide');
        sec.appendChild(tc);
      } else {
        var svg = node.querySelector('svg');
        if (!svg) return;
        var lg = node.parentElement && node.parentElement.querySelector('.legend');
        if (lg) sec.appendChild(lg.cloneNode(true));      // подписи линий
        var w = div('chart');
        w.appendChild(svg.cloneNode(true));
        sec.appendChild(w);
      }
      root.appendChild(sec);
    });

    var foot = div('rp-foot');
    foot.textContent = 'Расчёты ориентировочные: без налогов, комиссий и индивидуальных условий банков. Доходность не гарантирована. ' +
      'Материал носит справочный характер и не является индивидуальной инвестиционной рекомендацией.';
    root.appendChild(foot);
  }

  // Отчёт собирается при печати: и по кнопке, и по Ctrl+P
  window.addEventListener('beforeprint', function () { chartForcers.forEach(function (fn) { fn(); }); buildReport(); document.body.classList.add('printing'); });
  window.addEventListener('afterprint', function () { document.body.classList.remove('printing'); $('report').textContent = ''; });
  $('pdf-btn').addEventListener('click', function () {
    var msg = $('pdf-msg');
    msg.textContent = '';
    try { window.print(); } catch (e) { msg.textContent = 'Не удалось открыть окно печати. Нажмите Ctrl+P (на телефоне: меню браузера, «Печать»).'; }
  });

  /* ======================================================================
     Мини-квиз «Проверь себя»
     ====================================================================== */
  (function () {
    var host = document.getElementById('quiz');
    var Q = D.quiz || [];
    if (!host || !Q.length) return;
    var idx = 0, score = 0;

    function h(tag, cls, text) { var n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; }

    function render() {
      host.textContent = '';
      if (idx >= Q.length) return result();
      var q = Q[idx];
      var head = h('div', 'quiz-head');
      head.appendChild(h('span', 'quiz-step', 'Вопрос ' + (idx + 1) + ' из ' + Q.length));
      var bar = h('div', 'quiz-bar'); var fill = h('i'); fill.style.width = (idx / Q.length * 100) + '%'; bar.appendChild(fill);
      head.appendChild(bar);
      host.appendChild(head);

      var title = h('h3', 'quiz-q', q.q); title.id = 'quiz-q'; title.tabIndex = -1;
      host.appendChild(title);
      var list = h('div', 'quiz-opts'); list.setAttribute('role', 'group'); list.setAttribute('aria-labelledby', 'quiz-q');
      var fb = h('div', 'quiz-fb'); fb.hidden = true;
      var opts = [];
      q.options.forEach(function (text, i) {
        var b = h('button', 'q-opt', text); b.type = 'button';
        b.addEventListener('click', function () { answer(i); });
        opts.push(b); list.appendChild(b);
      });
      host.appendChild(list); host.appendChild(fb);

      function answer(i) {
        var ok = i === q.correct;
        if (ok) score++;
        opts.forEach(function (b, k) {
          b.disabled = true;
          if (k === q.correct) { b.classList.add('right'); b.insertBefore(h('span', 'q-mark', '✓ '), b.firstChild); }
          else if (k === i) { b.classList.add('wrong'); b.insertBefore(h('span', 'q-mark', '✕ '), b.firstChild); }
        });
        fb.hidden = false; fb.className = 'quiz-fb ' + (ok ? 'ok' : 'bad');
        fb.appendChild(h('strong', null, ok ? 'Верно!' : 'Не совсем.'));
        fb.appendChild(document.createTextNode(' ' + q.why));
        if (q.link) {
          var a = h('a', 'quiz-link', q.link[1] + ' →'); a.href = q.link[0];
          fb.appendChild(document.createElement('br')); fb.appendChild(a);
        }
        var next = h('button', 'btn primary quiz-next', idx + 1 < Q.length ? 'Следующий вопрос' : 'Узнать результат');
        next.type = 'button';
        next.addEventListener('click', function () { idx++; render(); var t = document.getElementById('quiz-q') || host.querySelector('.quiz-result h3'); if (t) t.focus(); });
        fb.appendChild(next);
        next.focus();
      }
    }

    function result() {
      var n = Q.length, pctDone = score / n;
      var msg = pctDone === 1 ? 'Отлично! Вы уверенно ориентируетесь в теме.'
        : pctDone >= 0.7 ? 'Хороший результат. Есть что уточнить, но база крепкая.'
        : pctDone >= 0.4 ? 'Неплохое начало. Разборы и калькуляторы ниже помогут подтянуть знания.'
        : 'Это нормально: тема непростая. Начните с разборов, там всё объяснено на примерах.';
      var box = h('div', 'quiz-result');
      var t = h('h3', null, 'Ваш результат: ' + score + ' из ' + n); t.tabIndex = -1;
      box.appendChild(t);
      box.appendChild(h('p', null, msg));
      var row = h('div', 'quiz-actions');
      var again = h('button', 'btn primary', 'Пройти ещё раз'); again.type = 'button';
      again.addEventListener('click', function () { idx = 0; score = 0; render(); var tt = document.getElementById('quiz-q'); if (tt) tt.focus(); });
      var a1 = h('a', 'btn', 'Читать разборы'); a1.href = 'razbory/';
      var a2 = h('a', 'btn', 'Открыть калькуляторы'); a2.href = '#kalkulyatory';
      row.appendChild(again); row.appendChild(a1); row.appendChild(a2);
      box.appendChild(row);
      host.appendChild(box);
    }
    render();
  })();

  /* ======================================================================
     Календарь заседаний Банка России: обратный отсчёт, статусы, напоминания (.ics)
     ====================================================================== */
  (function () {
    var list = document.getElementById('cal-list');
    if (!list || !D.meetings) return;
    var MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
    var DAYS = ['воскресенье', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота'];
    function todayMsk() {                                     // сегодняшняя дата по Москве: YYYY-MM-DD
      try { return new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Moscow' }); }
      catch (e) { var d = new Date(); return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2); }
    }
    function utc(iso) { var p = iso.split('-'); return Date.UTC(+p[0], +p[1] - 1, +p[2]); }
    function days(a, b) { return Math.round((utc(b) - utc(a)) / 86400000); }
    function plural(n, one, few, many) { var a = n % 100, b = n % 10; return a > 10 && a < 20 ? many : b === 1 ? one : b >= 2 && b <= 4 ? few : many; }
    function label(iso) { var p = iso.split('-'); return +p[2] + ' ' + MONTHS[+p[1] - 1] + ' ' + p[0]; }
    function nextOf(today) { for (var i = 0; i < D.meetings.length; i++) if (D.meetings[i] >= today) return D.meetings[i]; return null; }

    var google = document.getElementById('cal-google');
    function paint() {
      var today = todayMsk(), nxt = nextOf(today);
      Array.prototype.forEach.call(list.querySelectorAll('.cal-item'), function (li) {
        var d = li.getAttribute('data-date');
        var st = d < today ? 'past' : d === nxt ? 'next' : 'future';
        li.className = 'cal-item ' + st;
        li.querySelector('[data-badge]').textContent = st === 'past' ? 'Прошло' : st === 'next' ? 'Следующее' : 'Впереди';
      });
      var dateEl = document.getElementById('cal-date'), leftEl = document.getElementById('cal-left');
      if (!nxt) {
        dateEl.textContent = 'Заседания 2026 года завершились';
        leftEl.textContent = 'Даты заседаний следующего года Банк России публикует заранее, мы добавим их в календарь.';
        google.hidden = true; return;
      }
      var wd = DAYS[new Date(utc(nxt)).getUTCDay()], n = days(today, nxt);
      dateEl.textContent = label(nxt) + ', ' + wd;
      leftEl.textContent = n === 0 ? 'Заседание сегодня, решение обычно объявляют около 13:30 по Москве.'
        : n === 1 ? 'Заседание завтра.' : 'Через ' + n + ' ' + plural(n, 'день', 'дня', 'дней') + '.';
      var d1 = nxt.replace(/-/g, ''), nd = new Date(utc(nxt) + 86400000), d2 = nd.getUTCFullYear() + ('0' + (nd.getUTCMonth() + 1)).slice(-2) + ('0' + nd.getUTCDate()).slice(-2);
      google.href = 'https://calendar.google.com/calendar/render?action=TEMPLATE&text=' + encodeURIComponent('Заседание Банка России по ключевой ставке') +
        '&dates=' + d1 + '/' + d2 + '&details=' + encodeURIComponent('Решение по ключевой ставке обычно объявляют около 13:30 по Москве.');
      google.hidden = false;
    }
    paint();

    function ics() {                                          // файл напоминаний со всеми будущими заседаниями
      var today = todayMsk(), out = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Growth Syndicate//CBR//RU', 'CALSCALE:GREGORIAN', 'X-WR-CALNAME:Заседания Банка России'];
      D.meetings.filter(function (d) { return d >= today; }).forEach(function (d) {
        var d1 = d.replace(/-/g, ''), nd = new Date(utc(d) + 86400000), d2 = nd.getUTCFullYear() + ('0' + (nd.getUTCMonth() + 1)).slice(-2) + ('0' + nd.getUTCDate()).slice(-2);
        out.push('BEGIN:VEVENT', 'UID:cbr-' + d1 + '@growth-syndicate', 'DTSTAMP:' + today.replace(/-/g, '') + 'T000000Z',
          'DTSTART;VALUE=DATE:' + d1, 'DTEND;VALUE=DATE:' + d2,
          'SUMMARY:Заседание Банка России по ключевой ставке',
          'DESCRIPTION:Решение по ключевой ставке обычно объявляют около 13:30 по Москве.',
          'BEGIN:VALARM', 'ACTION:DISPLAY', 'DESCRIPTION:Сегодня заседание Банка России', 'TRIGGER:PT9H', 'END:VALARM', 'END:VEVENT');
      });
      out.push('END:VCALENDAR');
      return out.join('\r\n') + '\r\n';
    }
    document.getElementById('cal-ics').addEventListener('click', function () {
      var msg = document.getElementById('cal-msg');
      if (!nextOf(todayMsk())) { msg.textContent = 'Будущих заседаний в календаре пока нет.'; return; }
      try {
        var blob = new Blob([ics()], { type: 'text/calendar;charset=utf-8' });
        var a = document.createElement('a');
        a.href = URL.createObjectURL(blob); a.download = 'zasedaniya-cb.ics';
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
        msg.textContent = 'Файл скачан: откройте его, чтобы добавить напоминания в календарь.';
      } catch (e) { msg.textContent = 'Не удалось создать файл. Воспользуйтесь кнопкой Google Календаря.'; }
    });
    document.addEventListener('visibilitychange', function () { if (!document.hidden) paint(); });   // обновляем отсчёт, когда вкладку открыли снова
  })();

  /* ======================================================================
     Накопить на цель и конвертер валют
     ====================================================================== */
  (function () {
    function g(id) { return document.getElementById(id); }
    function yrs(n) { var a = n % 100, b = n % 10; return n + ' ' + (a > 10 && a < 20 ? 'лет' : b === 1 ? 'год' : b >= 2 && b <= 4 ? 'года' : 'лет'); }

    function calcGoal() {
      var goal = num(g('gl-goal'), 0), y = parseInt(g('gl-years').value, 10), have = num(g('gl-have'), 0);
      var r = num(g('gl-rate'), 0) / 100, inf = num(g('gl-infl'), 0) / 100, real = g('gl-real').checked;
      g('gl-years-out').textContent = yrs(y);
      var n = y * 12, m = r / 12;
      var target = real ? goal * Math.pow(1 + inf, y) : goal;
      var grow = Math.pow(1 + m, n), fv = m === 0 ? n : (grow - 1) / m;
      var c = Math.max(0, (target - have * grow) / fv);
      var own = c * n + have;
      g('gl-pay').textContent = c === 0 && have > 0 ? 'не нужно, накоплений хватит' : rub(c);
      g('gl-target').textContent = rub(target);
      g('gl-own').textContent = rub(own);
      g('gl-interest').textContent = rub(Math.max(0, target - own));
    }
    ['gl-goal', 'gl-years', 'gl-have', 'gl-rate', 'gl-infl', 'gl-real'].forEach(function (id) {
      g(id).addEventListener('input', calcGoal); g(id).addEventListener('change', calcGoal);
    });

    var FX = D.fx || {};
    var fxFmt = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 });
    function calcFx() {
      var a = num(g('fx-amount'), 0), from = g('fx-from').value, to = g('fx-to').value;
      var rub1 = FX[from], rub2 = FX[to];
      if (!rub1 || !rub2) return;
      var out = a * rub1 / rub2, rate = rub1 / rub2;
      g('fx-out').textContent = fxFmt.format(out) + ' ' + to;
      g('fx-rate').textContent = from === to ? '1' : '1 ' + from + ' = ' + new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 4 }).format(rate) + ' ' + to;
      g('fx-note').textContent = 'Официальный курс Банка России на ' + FX.date + (FX.live ? '' : ' (автообновление сейчас недоступно, показаны последние известные значения)') +
        '. В банке и обменнике курс отличается: смотрите курс покупки и продажи.';
    }
    ['fx-amount', 'fx-from', 'fx-to'].forEach(function (id) {
      g(id).addEventListener('input', calcFx); g(id).addEventListener('change', calcFx);
    });
    calcGoal(); calcFx();
  })();

  /* ======================================================================
     Кредит: аннуитетный и дифференцированный платёж, ПСК
     ====================================================================== */
  (function () {
    function g(id) { return document.getElementById(id); }
    function schedule(S, n, i, type) {                       // платежи по месяцам
      var pays = [], bal = S, k;
      if (type === 'diff') {
        for (k = 0; k < n; k++) { pays.push(S / n + bal * i); bal -= S / n; }
      } else {
        var a = i === 0 ? S / n : S * i / (1 - Math.pow(1 + i, -n));
        for (k = 0; k < n; k++) pays.push(a);
      }
      return pays;
    }
    function psk(received, pays) {                           // месячная ставка, при которой выдача равна платежам
      var lo = 0, hi = 1, k;
      function pv(r) { var v = 0; for (k = 0; k < pays.length; k++) v += pays[k] / Math.pow(1 + r, k + 1); return v; }
      if (pv(0) <= received) return 0;
      for (var it = 0; it < 80; it++) { var mid = (lo + hi) / 2; if (pv(mid) > received) lo = mid; else hi = mid; }
      return (lo + hi) / 2 * 12 * 100;
    }
    function sum(a) { return a.reduce(function (x, y) { return x + y; }, 0); }
    function calcLoan() {
      var S = num(g('ln-amount'), 0), n = parseInt(g('ln-months').value, 10), r = num(g('ln-rate'), 0);
      var feePct = num(g('ln-fee'), 0), type = g('ln-type').value;
      g('ln-months-out').textContent = monthsText(n);
      var i = r / 100 / 12, fee = S * feePct / 100;
      var pays = schedule(S, n, i, type), total = sum(pays);
      var alt = schedule(S, n, i, type === 'diff' ? 'annuity' : 'diff');
      if (type === 'diff') {
        g('ln-pay-label').textContent = 'Платёж в месяц (первый и последний)';
        g('ln-pay').textContent = rub(pays[0]) + ' → ' + rub(pays[n - 1]);
        g('ln-alt-label').textContent = 'При аннуитетном платеже: ежемесячно, переплата';
        g('ln-alt').textContent = rub(alt[0]) + ', ' + rub(Math.max(0, sum(alt) - S));
      } else {
        g('ln-pay-label').textContent = 'Платёж в месяц';
        g('ln-pay').textContent = rub(pays[0]);
        g('ln-alt-label').textContent = 'При дифференцированном платеже: первый платёж, переплата';
        g('ln-alt').textContent = rub(alt[0]) + ', ' + rub(Math.max(0, sum(alt) - S));
      }
      g('ln-over').textContent = rub(Math.max(0, total - S));
      g('ln-feesum').textContent = rub(fee);
      g('ln-total').textContent = rub(total + fee);
      g('ln-psk').textContent = S > 0 ? fmtN.format(psk(S - fee, pays)) + '%' : '—';
      g('ln-share').textContent = fmt1.format(pays[0] / D.avgWage * 100) + '%';
    }
    ['ln-amount', 'ln-months', 'ln-rate', 'ln-type', 'ln-fee'].forEach(function (id) {
      g(id).addEventListener('input', calcLoan);
      g(id).addEventListener('change', calcLoan);
    });
    calcLoan();
  })();

  /* ======================================================================
     Налоги, вычеты, пенсия и сравнение вложений
     ====================================================================== */
  (function () {
    var T = D.tax;
    function plural(n, one, few, many) {
      var a = Math.abs(n) % 100, b = a % 10;
      if (a > 10 && a < 20) return many;
      if (b === 1) return one;
      if (b >= 2 && b <= 4) return few;
      return many;
    }
    function yrs(n) { return n + ' ' + plural(n, 'год', 'года', 'лет'); }
    function g(id) { return document.getElementById(id); }

    // налог по шкале НДФЛ: 13% до 2,4 млн, 15% до 5 млн и далее
    function ndfl(income) {
      var tax = 0, prev = 0;
      for (var i = 0; i < T.brackets.length; i++) {
        var top = T.brackets[i][0], rate = T.brackets[i][1];
        if (top === null || income <= top) { tax += (income - prev) * rate / 100; return tax; }
        tax += (top - prev) * rate / 100; prev = top;
      }
      return tax;
    }

    /* --- налог на проценты по вкладу --- */
    function calcTax() {
      var A = num(g('tx-amount'), 0), r = num(g('tx-rate'), 0);
      var income = A * r / 100;
      var free = T.free_base * T.free_rate / 100;
      var taxable = Math.max(0, income - free);
      var tax = Math.min(taxable, T.deposit_threshold) * 0.13 + Math.max(0, taxable - T.deposit_threshold) * 0.15;
      g('tx-income').textContent = rub(income);
      g('tx-free').textContent = rub(Math.min(income, free));
      g('tx-tax').textContent = rub(tax);
      g('tx-net').textContent = rub(income - tax);
    }
    ['tx-amount', 'tx-rate'].forEach(function (id) { g(id).addEventListener('input', calcTax); });

    /* --- вычеты --- */
    function calcDed() {
      var price = num(g('dd-price'), 0), inter = num(g('dd-int'), 0), iis = num(g('dd-iis'), 0), inc = num(g('dd-income'), 0);
      var k = T.rate / 100;
      var r1 = Math.min(price, T.home_limit) * k, r2 = Math.min(inter, T.interest_limit) * k, r3 = Math.min(iis, T.iis_limit) * k;
      var paid = ndfl(inc);
      g('dd-r1').textContent = rub(r1);
      g('dd-r2').textContent = rub(r2);
      g('dd-r3').textContent = rub(r3);
      g('dd-total').textContent = rub(r1 + r2 + r3);
      g('dd-paid').textContent = rub(paid);
      var y = paid > 0 ? Math.ceil((r1 + r2) / paid) : 0;
      g('dd-years').textContent = (r1 + r2) === 0 ? '—' : paid > 0 ? yrs(y) : 'нет дохода';
    }
    ['dd-price', 'dd-int', 'dd-iis', 'dd-income'].forEach(function (id) { g(id).addEventListener('input', calcDed); });

    /* --- пенсия (в сегодняшних ценах: реальная ставка = (1+r)/(1+инфляция) − 1) --- */
    var pAge = g('pn-age'), pRet = g('pn-ret'), pYears = g('pn-years');
    function calcPension() {
      var age = parseInt(pAge.value, 10), ret = parseInt(pRet.value, 10), pay = parseInt(pYears.value, 10);
      if (ret <= age) { ret = age + 1; pRet.value = ret; }
      g('pn-age-out').textContent = yrs(age);
      g('pn-ret-out').textContent = yrs(ret);
      g('pn-years-out').textContent = yrs(pay);
      var have = num(g('pn-have'), 0), save = num(g('pn-save'), 0), want = num(g('pn-want'), 0);
      var r = num(g('pn-rate'), 0) / 100, inf = num(g('pn-infl'), 0) / 100;
      var rr = Math.pow((1 + r) / (1 + inf), 1 / 12) - 1;
      var n = (ret - age) * 12, M = pay * 12;
      var grow = Math.pow(1 + rr, n);
      var fv = Math.abs(rr) < 1e-9 ? n : (grow - 1) / rr;                    // накопление взносов
      var af = Math.abs(rr) < 1e-9 ? M : (1 - Math.pow(1 + rr, -M)) / rr;     // «цена» одного рубля пенсии в месяц
      var cap = have * grow + save * fv;
      var need = want * af;
      var must = Math.max(0, (need - have * grow) / fv);
      g('pn-cap').textContent = rub(cap);
      g('pn-pension').textContent = rub(cap / af);
      g('pn-need').textContent = rub(need);
      g('pn-must').textContent = cap >= need ? 'уже хватает' : rub(must);
      var share = need > 0 ? cap / need * 100 : 100;
      g('pn-note').textContent = (cap >= need
        ? 'Накоплений хватит на желаемую пенсию, это ' + fmt0.format(share) + '% от нужной суммы.'
        : 'Накоплений хватит на ' + fmt0.format(share) + '% от желаемой пенсии.') +
        ' Государственная пенсия и налоги не учтены: государственная пенсия станет дополнением к накоплениям. Пополнения и выплаты растут вместе с инфляцией.';
    }
    ['pn-age', 'pn-ret', 'pn-have', 'pn-save', 'pn-want', 'pn-rate', 'pn-infl', 'pn-years'].forEach(function (id) { g(id).addEventListener('input', calcPension); });

    /* --- вклад, облигации, акции --- */
    function calcCompare() {
      var A = num(g('cp-amount'), 0), y = parseInt(g('cp-years').value, 10), inf = D.inflation / 100;
      g('cp-years-out').textContent = yrs(y);
      [1, 2, 3].forEach(function (i) {
        var v = A * Math.pow(1 + num(g('cp-r' + i), 0) / 100, y);
        g('cp-v' + i).textContent = rub(v);
        g('cp-p' + i).textContent = rub(v / Math.pow(1 + inf, y));
      });
    }
    ['cp-amount', 'cp-years', 'cp-r1', 'cp-r2', 'cp-r3'].forEach(function (id) { g(id).addEventListener('input', calcCompare); });

    /* --- вклад «на руки» --- */
    function depTax(inc) {
      var free = T.free_base * T.free_rate / 100, taxable = Math.max(0, inc - free);
      return Math.min(taxable, T.deposit_threshold) * 0.13 + Math.max(0, taxable - T.deposit_threshold) * 0.15;
    }
    function neg(x) { return rub(x).replace('-', '−'); }
    function calcNet() {
      var A = num(g('nt-amount'), 0), y = parseInt(g('nt-years').value, 10), r = num(g('nt-rate'), 0) / 100;
      var other = num(g('nt-other'), 0), inf = num(g('nt-infl'), 0) / 100, cap = g('nt-cap').value === 'm';
      g('nt-years-out').textContent = yrs(y);
      var bal = A, gross = 0, taxSum = 0, m = r / 12, k, start, income, tax;
      for (var year = 1; year <= y; year++) {
        start = bal;
        if (cap) { for (k = 0; k < 12; k++) bal *= 1 + m; income = bal - start; }
        else { income = A * r; bal += income; }
        tax = depTax(income + other) - depTax(other);              // налог именно с этого вклада
        bal -= tax; gross += income; taxSum += tax;
      }
      g('nt-net').textContent = rub(bal);
      g('nt-gross').textContent = rub(gross);
      g('nt-tax').textContent = rub(taxSum);
      g('nt-real').textContent = rub(bal / Math.pow(1 + inf, y));
      var yld = A > 0 ? (Math.pow(bal / A, 1 / y) - 1) * 100 : 0;
      var ry = A > 0 ? ((1 + yld / 100) / (1 + inf) - 1) * 100 : 0;
      g('nt-yield').textContent = fmtN.format(yld) + '%';
      g('nt-ryield').textContent = fmtN.format(ry).replace('-', '−') + '%';
    }
    ['nt-amount', 'nt-years', 'nt-rate', 'nt-cap', 'nt-other', 'nt-infl'].forEach(function (id) {
      g(id).addEventListener('input', calcNet); g(id).addEventListener('change', calcNet);
    });

    /* --- аренда или ипотека --- */
    function calcRent() {
      var price = num(g('rv-price'), 0), downP = parseInt(g('rv-down').value, 10), term = parseInt(g('rv-term').value, 10);
      var rate = num(g('rv-rate'), 0) / 100, maint = num(g('rv-maint'), 0) / 100, growth = parseFloat(g('rv-growth').value);
      var rent0 = num(g('rv-rent'), 0), rentG = num(g('rv-rentg'), 0) / 100, invR = num(g('rv-inv'), 0) / 100;
      var H = parseInt(g('rv-years').value, 10), inf = D.inflation / 100;
      if (!isFinite(growth)) growth = 0; growth /= 100;
      g('rv-down-out').textContent = downP + '%';
      g('rv-term-out').textContent = yrs(term);
      g('rv-years-out').textContent = yrs(H);
      var down = price * downP / 100, loan = price - down, n = term * 12, i = rate / 12;
      var pay = n === 0 ? 0 : (i === 0 ? loan / n : loan * i / (1 - Math.pow(1 + i, -n)));
      var mg = Math.pow(1 + growth, 1 / 12), mi = Math.pow(1 + invR, 1 / 12);
      var bal = loan, rentInv = down, buyExtra = 0, value = price, be = null;
      var wb = [], wr = [];                                           // капитал по годам
      for (var t = 1; t <= 360; t++) {
        var maintM = value * maint / 12;                              // содержание от текущей стоимости
        var rentT = rent0 * Math.pow(1 + rentG, Math.floor((t - 1) / 12));
        var ownOut = (t <= n ? pay : 0) + maintM;
        var diff = ownOut - rentT;
        rentInv = rentInv * mi + Math.max(diff, 0);
        buyExtra = buyExtra * mi + Math.max(-diff, 0);
        if (t <= n) bal = Math.max(0, bal * (1 + i) - pay);
        value *= mg;
        if (t % 12 === 0) {
          wb.push(value - bal + buyExtra); wr.push(rentInv);
          if (be === null && value - bal + buyExtra >= rentInv) be = t / 12;
        }
      }
      var bH = wb[H - 1], rH = wr[H - 1], deflate = Math.pow(1 + inf, H), delta = bH - rH;
      g('rv-pay').textContent = rub(pay);
      g('rv-own').textContent = rub(pay + price * maint / 12);
      g('rv-rentnow').textContent = rub(rent0);
      g('rv-wb-label').textContent = 'Капитал владельца через ' + yrs(H);
      g('rv-wr-label').textContent = 'Капитал арендатора через ' + yrs(H);
      g('rv-wb').textContent = rub(bH) + ' (' + rub(bH / deflate) + ' сегодня)';
      g('rv-wr').textContent = rub(rH) + ' (' + rub(rH / deflate) + ' сегодня)';
      g('rv-verdict').textContent = (delta >= 0 ? 'Покупка выгоднее на ' : 'Аренда выгоднее на ') + rub(Math.abs(delta));
      g('rv-be').textContent = be === null ? 'не выигрывает за 30 лет' : yrs(be);
    }
    ['rv-price', 'rv-down', 'rv-term', 'rv-rate', 'rv-maint', 'rv-growth', 'rv-rent', 'rv-rentg', 'rv-inv', 'rv-years'].forEach(function (id) {
      g(id).addEventListener('input', calcRent);
    });

    /* --- бюджет семьи --- */
    function calcBudget() {
      var gross = num(g('bd-gross'), 0), loan = num(g('bd-loan'), 0), comm = num(g('bd-comm'), 0), food = num(g('bd-food'), 0);
      var trans = num(g('bd-trans'), 0), other = num(g('bd-other'), 0), save = num(g('bd-save'), 0), have = num(g('bd-have'), 0);
      var r = num(g('bd-rate'), 0) / 100;
      var tax = ndfl(gross * 12) / 12, net = gross - tax;
      var fixed = loan + comm + food + trans + other, left = net - fixed, free = left - save;
      var rm = Math.pow(1 + r, 1 / 12) - 1, gr = Math.pow(1 + rm, 12);
      var year = have * gr + save * (rm === 0 ? 12 : (gr - 1) / rm);
      g('bd-net').textContent = rub(net);
      g('bd-tax').textContent = rub(tax);
      g('bd-fixed').textContent = rub(fixed);
      g('bd-free').textContent = neg(free);
      g('bd-free').className = free < 0 ? 'neg' : '';
      var dti = net > 0 ? loan / net * 100 : 0, sr = net > 0 ? save / net * 100 : 0;
      g('bd-dti').textContent = fmt1.format(dti) + '%';
      g('bd-rate-out').textContent = fmt1.format(sr) + '%';
      g('bd-year').textContent = rub(year);
      g('bd-cushion').textContent = fixed > 0 ? fmt1.format(have / fixed) : '—';
      var note;
      if (free < 0) note = 'Расходов и откладываемой суммы больше, чем остаётся на руки: не хватает ' + rub(-free) + ' в месяц. Стоит сократить расходы или сумму на вклад.';
      else if (dti > 50) note = 'Платежи по кредитам занимают больше половины дохода на руки, это высокая нагрузка. Проверьте возможность досрочного погашения или рефинансирования.';
      else note = 'Ориентиры, которые часто называют финансовые консультанты: платежи по кредитам до 30–35% дохода, откладывать от 10% дохода, подушка безопасности на 3–6 месяцев расходов.';
      g('bd-note').textContent = note + ' НДФЛ посчитан для одного человека по прогрессивной шкале с учётом всего годового дохода; если доход получают двое, налог будет меньше. Налог на проценты по вкладу здесь не учтён.';
    }
    ['bd-gross', 'bd-loan', 'bd-comm', 'bd-food', 'bd-trans', 'bd-other', 'bd-save', 'bd-have', 'bd-rate'].forEach(function (id) {
      g(id).addEventListener('input', calcBudget);
    });

    calcNet(); calcRent(); calcBudget();
    calcTax(); calcDed(); calcPension(); calcCompare();
  })();

  /* ======================================================================
     Установка как приложение и работа без сети
     ====================================================================== */
  var installBtn = $('install-btn'), deferredPrompt = null;
  window.addEventListener('beforeinstallprompt', function (e) {
    e.preventDefault();
    deferredPrompt = e;
    installBtn.hidden = false;
  });
  installBtn.addEventListener('click', function () {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    deferredPrompt.userChoice.then(function () { deferredPrompt = null; installBtn.hidden = true; });
  });
  window.addEventListener('appinstalled', function () { installBtn.hidden = true; });
  /* формы-калькуляторы не отправляются на сервер; шрифты подключаются без inline-обработчиков */
  document.addEventListener('submit', function (e) { e.preventDefault(); });
  Array.prototype.forEach.call(document.querySelectorAll('link[rel="stylesheet"][media="print"]'), function (l) { l.media = 'all'; });

  if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
    window.addEventListener('load', function () { navigator.serviceWorker.register('sw.js').catch(function () {}); });
  }

  /* ---------- сортировка таблицы регионов ---------- */
  var table = document.getElementById('regions-table');
  var tbody = table.tBodies[0];
  var sortState = { key: null, dir: 'desc' };
  function applySort(key, dir) {
    sortState.key = key; sortState.dir = dir;
    Array.prototype.forEach.call(table.querySelectorAll('button.sort'), function (b) {
      if (b.getAttribute('data-key') === key) b.setAttribute('data-dir', dir); else b.removeAttribute('data-dir');
    });
    var rows = Array.prototype.filter.call(tbody.rows, function (r) { return !r.classList.contains('pinned'); });
    rows.sort(function (a, b) {
      var va = parseFloat(a.getAttribute('data-' + key)), vb = parseFloat(b.getAttribute('data-' + key));
      var na = isNaN(va), nb = isNaN(vb);
      if (na && nb) return 0;
      if (na) return 1;
      if (nb) return -1;
      return dir === 'desc' ? vb - va : va - vb;
    });
    rows.forEach(function (r) { tbody.appendChild(r); });
  }
  Array.prototype.forEach.call(table.querySelectorAll('button.sort'), function (btn) {
    btn.addEventListener('click', function () {
      var key = btn.getAttribute('data-key');
      var dir = sortState.key === key && sortState.dir === 'desc' ? 'asc' : 'desc';
      applySort(key, dir);
      var sel = document.getElementById('regions-sort');
      if (sel) sel.value = key + ':' + dir;
    });
  });
  var sortSel = document.getElementById('regions-sort');       // выбор сортировки на телефоне
  if (sortSel) sortSel.addEventListener('change', function () {
    if (!sortSel.value) return;
    var parts = sortSel.value.split(':');
    applySort(parts[0], parts[1]);
  });

  /* ---------- подписи ячеек: на узком экране таблица превращается в карточки ---------- */
  function labelTable(t) {
    var heads = Array.prototype.map.call(t.querySelectorAll('thead th'), function (th) {
      return (th.textContent || '').replace(/\s+/g, ' ').trim();
    });
    Array.prototype.forEach.call(t.tBodies, function (tb) {
      Array.prototype.forEach.call(tb.rows, function (tr) {
        Array.prototype.forEach.call(tr.cells, function (c, i) {
          if (heads[i] && c.getAttribute('data-label') !== heads[i]) c.setAttribute('data-label', heads[i]);
        });
      });
    });
  }
  Array.prototype.forEach.call(document.querySelectorAll('table.regions'), function (t) {
    labelTable(t);
    Array.prototype.forEach.call(t.tBodies, function (tb) {
      new MutationObserver(function () { labelTable(t); }).observe(tb, { childList: true });
    });
  });

  /* ======================================================================
     Сценарии (пессимистичный / базовый / оптимистичный), «вилка» и ссылка на расчёты
     ====================================================================== */
  (function () {
    var bar = document.getElementById('scenarios');
    if (!bar || !D.scenarios) return;
    var KEYS = ['pess', 'base', 'opt'];
    var BASE_INFL = D.inflation;
    var busy = false;
    var STORE = 'calc-state-v1';
    var SKIP = { 'mor-preset': 1, 'inv-preset': 1 };          // подбираются по ставке сами

    var scnFields = Array.prototype.slice.call(document.querySelectorAll('[data-scn]'));
    var allFields = Array.prototype.slice.call(document.querySelectorAll('.calc input[id], .calc select[id]'))
      .filter(function (f) { return !SKIP[f.id] && !f.readOnly; });
    var defaults = {};                                           // значения при загрузке страницы
    allFields.forEach(function (f) { defaults[f.id] = f.type === 'checkbox' ? f.checked : f.value; });

    function idle(fn) { (window.requestIdleCallback || function (f) { setTimeout(f, 200); })(fn, { timeout: 1500 }); }
    function round2(v) { return Math.round(v * 100) / 100; }
    function limits(f) {
      var mn = parseFloat(f.getAttribute('min')), mx = parseFloat(f.getAttribute('max'));
      return [isFinite(mn) ? mn : 0, isFinite(mx) ? mx : Infinity];
    }
    function clamp(f, v) { var l = limits(f); return Math.min(l[1], Math.max(l[0], v)); }
    function shiftOf(key, kind) { return (D.scenarios[key].shift[kind]) || 0; }
    function fire(f) { f.dispatchEvent(new Event('input', { bubbles: true })); }
    function recalcAll() {
      Array.prototype.forEach.call(document.querySelectorAll('.calc'), function (form) {
        var first = form.querySelector('input[id]'); if (first) fire(first);
      });
      ['mor-rate', 'inv-rate'].forEach(function (id) { fire(document.getElementById(id)); });   // заодно подбирают выбранную программу
    }

    // применяет сценарий: сдвигает значения относительно прежнего сценария, чтобы свои правки не терялись
    function applyScenario(key, opts) {
      opts = opts || {};
      var prev = SC.current;
      scnFields.forEach(function (f) {
        var kind = f.getAttribute('data-scn');
        var v = parseFloat(f.value);
        if (!isFinite(v)) return;
        f.value = round2(clamp(f, v + shiftOf(key, kind) - shiftOf(prev, kind)));
      });
      SC.current = key; SC.shift = D.scenarios[key].shift;
      D.inflation = Math.max(0, round2(BASE_INFL + shiftOf(key, 'infl')));
      paintBar();
      if (!opts.silent) { busy = true; recalcAll(); busy = false; computeFork(); schedule(); }
    }

    function paintBar() {
      Array.prototype.forEach.call(bar.querySelectorAll('.scn-btn'), function (b) {
        var on = b.getAttribute('data-scn-key') === SC.current;
        b.setAttribute('aria-checked', on ? 'true' : 'false');
        b.classList.toggle('on', on);
        b.tabIndex = on ? 0 : -1;
      });
      var sc = D.scenarios[SC.current], notes = D.scenarioNotes || {}, parts = [];
      Object.keys(notes).forEach(function (k) {
        var d = sc.shift[k] || 0;
        if (d) parts.push(notes[k] + ' ' + (d > 0 ? '+' : '−') + Math.abs(d) + '\u00a0п.\u00a0п.');
      });
      document.getElementById('scn-desc').textContent = sc.desc + (parts.length ? ' Сдвиги: ' + parts.join(', ') + '.' : '');
    }

    /* ---- вилка: считаем те же калькуляторы при трёх сценариях и возвращаем всё обратно ---- */
    var FORK = [
      ['Вклад: итоговая сумма', 'dep-final'], ['Вклад: доход с учётом инфляции', 'dep-real'],
      ['Ипотека: платёж в месяц', 'mor-pay'], ['Кредит: платёж в месяц', 'ln-pay'],
      ['Инвестиции: итоговая сумма', 'inv-final'], ['Инвестиции: итог в сегодняшних ценах', 'inv-real'],
      ['Вклад на руки: итог', 'nt-net'], ['Вклад на руки: реальная доходность', 'nt-ryield'],
      ['Пенсия от накоплений в месяц', 'pn-pension'], ['Аренда или ипотека', 'rv-verdict']
    ];
    var forkBody = document.getElementById('fork-body');
    var forkBusy = false;
    function computeFork() {
      if (forkBusy) return;
      forkBusy = true; busy = true; SKIP_DRAW = true;
      var cur = SC.current, curShift = SC.shift, curInfl = D.inflation, saved = {};
      scnFields.forEach(function (f) { saved[f.id] = f.value; });
      var savedRate = dRateValue();
      var out = {};
      KEYS.forEach(function (k) {
        scnFields.forEach(function (f) {
          var kind = f.getAttribute('data-scn'), v = parseFloat(saved[f.id]);
          if (isFinite(v)) f.value = round2(clamp(f, v + shiftOf(k, kind) - shiftOf(cur, kind)));
        });
        SC.shift = D.scenarios[k].shift; D.inflation = Math.max(0, round2(BASE_INFL + shiftOf(k, 'infl')));
        recalcAll();
        out[k] = FORK.map(function (row) { return (document.getElementById(row[1]).textContent || '').trim(); });
      });
      scnFields.forEach(function (f) { f.value = saved[f.id]; });
      SC.shift = curShift; D.inflation = curInfl; SC.current = cur;
      SKIP_DRAW = false;
      recalcAll();
      if (!rateEdited) dRateRestore(savedRate);
      forkBusy = false; busy = false;
      forkBody.textContent = '';
      FORK.forEach(function (row, i) {
        var tr = document.createElement('tr');
        var th = document.createElement('th'); th.scope = 'row'; th.className = 'c-name'; th.textContent = row[0]; tr.appendChild(th);
        KEYS.forEach(function (k) {
          var td = document.createElement('td'); td.className = 'num' + (k === cur ? ' scn-cur' : ''); td.textContent = out[k][i]; tr.appendChild(td);
        });
        forkBody.appendChild(tr);
      });
    }
    function dRateValue() { return dRate.value; }
    function dRateRestore(v) { dRate.value = v; }

    /* ---- состояние в ссылке и в localStorage ---- */
    function currentState() {
      var st = {}, defScn = SC.current;
      allFields.forEach(function (f) {
        var def = defaults[f.id], v = f.type === 'checkbox' ? f.checked : f.value;
        if (f.id === 'dep-rate') { if (!rateEdited) return; st[f.id] = v; return; }
        if (f.hasAttribute('data-scn')) {
          var kind = f.getAttribute('data-scn');
          var expect = round2(clamp(f, parseFloat(def) + shiftOf(defScn, kind)));
          if (Math.abs(parseFloat(v) - expect) < 0.005) return;
          st[f.id] = v; return;
        }
        if (f.type === 'checkbox') { if (v !== def) st[f.id] = v ? '1' : '0'; return; }
        if (String(v) !== String(def)) st[f.id] = v;
      });
      var qs = new URLSearchParams();
      if (SC.current !== 'base') qs.set('s', SC.current);
      Object.keys(st).forEach(function (k) { qs.set(k, st[k] === true ? '1' : st[k] === false ? '0' : st[k]); });
      return qs.toString();
    }
    var timer = null;
    function schedule() { clearTimeout(timer); timer = setTimeout(save, 350); }
    function save() {
      var qs = currentState();
      try { history.replaceState(null, '', location.pathname + (qs ? '?' + qs : '') + location.hash); } catch (e) {}
      try { if (qs) localStorage.setItem(STORE, qs); else localStorage.removeItem(STORE); } catch (e) {}
    }
    function applyQuery(qs) {
      var q = new URLSearchParams(qs), n = 0;
      busy = true;
      var s = q.get('s');
      if (s && KEYS.indexOf(s) >= 0 && s !== SC.current) applyScenario(s, { silent: true });
      allFields.forEach(function (f) {
        if (!q.has(f.id)) return;
        var raw = q.get(f.id);
        if (f.type === 'checkbox') { f.checked = raw === '1'; n++; return; }
        if (f.tagName === 'SELECT') {
          var ok = Array.prototype.some.call(f.options, function (o) { return o.value === raw; });
          if (ok) { f.value = raw; n++; }
          return;
        }
        var v = parseFloat(raw);
        if (!isFinite(v)) return;
        f.value = round2(clamp(f, v)); n++;
        if (f.id === 'dep-rate') rateEdited = true;
      });
      recalcAll();
      busy = false;
      paintBar(); idle(computeFork);
      return n;
    }
    function resetAll() {
      busy = true;
      SC.current = 'base'; SC.shift = D.scenarios.base.shift; D.inflation = BASE_INFL;
      allFields.forEach(function (f) { if (f.type === 'checkbox') f.checked = defaults[f.id]; else f.value = defaults[f.id]; });
      rateEdited = false;
      recalcAll();
      busy = false;
      paintBar(); computeFork();
      try { history.replaceState(null, '', location.pathname + location.hash); localStorage.removeItem(STORE); } catch (e) {}
    }

    /* ---- события ---- */
    Array.prototype.forEach.call(bar.querySelectorAll('.scn-btn'), function (b, i, all) {
      b.addEventListener('click', function () { applyScenario(b.getAttribute('data-scn-key')); setStatus(''); });
      b.addEventListener('keydown', function (e) {
        var d = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
        if (!d) return;
        e.preventDefault();
        var nb = all[(i + d + all.length) % all.length];
        nb.focus(); nb.click();
      });
    });
    var statusEl = document.getElementById('scn-status');
    function setStatus(t) { statusEl.textContent = t; }
    var fieldTimer = null;
    document.addEventListener('input', function (e) {
      if (busy || !e.target || !e.target.closest || !e.target.closest('.calc')) return;
      schedule();
      // пока человек печатает ставку, вилку не пересчитываем (это временно меняет поле); пересчёт будет по окончании ввода
      if (e.target.hasAttribute('data-scn') && e.target.type === 'number') return;
      clearTimeout(fieldTimer); fieldTimer = setTimeout(computeFork, 450);
    });
    document.addEventListener('change', function (e) {
      if (busy || !e.target || !e.target.closest || !e.target.closest('.calc')) return;
      schedule();
      clearTimeout(fieldTimer); fieldTimer = setTimeout(computeFork, 450);
    });
    document.getElementById('scn-reset').addEventListener('click', function () { resetAll(); setStatus('Все значения сброшены.'); });
    document.getElementById('scn-copy').addEventListener('click', function () {
      clearTimeout(timer); save();
      var qs = currentState();
      var url = location.origin === 'null' || location.protocol === 'file:' ? location.href.split(/[?#]/)[0] : location.origin + location.pathname;
      url += (qs ? '?' + qs : '') + '#kalkulyatory';
      var row = document.getElementById('scn-link-row'), inp = document.getElementById('scn-link');
      inp.value = url; row.hidden = false;
      function manual() { inp.focus(); inp.select(); setStatus('Скопируйте ссылку вручную (Ctrl+C).'); }
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(url).then(function () { setStatus('Ссылка скопирована.'); }, manual);
      } else manual();
    });

    /* ---- запуск ---- */
    paintBar();
    var fromUrl = location.search.length > 1;
    var qsInit = fromUrl ? location.search.slice(1) : (function () { try { return localStorage.getItem(STORE) || ''; } catch (e) { return ''; } })();
    if (qsInit) {
      var n = applyQuery(qsInit);
      if (fromUrl) setStatus('Открыты расчёты по ссылке' + (n ? ' (изменено полей: ' + n + ')' : '') + '. Кнопка «Сбросить всё» вернёт значения по умолчанию.');
      else setStatus('Восстановлены ваши последние расчёты. «Сбросить всё» вернёт значения по умолчанию.');
      if (fromUrl && n) setTimeout(function () { var el = document.getElementById('scenarios'); if (el && !location.hash) el.scrollIntoView(); }, 0);
    } else {
      idle(computeFork);              // вилку считаем, когда браузер свободен, чтобы страница открывалась быстрее
    }
  })();
})();
