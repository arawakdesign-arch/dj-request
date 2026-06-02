// ══ HELPERS RENDER ═══════════════════════════════════════════════════
function sorted()     { return Object.entries(proposals).map(([id,p]) => ({id,...p})).sort((a,b) => (b.votes||0) - (a.votes||0)); }
function totalVotes() { return Object.values(proposals).reduce((s,p) => s + (p.votes||0), 0); }
function totalVoters(){ const s = new Set(); Object.values(proposals).forEach(p => Object.keys(p.voters||{}).forEach(v => s.add(v))); return s.size; }
function renderAll()  { renderClient(); renderDJ(); renderBS(); updateNP(); updateDJStats(); }

// ── Album art (cache iTunes) ──────────────────────────────────────────
const artCache = {};
async function fetchAlbumArt(songName, artist) {
  const key = songName + artist;
  if (artCache[key] !== undefined) return artCache[key];
  artCache[key] = null;
  try {
    const q   = encodeURIComponent(`${songName} ${artist}`);
    const res = await fetch(`https://itunes.apple.com/search?term=${q}&media=music&limit=1&country=fr`);
    const data = await res.json();
    if (data.results?.[0]) artCache[key] = data.results[0].artworkUrl100.replace('100x100', '300x300');
  } catch(e) {}
  return artCache[key];
}

// ── Page Client (vote) ────────────────────────────────────────────────
function renderClient() {
  const s  = sorted();
  const t  = totalVotes();
  elt('cli-total', t ? `${t} vote${t > 1 ? 's' : ''}` : '-');
  const fn = document.getElementById('flyer-ev-name'); if (fn) fn.textContent = ename;
  const cs = document.getElementById('club-name-strip'); if (cs && CLUB_INFO.name) cs.textContent = CLUB_INFO.name;
  const list = document.getElementById('cli-list'); if (!list) return;
  if (!s.length) { list.innerHTML = `<div class="empty-state"><div class="ei">🎵</div><p>Aucune proposition pour l'instant.<br>Soyez le premier à proposer !</p></div>`; return; }
  const mx     = s[0]?.votes || 1;
  const medals = ['🥇','🥈','🥉'];
  list.innerHTML = '';
  s.forEach((p, i) => {
    const c = CAT.find(x => x.id === p.id); if (!c) return;
    const voted = myVotes.has(p.id);
    const pct   = Math.max(6, Math.round(((p.votes||0) / mx) * 100));
    const bcol  = i === 0 ? 'linear-gradient(90deg,var(--vi),var(--pk))' : i === 1 ? 'rgba(147,51,234,.55)' : 'rgba(147,51,234,.3)';
    const div   = document.createElement('div');
    div.className = `song-card${voted ? ' voted' : ''}${i === 0 ? ' r1' : ''}`;
    div.id = `sc-${p.id}`;
    const hasArt   = artCache[c.n + c.a];
    const coverHTML = hasArt ? `<img src="${hasArt}" alt="${c.n}" loading="lazy" onerror="this.style.display='none'">` : '';
    div.innerHTML = `
      <div class="s-cover" style="${!hasArt ? 'background:'+c.c+'28' : ''}" id="cov-${p.id}">
        ${coverHTML}
        <div class="s-cover-fallback" style="${hasArt ? 'display:none' : ''}">${c.e}</div>
        ${i < 3 ? `<div class="s-rank-badge">${medals[i]}</div>` : ''}
      </div>
      <div class="s-body">
        <div class="s-name">${c.n}</div>
        <div class="s-artist">${c.a}</div>
        <div class="s-bar"><div class="s-bar-f" style="width:${pct}%;background:${bcol}"></div></div>
      </div>
      <div class="vote-col">
        <button class="vup${voted ? ' on' : ''}" onclick="vote('${p.id}')">▲</button>
        <div class="vnum${voted ? ' on' : ''}">${p.votes||0}</div>
      </div>`;
    list.appendChild(div);
    if (!hasArt) {
      fetchAlbumArt(c.n, c.a).then(url => {
        if (!url) return;
        const cov = document.getElementById(`cov-${p.id}`); if (!cov) return;
        const fb  = cov.querySelector('.s-cover-fallback');
        cov.style.background = '';
        let img = cov.querySelector('img');
        if (!img) {
          img = document.createElement('img');
          img.alt = c.n; img.loading = 'lazy';
          img.style.cssText = 'width:100%;height:100%;object-fit:cover;border-radius:10px;position:absolute;inset:0';
          img.onerror = () => img.style.display = 'none';
          cov.insertBefore(img, cov.firstChild);
        }
        img.src = url;
        if (fb) fb.style.display = 'none';
      });
    }
  });
}

