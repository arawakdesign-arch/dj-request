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
// Mémoire du classement précédent (pour les flèches de tendance ▲▼= et les deltas de votes)
let _prevSongState = {};

function renderClient() {
  // Garde : aucune soirée active → état vide, jamais de données fictives
  if (!eid) {
    elt('cli-total', '-');
    elt('venue-connected', 0);
    elt('venue-recent-votes', 0);
    const list = document.getElementById('cli-list');
    if (list) list.innerHTML = '<div class="empty-state"></div>';
    return;
  }
  const s  = sorted();
  const t  = totalVotes();
  elt('cli-total', t ? `${t} vote${t > 1 ? 's' : ''}` : '-');
  elt('venue-connected', totalVoters());
  const list = document.getElementById('cli-list'); if (!list) return;
  if (!s.length) { list.innerHTML = `<div class="empty-state"><div class="ei">🎵</div><p>Aucune proposition pour l'instant.<br>Soyez le premier à proposer !</p></div>`; return; }
  const mx     = s[0]?.votes || 1;
  // Réconciliation par id (pas de list.innerHTML='') : on réutilise et déplace les
  // nœuds existants au lieu de tout détruire/recréer à chaque rendu. Ça évite qu'un
  // tap sur VOTER "atterrisse" sur le mauvais morceau si un re-rendu (écho realtime,
  // vote d'un autre spectateur) réordonne la liste entre le touchstart et le click.
  const keepIds = new Set(s.map(p => p.id));
  Array.from(list.children).forEach(child => {
    // Retire le placeholder "aucune proposition" laissé par un rendu précédent
    // (sinon il reste affiché au-dessus dès qu'une 1ère proposition arrive).
    if (child.classList?.contains('empty-state')) { child.remove(); return; }
    const id = child.id?.replace(/^sc-/, '');
    if (child.classList?.contains('song-card') && !keepIds.has(id)) child.remove();
  });
  const nextState = {};
  s.forEach((p, i) => {
    // Cherche dans CAT sinon utilise les métadonnées stockées dans proposals
    const c = CAT.find(x => x.id === p.id) || { n: p.title||p.id, a: p.artist||'', e:'🎵', c:'#6F22FF' };
    const voted = myVotes.has(p.id);
    const votes = p.votes||0;
    const pct   = Math.max(6, Math.round((votes / mx) * 100));
    const bcol  = i === 0 ? 'linear-gradient(90deg,var(--vi),var(--pk))' : i === 1 ? 'rgba(111,34,255,.55)' : 'rgba(111,34,255,.3)';

    // Tendance de classement + delta de votes vs le rendu précédent
    const prev = _prevSongState[p.id];
    let trendCls = 'same', trendTxt = '=';
    if (prev) {
      if (i < prev.rank)      { trendCls = 'up';   trendTxt = '▲' + (prev.rank - i); }
      else if (i > prev.rank) { trendCls = 'down'; trendTxt = '▼' + (i - prev.rank); }
    }
    const delta = prev ? votes - prev.votes : 0;
    nextState[p.id] = { rank: i, votes };

    // Réutilise le nœud existant s'il y en a un (même bouton VOTER, même id) plutôt que
    // de le recréer : un tap en cours ne doit jamais se retrouver sur le mauvais morceau.
    let div = document.getElementById(`sc-${p.id}`);
    const isNew = !div;
    if (isNew) { div = document.createElement('div'); div.id = `sc-${p.id}`; }
    div.className = `song-card${voted ? ' voted' : ''}${i === 0 ? ' r1' : ''}`;
    // Pochette : Cover Art Archive (MusicBrainz) > iTunes > emoji
    const coverSrc  = p.coverUrl || artCache[c.n + c.a] || null;
    const hasArt    = !!coverSrc;

    if (isNew) {
      const coverHTML = coverSrc ? `<img src="${coverSrc}" alt="${c.n}" loading="lazy" onerror="this.style.display='none'">` : '';
      div.innerHTML = `
        <div class="s-rank">
          <div class="s-rank-num">${i+1}</div>
          <div class="s-rank-trend ${trendCls}">${trendTxt}</div>
        </div>
        <div class="s-cover" style="${!hasArt ? 'background:'+c.c+'28' : ''}" id="cov-${p.id}">
          ${coverHTML}
          <div class="s-cover-fallback" style="${hasArt ? 'display:none' : ''}">${c.e}</div>
        </div>
        <div class="s-body">
          <div class="s-name">${c.n}</div>
          <div class="s-artist">${c.a}</div>
          <div class="s-bar"><div class="s-bar-f" style="width:${pct}%;background:${bcol}"></div></div>
          ${p.proposer_name ? `<div class="s-proposer">Proposé par ${p.proposer_name}</div>` : ''}
        </div>
        <div class="s-votes">
          <div class="s-votes-n">${votes}</div>
          <div class="s-votes-l">votes</div>
        </div>
        <div class="s-delta">${delta > 0 ? '+'+delta : ''}</div>
        <button class="vote-pill" onclick="vote('${p.id}')">${voted?'GO ✓':'VOTER ›'}</button>`;
    } else {
      // Mise à jour ciblée : le bouton VOTER (et son handler) n'est jamais recréé.
      div.querySelector('.s-rank-num').textContent = i + 1;
      const trendEl = div.querySelector('.s-rank-trend');
      trendEl.className   = `s-rank-trend ${trendCls}`;
      trendEl.textContent = trendTxt;
      div.querySelector('.s-name').textContent   = c.n;
      div.querySelector('.s-artist').textContent = c.a;
      const barEl = div.querySelector('.s-bar-f');
      barEl.style.width      = pct + '%';
      barEl.style.background = bcol;
      div.querySelector('.s-votes-n').textContent = votes;
      div.querySelector('.s-delta').textContent   = delta > 0 ? '+' + delta : '';
      const btn = div.querySelector('.vote-pill');
      btn.textContent = voted ? 'GO ✓' : 'VOTER ›';
    }
    list.appendChild(div); // réordonne en place (déplace le nœud, ne le recrée pas)
    if (isNew && !hasArt) {
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
  _prevSongState = nextState;
}

// ── DJ Queue ─────────────────────────────────────────────────────────
function renderDJ() {
  const queue = document.getElementById('dj-queue'); if (!queue) return;
  const s = sorted();
  console.log('[pullup] renderDJ() proposals=', Object.keys(proposals).length, '| sorted=', s.length);
  queue.innerHTML = '';
  if (!s.length) { queue.innerHTML = '<div class="empty-state"><div class="ei">🎶</div><p>Aucune proposition</p></div>'; return; }
  const rCls   = ['g','s','b'];
  const medals = ['🥇','🥈','🥉'];
  s.forEach((p, i) => {
    const c = CAT.find(x => x.id === p.id) || { n: p.title||p.id, a: p.artist||'', e:'🎵', c:'#6F22FF' };
    const card = document.createElement('div');
    card.className = `q-card${i === 0 ? ' q1' : ''}`;
    const qCover = p.coverUrl
      ? `<img src="${p.coverUrl}" style="width:38px;height:38px;border-radius:8px;object-fit:cover" onerror="this.outerHTML='<div class=q-cv style=background:${c.c}18>${c.e}</div>'">`
      : `<div class="q-cv" style="background:${c.c}18">${c.e}</div>`;
    card.innerHTML = `<div class="q-rk${i < 3 ? ' '+rCls[i] : ''}">${medals[i]||'#'+(i+1)}</div>${qCover}<div class="q-bd"><div class="q-n">${c.n}</div><div class="q-s"><span class="q-v">▲ ${p.votes||0} vote${(p.votes||0)>1?'s':''}</span><span class="q-ar">· ${c.a}</span></div></div><div class="q-acts"><div class="qa play" onclick="djPlay('${p.id}')">▶</div><div class="qa ok" onclick="djApprove('${p.id}')">✓</div><div class="qa no" onclick="djReject('${p.id}')">✕</div></div>`;

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
    const c = CAT.find(x => x.id === p.id) || { n: p.title||p.id, a: p.artist||'', e:'🎵', c:'#6F22FF' };
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
  elt('cli-now-t', t); elt('cli-now-a', a);
  elt('dj-np-t',  t); elt('dj-np-a', a);
  elt('pk-np-t',  a ? t + ' — ' + a : t);
  elt('bs-np-t',  t); elt('bs-np-a', a);

  const coverImg = document.getElementById('dj-cover-img');
  const coverFb   = document.getElementById('dj-cover-fallback');
  if (coverImg && coverFb) {
    if (nowPlaying.coverUrl) {
      coverImg.src = nowPlaying.coverUrl;
      coverImg.style.display = 'block';
      coverFb.style.display  = 'none';
    } else {
      coverImg.style.display = 'none';
      coverFb.style.display  = '';
    }
  }
}
function updateDJStats() { elt('dj-s1', sorted().length); elt('dj-s2', totalVotes()); elt('dj-s3', totalVoters()); }

// ── Modal catalogue — recherche iTunes ───────────────────────────────
let _searchTimer = null;

function renderModalList() {
  const q    = (document.getElementById('modal-q')?.value || '').trim();
  const list = document.getElementById('modal-list');

  // Sans recherche → morceaux déjà proposés dans la soirée
  if (!q) {
    const current = sorted(); // triés par votes
    if (current.length) {
      list.innerHTML = '<div style="font-size:.65rem;font-weight:700;color:var(--tx4);text-transform:uppercase;letter-spacing:.1em;padding:.4rem .8rem .2rem">Déjà proposés</div>';
      const frag = document.createDocumentFragment();
      current.forEach(p => {
        const c = CAT.find(x => x.id === p.id) || { n: p.title||p.id, a: p.artist||'', e:'🎵', c:'#6F22FF' };
        const sel = selModal === p.id;
        const div = document.createElement('div');
        div.style.cssText = `display:flex;align-items:center;gap:.65rem;padding:.55rem .8rem;background:${sel?'rgba(111,34,255,.06)':'#FFFFFF'};border:1px solid ${sel?'rgba(111,34,255,.3)':'var(--bdr)'};border-radius:10px;cursor:pointer;transition:all .18s;margin-bottom:.3rem`;
        const coverSrc = p.coverUrl || artCache[c.n + c.a] || null;
        const coverHTML = coverSrc
          ? `<img src="${coverSrc}" style="width:85px;height:85px;border-radius:12px;object-fit:cover;flex-shrink:0">`
          : `<div style="width:85px;height:85px;border-radius:12px;background:${c.c}18;display:flex;align-items:center;justify-content:center;font-size:2rem;flex-shrink:0">${c.e}</div>`;
        div.innerHTML = `${coverHTML}
          <div style="flex:1;min-width:0">
            <div style="font-size:.84rem;font-weight:600;color:var(--tx);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${c.n}</div>
            <div style="font-size:.72rem;color:var(--tx3);margin-top:1px">${c.a}</div>
            <div style="font-size:.68rem;color:var(--vi);margin-top:3px">▲ ${p.votes||0} vote${(p.votes||0)>1?'s':''}</div>
          </div>
          <div style="width:20px;height:20px;border-radius:50%;border:1.5px solid var(--bdr);display:flex;align-items:center;justify-content:center;flex-shrink:0;${sel?'background:#6F22FF;border-color:transparent;color:white;font-size:.72rem':''}">${sel?'✓':''}</div>`;
        div.onclick = () => {
          selModal = p.id;
          selModalMeta = { id: p.id, title: c.n, artist: c.a, coverUrl: coverSrc };
          document.getElementById('modal-ok').disabled = false;
          renderModalList();
        };
        frag.appendChild(div);
      });
      list.appendChild(frag);
    } else {
      list.innerHTML = '<div style="text-align:center;padding:1.5rem .85rem;font-size:.82rem;color:var(--tx4)">🔍 Tape pour rechercher un morceau</div>';
    }
    return;
  }

  // Debounce 450ms
  clearTimeout(_searchTimer);
  list.innerHTML = '<div style="text-align:center;padding:.85rem;font-size:.82rem;color:var(--tx4)">🔍 Recherche…</div>';
  _searchTimer = setTimeout(() => _searchSongs(q, list), 450);
}

async function _searchSongs(q, list) {
  try {
    const data = await api('GET', '/search/songs?q=' + encodeURIComponent(q));
    if (!Array.isArray(data)) throw new Error('Réponse invalide');
    const exist = new Set(Object.keys(proposals));
    const items = data
      .filter(r => !exist.has(r.id))
      .map(r => ({ id: r.id, title: r.title, artist: r.artist, coverUrl: r.coverUrl, album: r.album }));
    _renderItems(list, items);
  } catch(e) {
    // Fallback catalogue local
    const exist = new Set(Object.keys(proposals));
    const lq    = q.toLowerCase();
    const items = CAT
      .filter(c => !exist.has(c.id) && (c.n.toLowerCase().includes(lq) || c.a.toLowerCase().includes(lq)))
      .slice(0, 8)
      .map(c => ({ id: c.id, title: c.n, artist: c.a, emoji: c.e, color: c.c }));
    _renderItems(list, items.length ? items : CAT.filter(c => !exist.has(c.id)).slice(0,8).map(c=>({id:c.id,title:c.n,artist:c.a,emoji:c.e,color:c.c})));
  }
}

function _renderItems(list, items) {
  list.innerHTML = '';
  if (!items.length) {
    list.innerHTML = '<div style="text-align:center;color:var(--tx4);padding:.85rem;font-size:.82rem">Aucun résultat</div>';
    return;
  }
  items.forEach(item => {
    const sel = selModal === item.id;
    const div = document.createElement('div');
    div.style.cssText = `display:flex;align-items:center;gap:.65rem;padding:.55rem .8rem;background:${sel?'rgba(111,34,255,.06)':'#FFFFFF'};border:1px solid ${sel?'rgba(111,34,255,.3)':'var(--bdr)'};border-radius:10px;cursor:pointer;transition:all .18s`;

    const bg = item.color ? `background:${item.color}18` : 'background:rgba(111,34,255,.1)';
    const coverHTML = item.coverUrl
      ? `<img src="${item.coverUrl}" alt="" style="width:85px;height:85px;border-radius:12px;object-fit:cover;flex-shrink:0" onerror="this.outerHTML='<div style=width:85px;height:85px;border-radius:12px;${bg};display:flex;align-items:center;justify-content:center;font-size:2rem;flex-shrink:0>${item.emoji||'🎵'}</div>'">`
      : `<div style="width:85px;height:85px;border-radius:12px;${bg};display:flex;align-items:center;justify-content:center;font-size:2rem;flex-shrink:0">${item.emoji||'🎵'}</div>`;

    div.innerHTML = `
      ${coverHTML}
      <div style="flex:1;min-width:0">
        <div style="font-size:.84rem;font-weight:600;color:var(--tx);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${item.title}</div>
        <div style="font-size:.72rem;color:var(--tx3);margin-top:1px">${item.artist}${item.album ? ' · <span style="opacity:.6">'+item.album+'</span>' : ''}</div>
      </div>
      <div style="width:20px;height:20px;border-radius:50%;border:1.5px solid var(--bdr);display:flex;align-items:center;justify-content:center;flex-shrink:0;${sel?'background:#6F22FF;border-color:transparent;color:white;font-size:.72rem':''}">${sel?'✓':''}</div>`;

    div.onclick = () => {
      selModal = item.id;
      // Stocker les métadonnées pour submitProposal
      selModalMeta = { id: item.id, title: item.title, artist: item.artist, coverUrl: item.coverUrl };
      document.getElementById('modal-ok').disabled = false;
      renderModalList();
    };
    list.appendChild(div);
  });
}

// ── QR Code ───────────────────────────────────────────────────────────
const _UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function isValidUuid(id) { return typeof id === 'string' && _UUID_RE.test(id); }

function buildEventUrl(eventId) {
  if (!isValidUuid(eventId)) {
    console.warn('[pullup] buildEventUrl: ID absent ou invalide →', eventId);
    return window.location.origin + '/';
  }
  return window.location.origin + '/?event=' + encodeURIComponent(eventId);
}

// Accepte un ID explicite ; se replie sur le global eid si omis
function generateQR(activeEid) {
  const id = activeEid !== undefined ? activeEid : eid;
  console.log('[pullup] generateQR() id=', id, '| eid_global=', eid, '| caller:', new Error().stack.split('\n')[2]?.trim());
  if (!isValidUuid(id)) {
    console.warn('[pullup] generateQR: UUID invalide — génération ignorée, id=', id);
    return;
  }
  const url = buildEventUrl(id);
  const sizes = { 'dj-qr': 160, 'bs-qr': 220 };
  Object.entries(sizes).forEach(([elemId, sz]) => {
    const el = document.getElementById(elemId); if (!el) return;
    el.innerHTML = '';
    try { new QRCode(el, {text: url, width: sz, height: sz, colorDark:'#000', colorLight:'#fff'}); } catch(e) {}
  });
  elt('dj-qr-url', url); elt('dj-qr-evname', ename); elt('bs-ev-lbl', ename);
}

function openQRModal() {
  const id  = isValidUuid(eid) ? eid : null;
  const url = buildEventUrl(id);
  const box  = document.getElementById('modal-qr-box');
  const urlEl = document.getElementById('modal-qr-url');
  if (box) { box.innerHTML = ''; try { new QRCode(box, {text:url, width:220, height:220, colorDark:'#000', colorLight:'#fff'}); } catch(e) { box.innerHTML = '<div style="width:220px;height:220px;display:flex;align-items:center;justify-content:center;font-size:.8rem;color:#333">QR Code</div>'; } }
  if (urlEl) urlEl.textContent = url;
  openModal('modal-qr');
}

// ── Profil ────────────────────────────────────────────────────────────
function score(ev)    { return (ev.votes||0)*3 + (ev.proposals||0)*10 + (ev.played||0)*20; }
function curLevel(xp) { let l=0; for(let i=LEVELS.length-1;i>=0;i--){ if(xp>=LEVELS[i].min){l=i;break;} } return l; }

// Cache des stats réelles
let _profileStats = null;

async function loadProfileStats() {
  if (!_sbSession) return;
  try {
    const data = await api('GET', '/profile/stats');
    _profileStats = data;
    renderProfile(); // re-render avec vraies données
  } catch(e) {}
}

function renderProfile() {
  // Utiliser les vraies stats si disponibles, sinon les données locales
  const stats = _profileStats;
  const totEv = stats?.totals.events    ?? USER_EVENTS.length;
  const totVt = stats?.totals.votes     ?? USER_EVENTS.reduce((s,e)=>s+e.votes,0);
  const totPr = stats?.totals.proposals ?? USER_EVENTS.reduce((s,e)=>s+e.proposals,0);
  const totPl = stats?.totals.played    ?? USER_EVENTS.reduce((s,e)=>s+e.played,0);
  const xp    = stats?.totals.xp        ?? USER_EVENTS.reduce((s,e)=>s+score(e),0);

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
      div.innerHTML = `<div class="lv-dot${done?' done':''}${cur?' cur':''}" style="${done?'background:rgba(111,34,255,.12);border-color:var(--vi);':''}">${l.ico}</div><div class="lv-lbl${done?' done':''}${cur?' cur':''}" style="${cur?'color:var(--vi);':''}">${l.name}</div>`;
      ls.appendChild(div);
    });
  }

  animCount('pst-ev', totEv); animCount('pst-vt', totVt); animCount('pst-pr', totPr); animCount('pst-pl', totPl);
  setTimeout(() => {
    const bev = document.getElementById('bar-ev'); if(bev) bev.style.width = Math.min(100,totEv*20)+'%';
    const bvt = document.getElementById('bar-vt'); if(bvt) bvt.style.width = Math.min(100,totVt*2.5)+'%';
    const bpr = document.getElementById('bar-pr'); if(bpr) bpr.style.width = Math.min(100,totPr*12)+'%';
    const bpl = document.getElementById('bar-pl'); if(bpl) bpl.style.width = Math.min(100,totPl*25)+'%';
  }, 400);

  renderProfileEvents(); renderAch(); renderFriendsOnProfile();
}

function renderProfileEvents() {
  const list = document.getElementById('prof-ev-list'); if (!list) return;
  const medals = ['🥇','🥈','🥉'];
  const colors  = ['rgba(111,34,255,.1)','rgba(0,113,227,.1)','rgba(255,149,0,.1)','rgba(22,201,107,.1)'];
  const icons   = ['🎵','🎛️','🏭','🌿','👑','⚡'];

  // Vraies données si disponibles, sinon hardcodées
  const evts = _profileStats?.events?.slice().sort((a,b) => score(b)-score(a))
    || [...USER_EVENTS].sort((a,b) => score(b)-score(a));

  list.innerHTML = '';

  if (!evts.length) {
    list.innerHTML = '<div style="text-align:center;padding:1.5rem;font-size:.8rem;color:var(--tx4)">Aucune soirée encore · vote pour en cumuler !</div>';
    return;
  }

  evts.forEach((ev, i) => {
    const sc  = score(ev);
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;align-items:center;gap:.7rem;padding:.72rem .9rem;border-bottom:1px solid var(--bdr);transition:background .2s';
    row.onmouseenter = () => row.style.background = 'var(--ink5)';
    row.onmouseleave = () => row.style.background = '';
    if (i === evts.length - 1) row.style.borderBottom = 'none';
    const bg  = ev.c || colors[i % colors.length];
    const ico = ev.e || icons[i % icons.length];
    row.innerHTML = `<div style="width:40px;height:40px;border-radius:.85rem;background:${bg};display:flex;align-items:center;justify-content:center;font-size:1.2rem;flex-shrink:0">${ico}</div>`
      + `<div style="flex:1;min-width:0"><div style="font-size:.86rem;font-weight:600;color:var(--tx);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${ev.name}</div><div style="font-size:.68rem;color:var(--tx4);margin-top:2px">${ev.date}${ev.venue?' · '+ev.venue:''}</div></div>`
      + `<div style="text-align:right;flex-shrink:0"><div style="font-family:Inter,sans-serif;font-size:.85rem;font-weight:700;color:#6F22FF">${sc} pts</div><div style="font-size:.7rem;color:var(--tx4);margin-top:1px">${medals[i]||'#'+(i+1)}</div></div>`;
    list.appendChild(row);
  });
}

function renderAch() {
  const grid = document.getElementById('prof-ach-grid'); if (!grid) return;
  grid.innerHTML = '';
  ACHIEVEMENTS.forEach(a => {
    const div = document.createElement('div'); div.className = `ach${a.ok?' ok':' locked'}`;
    if (a.ok) { const bar = document.createElement('div'); bar.style.cssText = 'position:absolute;top:0;left:0;right:0;height:2px;background:#6F22FF;border-radius:11px 11px 0 0'; div.appendChild(bar); }
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
