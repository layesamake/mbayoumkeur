// Visuel de statut WhatsApp (1080 × 1920) pour une plante.
// Dessiné sur le téléphone, sans serveur : fonctionne aussi hors connexion (polices et logo sont en cache).
// Même univers visuel que le statut de présentation : vert profond, sillons, arche sur la photo, soleil.
(() => {
  const W = 1080, H = 1920, CX = W / 2;
  const C = { leaf900: '#04481a', leaf100: '#e1f1cd', sun: '#f2a900', sunSoft: '#f3d27a', carrot: '#fc7404', cream: '#fbf6e9' };

  const rrect = (g, x, y, w, h, r) => {   // roundRect n'existe pas sur les navigateurs un peu anciens
    g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
  };
  // texte avec espacement des lettres (letterSpacing n'existe pas partout) ; align : 'center' ou 'left'
  const spaced = (g, text, x, y, sp, align = 'center') => {
    const chars = [...text], ws = chars.map((ch) => g.measureText(ch).width);
    const total = ws.reduce((a, b) => a + b, 0) + sp * (chars.length - 1), prev = g.textAlign;
    let cx = align === 'center' ? x - total / 2 : x;
    g.textAlign = 'left'; chars.forEach((ch, i) => { g.fillText(ch, cx, y); cx += ws[i] + sp; }); g.textAlign = prev;
    return total;
  };
  const spacedWidth = (g, text, sp) => [...text].reduce((a, ch) => a + g.measureText(ch).width, 0) + sp * (text.length - 1);

  async function bitmap(blob) {
    if (!blob) return null;
    try { return await createImageBitmap(blob); } catch { /* repli : image classique */ }
    return new Promise((ok) => {
      const u = URL.createObjectURL(blob), i = new Image();
      i.onload = () => { URL.revokeObjectURL(u); ok(i); }; i.onerror = () => { URL.revokeObjectURL(u); ok(null); }; i.src = u;
    });
  }
  const loadImg = (src) => new Promise((ok) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => ok(null); i.src = src; });

  // Le nom sur une ou deux lignes, à la plus grande taille qui tient (860 px de large au plus)
  function fitName(g, name) {
    const max = 860, words = name.trim().split(/\s+/);
    for (let s = 120; s >= 88; s -= 4) { g.font = `800 ${s}px Fraunces`; if (g.measureText(name).width <= max) return { size: s, lines: [name] }; }
    if (words.length > 1) {
      for (let s = 108; s >= 72; s -= 4) {
        g.font = `800 ${s}px Fraunces`;
        let best = null;
        for (let i = 1; i < words.length; i++) {
          const a = words.slice(0, i).join(' '), b = words.slice(i).join(' ');
          const w = Math.max(g.measureText(a).width, g.measureText(b).width);
          if (!best || w < best.w) best = { w, lines: [a, b] };
        }
        if (best.w <= max) return { size: s, lines: best.lines };
      }
    }
    for (let s = 84; s >= 52; s -= 4) { g.font = `800 ${s}px Fraunces`; if (g.measureText(name).width <= max) return { size: s, lines: [name] }; }
    g.font = '800 52px Fraunces';
    return { size: 52, lines: [name.length > 30 ? name.slice(0, 29) + '…' : name] };
  }

  const shortShop = (n) => String(n || '').replace(/quartier\s+/i, '').replace(/\s*[–-]\s*/, ' · ').toUpperCase();

  // plante : { titre, local, prix, unite, photo (Blob ou null), shops: [{ name, display }] } → Blob JPEG
  async function render(plante) {
    try {
      await Promise.all([document.fonts.load('800 100px Fraunces'), document.fonts.load('400 40px "Source Sans 3"'),
        document.fonts.load('600 26px "Source Sans 3"'), document.fonts.load('700 44px "Source Sans 3"')]);
    } catch { /* on dessine avec les polices disponibles */ }
    const [photo, emblem] = await Promise.all([bitmap(plante.photo), loadImg('/img/emblem.png')]);
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const g = c.getContext('2d'); g.textBaseline = 'alphabetic';

    // fond : vert profond, lumière qui monte du bas
    const grad = g.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, '#033b15'); grad.addColorStop(0.55, '#04481a'); grad.addColorStop(1, '#0a5a1c');
    g.fillStyle = grad; g.fillRect(0, 0, W, H);

    // sillons ondulés en haut (le motif du logo), très discrets
    g.lineWidth = 2;
    for (let i = 0; i < 9; i++) {
      const y0 = 40 + i * 34; g.strokeStyle = `rgba(122,196,60,${0.05 + i * 0.006})`; g.beginPath();
      for (let x = -20; x <= W + 20; x += 8) { const y = y0 + Math.sin(x / 150 + i * 0.55) * 20 + Math.sin(x / 61 + i) * 3; x === -20 ? g.moveTo(x, y) : g.lineTo(x, y); }
      g.stroke();
    }
    // rangs de culture qui convergent vers l'horizon
    const V = { x: CX, y: 1000 }, rows = 34;
    for (let i = 0; i < rows; i++) {
      const t = i / (rows - 1), xb = -900 + t * (W + 1800), a = 0.05 + 0.13 * (1 - Math.abs(t - 0.5) * 1.6);
      const lg = g.createLinearGradient(V.x, V.y, xb, H);
      lg.addColorStop(0, 'rgba(122,196,60,0)'); lg.addColorStop(0.35, `rgba(150,214,80,${Math.max(a, 0.04)})`); lg.addColorStop(1, `rgba(150,214,80,${Math.max(a * 0.8, 0.03)})`);
      g.strokeStyle = lg; g.lineWidth = 1.6; g.beginPath(); g.moveTo(V.x, V.y); g.lineTo(xb, H); g.stroke();
    }

    // marque : emblème dans son disque solaire + nom
    {
      const cy = 252, r = 44;
      g.fillStyle = C.sunSoft; g.beginPath(); g.arc(CX - 190, cy, r, 0, Math.PI * 2); g.fill();
      if (emblem) g.drawImage(emblem, CX - 190 - 34, cy - 34, 68, 68);
      g.fillStyle = C.cream; g.textAlign = 'left'; g.font = '800 56px Fraunces'; g.fillText('MBayoum Keur', CX - 122, cy + 8);
      g.font = '600 23px "Source Sans 3"'; g.fillStyle = 'rgba(223,240,207,0.85)'; spaced(g, 'MBAYOUMKEUR.SHOP', CX - 120, cy + 42, 5, 'left');
    }

    // l'arche : un seuil sur la plante
    const AX = CX, AR = 290, ATOP = 340, ABOT = 1010, cyArc = ATOP + AR;
    const arch = (r) => { g.beginPath(); g.moveTo(AX - r, ABOT); g.lineTo(AX - r, cyArc); g.arc(AX, cyArc, r, Math.PI, 0); g.lineTo(AX + r, ABOT); g.closePath(); };
    g.strokeStyle = C.sun; g.lineWidth = 3; arch(AR + 22); g.stroke();
    g.save(); arch(AR); g.clip();
    const bw = AR * 2, bh = ABOT - ATOP;
    if (photo) {
      const iw = photo.width, ih = photo.height, s = Math.max(bw / iw, bh / ih), sw = bw / s, sh = bh / s;
      g.drawImage(photo, (iw - sw) / 2, (ih - sh) / 2, sw, sh, AX - AR, ATOP, bw, bh);
      const vg = g.createLinearGradient(0, ABOT - 220, 0, ABOT); vg.addColorStop(0, 'rgba(4,72,26,0)'); vg.addColorStop(1, 'rgba(4,72,26,0.55)');
      g.fillStyle = vg; g.fillRect(AX - AR, ABOT - 220, bw, 220);
    } else {
      g.fillStyle = '#0f6a26'; g.fillRect(AX - AR, ATOP, bw, bh);
      if (emblem) { g.globalAlpha = 0.9; g.drawImage(emblem, AX - 150, ATOP + bh / 2 - 150, 300, 300); g.globalAlpha = 1; }
    }
    g.restore();
    g.strokeStyle = 'rgba(243,210,122,0.38)'; g.lineWidth = 2; g.beginPath(); g.moveTo(90, ABOT); g.lineTo(W - 90, ABOT); g.stroke();
    g.fillStyle = C.sun; g.beginPath(); g.arc(940, 410, 42, 0, Math.PI * 2); g.fill();   // soleil rationné

    // pastille « Disponible » posée sur la photo
    {
      g.font = '700 30px "Source Sans 3"';
      const label = 'DISPONIBLE', tw = spacedWidth(g, label, 3), w = tw + 76, h = 58, x = AX - AR + 26, y = ABOT - h - 26;
      g.fillStyle = C.cream; rrect(g, x, y, w, h, h / 2); g.fill();
      g.fillStyle = '#2b9d3e'; g.beginPath(); g.arc(x + 30, y + h / 2, 9, 0, Math.PI * 2); g.fill();
      g.fillStyle = C.leaf900; spaced(g, label, x + 52, y + 39, 3, 'left');
    }

    // nom de la plante, sculpté (une ou deux lignes), puis son nom wolof s'il existe
    const nm = fitName(g, (plante.titre || '').trim() || 'Plante');
    const lineH = Math.round(nm.size * 1.04), nameBlock = nm.size * 0.78 + (nm.lines.length - 1) * lineH;
    const free = 1470 - ABOT - nameBlock - (plante.local ? 58 : 0) - 140;     // l'espace restant se répartit sous l'arche
    let y = ABOT + Math.max(30, free * 0.4) + nm.size * 0.78;
    g.textAlign = 'center'; g.fillStyle = C.cream; g.font = `800 ${nm.size}px Fraunces`;
    nm.lines.forEach((ln, i) => g.fillText(ln, CX, y + i * lineH));
    y += (nm.lines.length - 1) * lineH;
    if (plante.local) { y += 58; g.font = '400 42px "Source Sans 3"'; g.fillStyle = C.sunSoft; g.fillText('En wolof : ' + plante.local, CX, y); }

    // prix : pastille solaire
    {
      y += plante.local ? 36 : 52; const h = 104;
      if (plante.prix > 0) {
        const main = new Intl.NumberFormat('fr-FR').format(plante.prix).replace(/[  ]/g, ' ') + ' FCFA', unit = plante.unite ? '/ ' + plante.unite : '';
        g.font = '800 70px Fraunces'; const mw = g.measureText(main).width;
        g.font = '600 38px "Source Sans 3"'; const uw = unit ? g.measureText(unit).width + 20 : 0;
        const w = mw + uw + 84, x = CX - w / 2;
        g.fillStyle = C.sun; rrect(g, x, y, w, h, h / 2); g.fill();
        g.fillStyle = C.leaf900; g.textAlign = 'left'; g.font = '800 70px Fraunces'; g.fillText(main, x + 42, y + 74);
        if (unit) { g.font = '600 38px "Source Sans 3"'; g.fillText(unit, x + 42 + mw + 20, y + 72); }
      } else {
        g.font = '700 46px "Source Sans 3"'; const w = g.measureText('Prix sur demande').width + 84, x = CX - w / 2;
        g.strokeStyle = C.sun; g.lineWidth = 3; rrect(g, x, y, w, h, h / 2); g.stroke();
        g.fillStyle = C.sunSoft; g.textAlign = 'center'; g.fillText('Prix sur demande', CX, y + 66);
      }
    }

    // points de vente (jusqu'à deux colonnes)
    const shops = (plante.shops || []).slice(0, 2);
    if (shops.length) {
      const xs = shops.length === 1 ? [CX] : [CX - 235, CX + 235];
      shops.forEach((s, i) => {
        g.fillStyle = C.sunSoft; g.font = '600 24px "Source Sans 3"'; spaced(g, shortShop(s.name), xs[i], 1512, 3);
        g.fillStyle = C.cream; g.font = '700 42px "Source Sans 3"'; g.textAlign = 'center'; g.fillText(s.display || '', xs[i], 1562);
      });
      if (shops.length === 2) { g.strokeStyle = 'rgba(251,246,233,0.3)'; g.lineWidth = 1.5; g.beginPath(); g.moveTo(CX, 1486); g.lineTo(CX, 1574); g.stroke(); }
    }

    // appel à l'action
    {
      const w = 700, h = 104, x = CX - w / 2, yy = 1620;
      g.fillStyle = C.carrot; rrect(g, x, yy, w, h, h / 2); g.fill();
      g.fillStyle = C.leaf900; g.font = '700 46px "Source Sans 3"'; g.textAlign = 'center'; g.fillText('Commandez sur WhatsApp', CX, yy + 68);
    }

    // grain fin, comme un papier travaillé
    let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 30000; i++) { g.fillStyle = rnd() > 0.5 ? 'rgba(255,255,255,0.035)' : 'rgba(0,0,0,0.05)'; g.fillRect(rnd() * W, rnd() * H, 1.4, 1.4); }

    return new Promise((ok, ko) => c.toBlob((b) => (b ? ok(b) : ko(new Error('canvas'))), 'image/jpeg', 0.92));
  }

  window.mbkStatus = { render };
})();