// ── DJ Queue ─────────────────────────────────────────────────────────
function renderDJ() {
  const queue = document.getElementById('dj-queue'); if (!queue) return;
  const s = sorted(); queue.innerHTML = '';
  if (!s.length) { queue.innerHTML = '<div class="empty-state"><div class="ei">🎶</div><p>Aucune proposition</p></div>'; return; }
  const rCls   = ['g','s','b'];
  const medals = ['🥇','🥈','🥉'];
  s.forEach((p, i) => {
    const c = CAT.find(x => x.id === p.id); if (!c) return;
    const card = document.createElement('div');
    card.className = `q-card${i === 0 ? ' q1' : ''}`;
    card.innerHTML = `<div class="q-rk${i < 3 ? ' '+rCls[i] : ''}">${medals[i]||'#'+(i+1)}</div><div class="q-cv" style="background:${c.c}18">${c.e}</div><div class="q-bd"><div class="q-n">${c.n}</div><div class="q-s"><span class="q-v">▲ ${p.votes||0} vote${(p.votes||0)>1?'s':''}</span><span class="q-ar">· ${c.a}</span></div></div><div class="q-acts"><div class="qa play" onclick="djPlay('${p.id}')">▶</div><div class="qa ok" onclick="djApprove('${p.id}')">✓</div><div class="qa no" onclick="djReject('${p.id}')">✕</div></div>`;
    queue.appendChild(card);
  });
}

// ── BigScreen ─────────────────────────────────────────────────────────
const BCOLS = ['linear-gradient(90deg,#9333EA,#EC4899)','#7C3AED','#6D28D9','#4C1D95','#2E1065'];
function renderBS() {
  const s     = sorted().slice(0, 5);
  const mx    = s.length ? Math.max(...s.map(p => p.votes||0)) : 1;
  const chart = document.getElementById('bs-chart'); if (!chart) return;
  chart.innerHTML = '';
  if (!s.length) { chart.innerHTML = '<div class="empty-state"><div class="ei">🎶</div><p>En attente…</p></div>'; return; }
  const medals = ['🥇','🥈','🥉'];
  s.forEach((p, i) => {
    const c   = CAT.find(x => x.id === p.id); if (!c) return;
    const pct = Math.max(5, Math.round(((p.votes||0) / mx) * 100));
    const row = document.createElement('div'); row.className = 'bs-row';
    row.innerHTML = `<div class="bs-row-top"><div class="bs-sname${i===0?' top':''}">${medals[i]||''} ${c.n}</div><div class="bs-vc${i===0?' top':''}">${p.votes||0}</div></div><div class="bs-bar-trk"><div class="bs-bar-f" style="width:${pct}%;background:${BCOLS[i]||BCOLS[4]}"></div></div><div class="bs-by">${c.a}</div>`;
    chart.appendChild(row);
  });
  elt('bs-votes', totalVotes()); elt('bs-tracks', s.length);
}

// ── Now Playing ───────────────────────────────────────────────────────
function updateNP() {
  const t = nowPlaying.t || 'En attente…';
  const a = nowPlaying.a || '';
  elt('cli-now',  t + (a ? ' — ' + a : ''));
  elt('dj-np-t',  t); elt('dj-np-a', a);
  elt('bs-np-t',  t); elt('bs-np-a', a);
}
function updateDJStats() { elt('dj-s1', sorted().length); elt('dj-s2', totalVotes()); elt('dj-s3', totalVoters()); }

