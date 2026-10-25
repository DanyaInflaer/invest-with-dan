(function () {
  'use strict';

  var D = JSON.parse(document.getElementById('site-data').textContent);
  var NS = 'http://www.w3.org/2000/svg';
  var redrawers = [];          // функции, которые перерисовывают графики при изменении ширины окна
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
      rateReadout.innerHTML =
        '<span class="rd">' + D.rate.full[i] + '</span>' +
        '<span class="r1">Ставка <b>' + pct(D.rate.key[i]) + '</b></span>' +
        '<span class="r2">Инфляция <b>' + pct(D.rate.infl[i]) + '</b></span>' +
        '<span class="rd">Разрыв ' + fmtN.format(gap) + ' п. п.</span>';
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
      wageReadout.innerHTML = '<span class="rd">' + D.wage.full[i] + '</span>' +
        (v === null ? '<span class="rd">значение не найдено в источниках</span>'
          : '<span class="r1">Зарплата <b>' + rub(v * 1000) + '</b></span>');
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
    if (!rateEdited) { dRate.value = b.rate; r = b.rate; }
    dRateHint.textContent = rateEdited ? '' : 'средняя максимальная для срока: ' + b.label;
    var final = dCap.checked ? P * Math.pow(1 + r / 100 / 12, m) : P * (1 + r / 100 * m / 12);
    var income = final - P;
    var real = final / Math.pow(1 + D.inflation / 100, m / 12) - P;
    document.getElementById('dep-income').textContent = rub(income);
    document.getElementById('dep-final').textContent = rub(final);
    document.getElementById('dep-real').textContent = (real < 0 ? '−' : '') + rub(Math.abs(real));
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
    return function (cfg) {
      last = cfg || last;
      if (!last) return;
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
        var html = '<span class="rd">' + cfg.full[i] + '</span>';
        cfg.series.forEach(function (s, k) {
          dots[k].setAttribute('cx', X(i)); dots[k].setAttribute('cy', f.Y(s.values[i]));
          html += '<span class="r' + s.cls.slice(1) + '">' + s.name + ' <b>' + rub(s.values[i]) + '</b></span>';
        });
        readout.innerHTML = html;
      }
      bindPick(f, n, X, function () { return idx; }, show);
      show(idx);
    };
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
    p2.textContent = 'Исходные данные: ключевая ставка ' + pct(D.keyRate) + ', инфляция за год ' + pct(D.inflation) + '.' + (D.asOf ? ' Данные на ' + D.asOf + '.' : '');
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
  window.addEventListener('beforeprint', function () { buildReport(); document.body.classList.add('printing'); });
  window.addEventListener('afterprint', function () { document.body.classList.remove('printing'); $('report').textContent = ''; });
  $('pdf-btn').addEventListener('click', function () {
    var msg = $('pdf-msg');
    msg.textContent = '';
    try { window.print(); } catch (e) { msg.textContent = 'Не удалось открыть окно печати. Нажмите Ctrl+P (на телефоне: меню браузера, «Печать»).'; }
  });

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
})();