// ── Modal catalogue ───────────────────────────────────────────────────
function renderModalList() {
  const f     = (document.getElementById('modal-q')?.value || '').toLowerCase();
  const exist = new Set(Object.keys(proposals));
  const items = CAT.filter(c => !exist.has(c.id) && (!f || c.n.toLowerCase().includes(f) || c.a.toLowerCase().includes(f))).slice(0, 10);
  const list  = document.getElementById('modal-list'); list.innerHTML = '';
  if (!items.length) { list.innerHTML = '<div style="text-align:center;color:var(--tx4);padding:.85rem;font-size:.82rem">Aucun résultat</div>'; return; }
  items.forEach(c => {
    const div = document.createElement('div');
    div.style.cssText = `display:flex;align-items:center;gap:.65rem;padding:.55rem .8rem;background:var(--ink3);border:1px solid ${selModal===c.id?'rgba(147,51,234,.35)':'var(--bdr)'};border-radius:10px;cursor:pointer;transition:all .18s;${selModal===c.id?'background:rgba(147,51,234,.07)':''}`;
    div.innerHTML = `<div style="width:34px;height:34px;border-radius:8px;background:${c.c}18;display:flex;align-items:center;justify-content:center;font-size:1.05rem;flex-shrink:0">${c.e}</div><div style="flex:1;min-width:0"><div style="font-size:.84rem;font-weight:500;color:var(--tx);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${c.n}</div><div style="font-size:.7rem;color:var(--tx3)">${c.a}</div></div><div style="width:18px;height:18px;border-radius:5px;border:1.5px solid rgba(255,255,255,.12);display:flex;align-items:center;justify-content:center;flex-shrink:0;${selModal===c.id?'background:#6E3FF3;border-color:transparent;color:white;font-size:.68rem':''}">${selModal===c.id?'✓':''}</div>`;
    div.onclick = () => { selModal = c.id; document.getElementById('modal-ok').disabled = false; renderModalList(); };
    list.appendChild(div);
  });
}

// ── QR Code ───────────────────────────────────────────────────────────
function generateQR() {
  const base = window.location.href.split('?')[0];
  const url  = eid ? `${base}?event=${eid}` : base;
  ['dj-qr','bs-qr'].forEach((id, i) => {
    const el = document.getElementById(id); if (!el) return;
    el.innerHTML = '';
    try { new QRCode(el, {text: url, width: i===0?86:50, height: i===0?86:50, colorDark:'#000', colorLight:'#fff'}); } catch(e) {}
  });
  elt('dj-qr-url', url); elt('dj-qr-evname', ename); elt('bs-ev-lbl', ename);
}
function openQRModal() {
  const base = window.location.href.split('?')[0];
  const url  = eid ? base + '?event=' + eid : base;
  const box  = document.getElementById('modal-qr-box');
  const urlEl = document.getElementById('modal-qr-url');
  if (box) { box.innerHTML = ''; try { new QRCode(box, {text:url, width:180, height:180, colorDark:'#000', colorLight:'#fff'}); } catch(e) { box.innerHTML = '<div style="width:180px;height:180px;display:flex;align-items:center;justify-content:center;font-size:.8rem;color:#333">QR Code</div>'; } }
  if (urlEl) urlEl.textContent = url;
  openModal('modal-qr');
}

// ── Profil ────────────────────────────────────────────────────────────
function score(ev)    { return ev.votes*3 + ev.proposals*10 + ev.played*20 + (ev.first?5:0); }
function totalXP()    { return USER_EVENTS.reduce((s,e) => s + score(e), 0); }
function curLevel(xp) { let l=0; for(let i=LEVELS.length-1;i>=0;i--){ if(xp>=LEVELS[i].min){l=i;break;} } return l; }

function renderProfile() {
  const xp    = totalXP();
  const lvIdx = curLevel(xp);
  const lv    = LEVELS[lvIdx];
  const next  = LEVELS[lvIdx + 1];
  const pct   = next ? Math.round(((xp - lv.min) / (next.min - lv.min)) * 100) : 100;
  elt('xp-lv-txt', 'Niv.' + (lvIdx+1) + ' — ' + lv.name);
  elt('xp-pts', xp + ' pts');
  elt('xp-next', next ? '→ ' + next.min + ' pts' : '🏆 Max !');
  const name = currentUser?.displayName || currentUser?.phoneNumber || 'Invité';
  elt('prof-name', name);
  const bd = document.getElementById('prof-badges'); if (bd) bd.innerHTML = '<span class="tag pill-vi">'+lv.ico+' '+lv.name+'</span>';
  const bico = document.getElementById('prof-badge-ico'); if (bico) bico.textContent = lv.ico;
  const bnm  = document.getElementById('prof-badge-name'); if (bnm)  bnm.textContent  = lv.name;
  setTimeout(() => { const f = document.getElementById('xp-fill'); if (f) f.style.width = pct + '%'; }, 300);
  const ls = document.getElementById('levels-strip');
  if (ls) {
    ls.innerHTML = '';
    LEVELS.forEach((l, i) => {
      const done = i <= lvIdx, cur = i === lvIdx;
      const div  = document.createElement('div'); div.className = 'lv-step';
      div.innerHTML = `<div class="lv-dot${done?' done':''}${cur?' cur':''}" style="${done?'background:rgba(139,92,246,.2);border-color:var(--vi);':''}">${l.ico}</div><div class="lv-lbl${done?' done':''}${cur?' cur':''}" style="${cur?'color:var(--vi);':''}">${l.name}</div>`;
      ls.appendChild(div);
    });
  }
  const totEv = USER_EVENTS.length;
  const totVt = USER_EVENTS.reduce((s,e) => s+e.votes, 0);
  const totPr = USER_EVENTS.reduce((s,e) => s+e.proposals, 0);
  const totPl = USER_EVENTS.reduce((s,e) => s+e.played, 0);
  animCount('pst-ev', totEv); animCount('pst-vt', totVt); animCount('pst-pr', totPr); animCount('pst-pl', totPl);
  setTimeout(() => {
    const bev = document.getElementById('bar-ev'); if(bev) bev.style.width = Math.min(100,totEv*20)+'%';
    const bvt = document.getElementById('bar-vt'); if(bvt) bvt.style.width = Math.min(100,totVt*2.5)+'%';
    const bpr = document.getElementById('bar-pr'); if(bpr) bpr.style.width = Math.min(100,totPr*12)+'%';
    const bpl = document.getElementById('bar-pl'); if(bpl) bpl.style.width = Math.min(100,totPl*25)+'%';
  }, 400);
  renderProfileEvents(); renderAch();
}

function renderProfileEvents() {
  const evts = [...USER_EVENTS].sort((a,b) => score(b) - score(a));
  const list = document.getElementById('prof-ev-list'); if (!list) return;
  const medals = ['🥇','🥈','🥉'];
  list.innerHTML = '';
  evts.forEach((ev, i) => {
    const sc  = score(ev);
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;align-items:center;gap:.7rem;padding:.72rem .9rem;border-bottom:1px solid rgba(255,255,255,.06);cursor:pointer;transition:background .2s';
    row.onmouseenter = () => row.style.background = 'rgba(255,255,255,.03)';
    row.onmouseleave = () => row.style.background = '';
    if (i === evts.length - 1) row.style.borderBottom = 'none';
    row.innerHTML = `<div style="width:40px;height:40px;border-radius:.85rem;background:${ev.c};display:flex;align-items:center;justify-content:center;font-size:1.2rem;flex-shrink:0">${ev.e}</div>`
      + `<div style="flex:1;min-width:0"><div style="font-size:.86rem;font-weight:600;color:#fff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${ev.name}</div><div style="font-size:.68rem;color:rgba(255,255,255,.4);margin-top:2px">${ev.date} · ${ev.venue}</div></div>`
      + `<div style="text-align:right;flex-shrink:0"><div style="font-family:Space Mono,monospace;font-size:.85rem;font-weight:700;color:#8B5CF6">${sc} pts</div><div style="font-size:.7rem;color:rgba(255,255,255,.4);margin-top:1px">${medals[i]||'#'+(i+1)}</div></div>`;
    list.appendChild(row);
  });
}

function renderAch() {
  const grid = document.getElementById('prof-ach-grid'); if (!grid) return;
  grid.innerHTML = '';
  ACHIEVEMENTS.forEach(a => {
    const div = document.createElement('div'); div.className = `ach${a.ok?' ok':' locked'}`;
    if (a.ok) { const bar = document.createElement('div'); bar.style.cssText = 'position:absolute;top:0;left:0;right:0;height:2px;background:#6E3FF3;border-radius:11px 11px 0 0'; div.appendChild(bar); }
    div.innerHTML += `<div class="ach-ico">${a.ico}${!a.ok?'<span class="lk">🔒</span>':''}</div><div class="ach-n">${a.n}</div><div class="ach-d">${a.d}</div>`;
    grid.appendChild(div);
  });
}

function switchProfTab(tab, el) {
  document.querySelectorAll('.tr-tab').forEach(t => t.classList.remove('act'));
  el.classList.add('act');
  document.getElementById('prof-tab-events').style.display = tab === 'events' ? 'block' : 'none';
  document.getElementById('prof-tab-ach').style.display    = tab === 'ach'    ? 'block' : 'none';
}
