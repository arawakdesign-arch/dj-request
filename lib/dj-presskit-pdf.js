const PDFDocument = require('pdfkit');
const QRCode = require('qrcode');
const sharp = require('sharp');
const fs = require('node:fs');
const path = require('node:path');

const PAGE = { width: 595.28, height: 841.89 };
const COLORS = { ink: '#0b0810', purple: '#7026e8', pink: '#ff2a93', paper: '#f4f1f6', muted: '#82798a' };
const logoPath = path.join(__dirname, '..', 'public', 'images', 'logo.png');

function text(value, max = 5000) {
  return String(value || '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').replace(/[\u{10000}-\u{10ffff}]/gu, '').trim().slice(0, max);
}

function list(value, max = 6) {
  if (Array.isArray(value)) return value.map(item => text(item, 80)).filter(Boolean).slice(0, max);
  return text(value, 500).split(',').map(item => item.trim()).filter(Boolean).slice(0, max);
}

function fillPage(doc, color) {
  doc.save().rect(0, 0, PAGE.width, PAGE.height).fill(color).restore();
}

function fitStageName(name) {
  if (name.length > 25) return 44;
  if (name.length > 17) return 56;
  if (name.length > 11) return 68;
  return 82;
}

function imageCover(doc, buffer, x, y, width, height, align = 'center', valign = 'center') {
  if (!buffer) return false;
  try {
    doc.save().rect(x, y, width, height).clip();
    doc.image(buffer, x, y, { cover: [width, height], align, valign });
    doc.restore();
    return true;
  } catch {
    doc.restore();
    return false;
  }
}

function darkOverlay(doc, opacity = 0.6, x = 0, y = 0, width = PAGE.width, height = PAGE.height) {
  doc.save().fillOpacity(opacity).rect(x, y, width, height).fill('#050407').restore();
}

function editorialChrome(doc, page, label) {
  doc.save().lineWidth(2).strokeColor('#fff');
  [0, 8, 16].forEach(offset => doc.moveTo(38, 38 + offset).lineTo(60, 38 + offset).stroke());
  doc.restore();
  doc.font('Helvetica-Bold').fontSize(6).fillColor('#fff').text(label.toUpperCase(), 78, 42, { characterSpacing: 1.8 });
  doc.save().rotate(-90, { origin: [24, 420] });
  doc.font('Helvetica-Bold').fontSize(6).fillColor('#c8c2cb').text('PULL UP!  /  ARTIST PRESS KIT', 24, 420, { characterSpacing: 2 });
  doc.restore();
  doc.save().moveTo(558, 124).lineTo(558, 258).lineWidth(0.7).strokeColor('#b8b0bd').stroke().restore();
  doc.font('Helvetica-Bold').fontSize(7).fillColor('#fff').text(String(page).padStart(2, '0'), 532, 270, { width: 26, align: 'right' });
}

function footer(doc, profileUrl) {
  doc.save().moveTo(38, 789).lineTo(557, 789).lineWidth(0.7).strokeColor('#746d78').stroke().restore();
  doc.font('Helvetica-Bold').fontSize(6.5).fillColor('#fff').text(text(profileUrl, 90), 38, 805, { width: 390 });
  doc.font('Helvetica-Bold').fontSize(6).fillColor('#aaa2b0').text('CREATED WITH PULL UP!', 418, 805, { width: 139, align: 'right', characterSpacing: 1 });
}

function drawCover(doc, profile, assets, profileUrl) {
  fillPage(doc, COLORS.ink);
  const hero = assets.profilePhoto || assets.gallery?.[0];
  imageCover(doc, hero, 0, 0, PAGE.width, PAGE.height, 'center', 'top');
  if (hero) {
    darkOverlay(doc, 0.22);
    darkOverlay(doc, 0.68, 0, 455, PAGE.width, 387);
    darkOverlay(doc, 0.28, 350, 0, 245, 520);
  }
  editorialChrome(doc, 1, 'Artist portrait');
  doc.font('Helvetica-Bold').fontSize(7).fillColor('#fff').text('PULL UP! ARTISTS', 404, 43, { width: 153, align: 'right', characterSpacing: 1.3 });
  doc.save().rect(38, 456, 34, 3).fill(COLORS.purple).restore();
  doc.font('Helvetica-Bold').fontSize(7).fillColor('#d5cde0').text('DJ  /  SOUND  /  PERFORMANCE', 38, 475, { characterSpacing: 1.7 });
  const name = text(profile.stage_name, 60).toUpperCase() || 'ARTISTE';
  doc.font('Helvetica-Bold').fontSize(fitStageName(name)).fillColor('#fff').text(name, 36, 503, { width: 520, height: 175, lineGap: -10, ellipsis: true });
  const tagline = text(profile.tagline, 220);
  if (tagline) doc.font('Helvetica').fontSize(11).fillColor('#ded8e2').text(tagline, 40, 669, { width: 410, height: 50, lineGap: 4, ellipsis: true });
  const genres = list(profile.genres).join('  /  ');
  if (genres) doc.font('Helvetica-Bold').fontSize(7).fillColor('#fff').text(genres.toUpperCase(), 40, 741, { width: 500, characterSpacing: 0.8, lineGap: 4 });
  footer(doc, profileUrl);
}

function socialNames(profile) {
  return [['INSTAGRAM', profile.instagram], ['TIKTOK', profile.tiktok], ['SOUNDCLOUD', profile.soundcloud], ['MIXCLOUD', profile.mixcloud], ['SPOTIFY', profile.spotify], ['YOUTUBE', profile.youtube]].filter(([, value]) => text(value));
}

function drawAbout(doc, profile, assets, profileUrl) {
  doc.addPage();
  fillPage(doc, COLORS.ink);
  const background = assets.gallery?.[0] || assets.profilePhoto;
  imageCover(doc, background, 0, 0, PAGE.width, PAGE.height, 'center', 'top');
  if (background) darkOverlay(doc, 0.8);
  editorialChrome(doc, 2, 'About me');
  doc.font('Helvetica-Bold').fontSize(7).fillColor('#fff').text('ABOUT ME', 79, 42, { characterSpacing: 1.8 });
  const name = text(profile.stage_name, 60).toUpperCase() || 'ARTISTE';
  doc.font('Helvetica-Bold').fontSize(fitStageName(name) - 8).fillColor('#fff').text(name, 38, 120, { width: 518, height: 100, lineGap: -8, ellipsis: true });
  doc.save().rect(39, 226, 42, 3).fill(COLORS.purple).restore();
  doc.font('Helvetica-Bold').fontSize(6.5).fillColor('#cdb5f5').text('BIOGRAPHIE COMPLÈTE', 39, 248, { characterSpacing: 1.5 });
  const bio = text(profile.bio, 5000) || 'Présentation à venir.';
  const bioSize = bio.length > 4000 ? 7.1 : bio.length > 3000 ? 7.8 : 8.5;
  doc.font('Helvetica').fontSize(bioSize).fillColor('#fff').text(bio, 39, 280, { width: 516, height: 405, columns: 2, columnGap: 28, lineGap: 3, ellipsis: true });
  doc.save().fillOpacity(0.14).roundedRect(38, 711, 517, 59, 5).fill('#ffffff').restore();
  doc.font('Helvetica-Bold').fontSize(6).fillColor('#bfa0f2').text('SIGNATURE ARTISTIQUE', 51, 724, { characterSpacing: 1.2 });
  doc.font('Helvetica').fontSize(9).fillColor('#fff').text(text(profile.tagline, 150), 51, 741, { width: 480, height: 20, ellipsis: true });
  footer(doc, profileUrl);
}

function safeLink(value) {
  try { const url = new URL(text(value, 1000)); return ['http:', 'https:'].includes(url.protocol) ? url.href : ''; } catch { return ''; }
}

function linkLabel(value) {
  const href = safeLink(value); if (!href) return '';
  try {
    const url = new URL(href), path = decodeURIComponent(url.pathname).replace(/\/$/, '');
    return (url.hostname.replace(/^www\./, '') + path).slice(0, 58);
  } catch { return href.slice(0, 58); }
}

function drawMusic(doc, profile, assets, profileUrl) {
  doc.addPage();
  fillPage(doc, COLORS.ink);
  const background = assets.gallery?.[1] || assets.profilePhoto;
  imageCover(doc, background, 0, 0, PAGE.width, PAGE.height, 'center', 'top');
  if (background) darkOverlay(doc, 0.82);
  editorialChrome(doc, 3, 'Music / Services');
  doc.font('Helvetica-Bold').fontSize(7).fillColor('#fff').text('MUSIC / SERVICES', 79, 42, { characterSpacing: 1.8 });
  doc.font('Helvetica-Bold').fontSize(31).fillColor('#fff').text('UNIVERS MUSICAL', 39, 116, { width: 516 });
  doc.save().rect(39, 163, 42, 3).fill(COLORS.purple).restore();

  const genres = list(profile.genres, 6);
  doc.font('Helvetica-Bold').fontSize(6).fillColor('#bfa0f2').text('STYLES', 39, 193, { characterSpacing: 1.4 });
  doc.font('Helvetica-Bold').fontSize(21).fillColor('#fff').text(genres.join('  /  ').toUpperCase() || 'À COMPLÉTER', 39, 219, { width: 516, height: 95, lineGap: 5, ellipsis: true });
  const services = list(profile.service_types, 8);
  doc.font('Helvetica-Bold').fontSize(6).fillColor('#bfa0f2').text('PRESTATIONS', 39, 338, { characterSpacing: 1.4 });
  services.forEach((service, index) => {
    const col = index % 2, row = Math.floor(index / 2), x = 39 + col * 260, y = 364 + row * 42;
    doc.save().roundedRect(x, y, 246, 31, 15).lineWidth(0.7).strokeColor('#746d78').stroke().restore();
    doc.font('Helvetica-Bold').fontSize(7).fillColor('#fff').text(service.toUpperCase(), x + 13, y + 11, { width: 220, align: 'center', characterSpacing: 0.8 });
  });

  const musicLinks = [['SOUNDCLOUD', profile.soundcloud], ['MIXCLOUD', profile.mixcloud], ['SPOTIFY', profile.spotify], ['YOUTUBE', profile.youtube]].filter(([, value]) => safeLink(value));
  const linkTop = 548;
  doc.font('Helvetica-Bold').fontSize(6).fillColor('#bfa0f2').text('ÉCOUTER / REGARDER', 39, linkTop, { characterSpacing: 1.4 });
  musicLinks.forEach(([label, value], index) => {
    const col = index % 2, row = Math.floor(index / 2), x = 39 + col * 260, y = linkTop + 28 + row * 56, href = safeLink(value);
    doc.font('Helvetica-Bold').fontSize(7).fillColor('#fff').text(label, x, y, { characterSpacing: 1 });
    doc.font('Helvetica').fontSize(7.5).fillColor('#c9c2cd').text(linkLabel(href), x, y + 17, { width: 240, height: 20, ellipsis: true, link: href, underline: true });
  });

  doc.save().fillOpacity(0.16).roundedRect(39, 696, 516, 74, 5).fill('#ffffff').restore();
  doc.font('Helvetica-Bold').fontSize(6).fillColor('#bfa0f2').text('IDENTITÉ MUSICALE', 52, 709, { characterSpacing: 1.2 });
  doc.font('Helvetica').fontSize(8.2).fillColor('#fff').text(text(profile.tagline, 150), 52, 729, { width: 490, height: 26, lineGap: 3, ellipsis: true });
  footer(doc, profileUrl);
}

function drawExperience(doc, profile, assets, profileUrl) {
  doc.addPage();
  fillPage(doc, COLORS.ink);
  const background = assets.gallery?.[2] || assets.profilePhoto;
  imageCover(doc, background, 0, 0, PAGE.width, PAGE.height, 'center', 'top');
  if (background) darkOverlay(doc, 0.84);
  editorialChrome(doc, 4, 'Story / Collaborations');
  doc.font('Helvetica-Bold').fontSize(7).fillColor('#fff').text('STORY / COLLABORATIONS', 79, 42, { characterSpacing: 1.8 });
  doc.font('Helvetica-Bold').fontSize(31).fillColor('#fff').text('PARCOURS ARTISTIQUE', 39, 112, { width: 516 });
  doc.save().rect(39, 159, 42, 3).fill(COLORS.purple).restore();
  const experience = text(profile.experience, 2000);
  doc.font('Helvetica-Bold').fontSize(6).fillColor('#bfa0f2').text('AUTRES COLLABORATIONS ET PRÉCISIONS', 39, 193, { characterSpacing: 1.3 });
  if (experience) {
    const experienceSize = experience.length > 1500 ? 8 : experience.length > 900 ? 9 : 10;
    doc.font('Helvetica').fontSize(experienceSize).fillColor('#fff').text(experience, 39, 230, { width: 516, height: 430, columns: 2, columnGap: 30, lineGap: 4, ellipsis: true });
  } else {
    doc.font('Helvetica').fontSize(11).fillColor('#d7d0da').text('Les collaborations détaillées apparaîtront ici.', 39, 230, { width: 516 });
  }
  const selected = (Array.isArray(profile.career_locations) ? profile.career_locations : []).map(entry => text(entry.name, 60)).filter(Boolean).slice(0, 8);
  if (selected.length) {
    doc.save().fillOpacity(0.16).roundedRect(39, 686, 516, 84, 5).fill('#ffffff').restore();
    doc.font('Helvetica-Bold').fontSize(6).fillColor('#bfa0f2').text('LIEUX MARQUANTS', 52, 701, { characterSpacing: 1.2 });
    doc.font('Helvetica-Bold').fontSize(9).fillColor('#fff').text(selected.join('  /  ').toUpperCase(), 52, 724, { width: 490, height: 34, lineGap: 4, ellipsis: true });
  }
  footer(doc, profileUrl);
}

function drawCareer(doc, profile, assets, profileUrl) {
  doc.addPage();
  fillPage(doc, COLORS.ink);
  const background = assets.gallery?.[2] || assets.profilePhoto;
  imageCover(doc, background, 0, 0, PAGE.width, PAGE.height, 'center', 'top');
  if (background) darkOverlay(doc, 0.86);
  editorialChrome(doc, 5, 'Career / Places');
  doc.font('Helvetica-Bold').fontSize(7).fillColor('#fff').text('CAREER / PLACES', 79, 42, { characterSpacing: 1.8 });
  doc.font('Helvetica-Bold').fontSize(31).fillColor('#fff').text('RÉSIDENCES & COLLABORATIONS', 39, 112, { width: 516 });
  doc.save().rect(39, 159, 42, 3).fill(COLORS.purple).restore();
  const career = Array.isArray(profile.career_locations) ? profile.career_locations.slice(0, 8) : [];
  if (!career.length) {
    doc.font('Helvetica').fontSize(11).fillColor('#d7d0da').text('Aucune résidence ou collaboration renseignée.', 39, 206, { width: 516 });
  } else {
    career.forEach((entry, index) => {
      const col = index % 2, row = Math.floor(index / 2), x = 39 + col * 260, y = 194 + row * 139;
      doc.save().fillOpacity(0.18).roundedRect(x, y, 246, 120, 6).fill('#ffffff').restore();
      doc.font('Helvetica-Bold').fontSize(6).fillColor('#bfa0f2').text(text(entry.type, 30).toUpperCase() || 'EXPÉRIENCE', x + 14, y + 13, { width: 145, characterSpacing: 1 });
      doc.font('Helvetica-Bold').fontSize(7).fillColor('#fff').text(text(entry.period, 80), x + 172, y + 13, { width: 60, align: 'right' });
      doc.font('Helvetica-Bold').fontSize(15).fillColor('#fff').text(text(entry.name, 120) || 'Lieu', x + 14, y + 34, { width: 218, height: 38, ellipsis: true });
      const address = [text(entry.address, 180), text(entry.city, 100), text(entry.country, 80)].filter(Boolean).join(' · ');
      doc.font('Helvetica').fontSize(7.7).fillColor('#d0c9d4').text(address || 'Adresse non renseignée', x + 14, y + 77, { width: 218, height: 30, lineGap: 3, ellipsis: true });
    });
  }
  footer(doc, profileUrl);
}

function drawEvents(doc, profile, assets, profileUrl) {
  doc.addPage();
  fillPage(doc, COLORS.ink);
  const background = assets.gallery?.[3] || assets.gallery?.[0] || assets.profilePhoto;
  imageCover(doc, background, 0, 0, PAGE.width, PAGE.height, 'center', 'top');
  if (background) darkOverlay(doc, 0.88);
  editorialChrome(doc, 6, 'Upcoming events');
  doc.font('Helvetica-Bold').fontSize(7).fillColor('#fff').text('UPCOMING EVENTS', 79, 42, { characterSpacing: 1.8 });
  doc.font('Helvetica-Bold').fontSize(31).fillColor('#fff').text('PROCHAINES SOIRÉES', 39, 112, { width: 516 });
  doc.save().rect(39, 159, 42, 3).fill(COLORS.purple).restore();
  const events = Array.isArray(profile.upcoming_events) ? profile.upcoming_events.slice(0, 4) : [];
  if (!events.length) {
    doc.font('Helvetica').fontSize(11).fillColor('#d7d0da').text('Nouvelles dates bientôt disponibles.', 39, 206, { width: 516 });
  } else {
    events.forEach((event, index) => {
      const col = index % 2, row = Math.floor(index / 2), x = 39 + col * 260, y = 191 + row * 281, flyer = assets.flyers?.[index];
      doc.save().fillOpacity(0.18).roundedRect(x, y, 246, 258, 6).fill('#ffffff').restore();
      if (flyer) imageCover(doc, flyer, x, y, 246, 137, 'center', 'center');
      else {
        doc.save().fillOpacity(0.28).rect(x, y, 246, 137).fill(COLORS.purple).restore();
        doc.font('Helvetica-Bold').fontSize(8).fillColor('#fff').text('PULL UP! EVENT', x, y + 63, { width: 246, align: 'center', characterSpacing: 1.5 });
      }
      doc.font('Helvetica-Bold').fontSize(6.5).fillColor('#bfa0f2').text(text(event.date, 10) || 'DATE À VENIR', x + 13, y + 151, { characterSpacing: 0.8 });
      doc.font('Helvetica-Bold').fontSize(13).fillColor('#fff').text(text(event.name, 80) || 'Soirée à venir', x + 13, y + 170, { width: 220, height: 33, ellipsis: true });
      doc.font('Helvetica').fontSize(7.5).fillColor('#d0c9d4').text([text(event.place, 120), text(event.address, 180)].filter(Boolean).join(' · '), x + 13, y + 207, { width: 220, height: 24, ellipsis: true });
      const eventLink = safeLink(event.link_url);
      if (eventLink) doc.font('Helvetica-Bold').fontSize(6.5).fillColor('#c7a6f8').text('BILLETTERIE / INFOS  ↗', x + 13, y + 237, { width: 220, link: eventLink, underline: true, characterSpacing: 0.6 });
    });
  }
  footer(doc, profileUrl);
}

function drawMedia(doc, profile, assets, profileUrl) {
  doc.addPage();
  fillPage(doc, COLORS.ink);
  const background = assets.gallery?.[4] || assets.gallery?.[0] || assets.profilePhoto;
  imageCover(doc, background, 0, 0, PAGE.width, PAGE.height, 'center', 'top');
  if (background) darkOverlay(doc, 0.88);
  editorialChrome(doc, 7, 'Media / Contact');
  doc.font('Helvetica-Bold').fontSize(7).fillColor('#fff').text('MEDIA / CONTACT', 79, 42, { characterSpacing: 1.8 });
  doc.font('Helvetica-Bold').fontSize(31).fillColor('#fff').text('GALERIE & BOOKING', 39, 112, { width: 516 });
  doc.save().rect(39, 159, 42, 3).fill(COLORS.purple).restore();

  const gallery = assets.gallery || [];
  const cells = 6, gap = 7, cellW = (516 - gap * 2) / 3, cellH = 150;
  for (let index = 0; index < cells; index++) {
    const col = index % 3, row = Math.floor(index / 3), x = 39 + col * (cellW + gap), y = 190 + row * (cellH + gap);
    doc.save().rect(x, y, cellW, cellH).fill(index % 2 ? '#211b27' : '#17131b').restore();
    const visual = gallery[index] || (index === 0 ? assets.coverAvatar : null);
    if (visual) imageCover(doc, visual, x, y, cellW, cellH, 'center', 'center');
    else {
      doc.font('Helvetica-Bold').fontSize(6).fillColor('#82798a').text(`PHOTO ${String(index + 1).padStart(2, '0')}`, x, y + 72, { width: cellW, align: 'center', characterSpacing: 1 });
    }
    doc.save().rect(x + 8, y + 8, 24, 3).fill(COLORS.purple).restore();
  }

  doc.save().fillOpacity(0.16).roundedRect(39, 525, 357, 245, 6).fill('#ffffff').restore();
  doc.font('Helvetica-Bold').fontSize(6).fillColor('#bfa0f2').text('BOOKING', 54, 542, { characterSpacing: 1.3 });
  const bookingRows = [['E-MAIL', profile.booking_email], ['TÉLÉPHONE', profile.phone], ['DÉPLACEMENTS', profile.travel_areas]];
  bookingRows.forEach(([label, value], index) => {
    const y = 570 + index * 49;
    doc.font('Helvetica-Bold').fontSize(6).fillColor('#aaa2b0').text(label, 54, y, { characterSpacing: 0.8 });
    const content = text(value, 300) || 'Non renseigné';
    const link = label === 'E-MAIL' && content !== 'Non renseigné' ? `mailto:${content}` : label === 'TÉLÉPHONE' && content !== 'Non renseigné' ? `tel:${content.replace(/\s/g, '')}` : undefined;
    doc.font('Helvetica').fontSize(8.5).fillColor('#fff').text(content, 136, y - 1, { width: 238, height: 28, ellipsis: true, link });
  });
  const publicHref = safeLink(profileUrl);
  doc.font('Helvetica-Bold').fontSize(6).fillColor('#aaa2b0').text('PAGE PUBLIQUE', 54, 719, { characterSpacing: 0.8 });
  doc.font('Helvetica').fontSize(8).fillColor('#fff').text(text(profileUrl, 100), 136, 718, { width: 238, height: 18, ellipsis: true, link: publicHref, underline: true });

  if (assets.qr) {
    doc.save().rect(421, 540, 122, 122).fill('#fff').restore();
    doc.image(assets.qr, 427, 546, { fit: [110, 110] });
    doc.font('Helvetica-Bold').fontSize(6).fillColor('#fff').text('SCANNER LE PROFIL', 421, 674, { width: 122, align: 'center', characterSpacing: 0.8 });
  }
  const contactLinks = [['INSTAGRAM', profile.instagram], ['TIKTOK', profile.tiktok], ['SITE', profile.website], ['RESIDENT ADVISOR', profile.resident_advisor], ['VIDÉO', profile.video_url]].filter(([, value]) => safeLink(value));
  contactLinks.forEach(([label, value], index) => {
    const y = 706 + index * 15, href = safeLink(value);
    if (y > 766) return;
    doc.font('Helvetica-Bold').fontSize(5.8).fillColor(index % 2 ? '#fff' : '#c7a6f8').text(label, 421, y, { width: 122, align: 'center', link: href, underline: true, characterSpacing: 0.6 });
  });
  footer(doc, profileUrl);
}

async function qrWithLogo(profileUrl) {
  const qr = await QRCode.toBuffer(profileUrl, { type: 'png', width: 360, margin: 2, errorCorrectionLevel: 'H', color: { dark: '#100916', light: '#ffffff' } });
  if (!fs.existsSync(logoPath)) return qr;
  const mark = await sharp(logoPath).resize(58, 58, { fit: 'contain' }).png().toBuffer();
  const badge = await sharp({ create: { width: 78, height: 78, channels: 4, background: '#ffffff' } }).composite([{ input: mark, gravity: 'center' }]).png().toBuffer();
  return sharp(qr).composite([{ input: badge, gravity: 'center' }]).png().toBuffer();
}

async function remoteImage(url, allowedPrefix) {
  if (typeof url !== 'string' || !url.startsWith(allowedPrefix)) return null;
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(7000) });
    if (!response.ok || !/^image\//i.test(response.headers.get('content-type') || '')) return null;
    const raw = Buffer.from(await response.arrayBuffer());
    if (!raw.length || raw.length > 6 * 1024 * 1024) return null;
    return await sharp(raw).rotate().resize(1200, 1200, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 80 }).toBuffer();
  } catch { return null; }
}

async function localCoverAvatar(value) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1 || number > 20) return null;
  const avatarPath = path.join(__dirname, '..', 'public', 'images', 'dj-avatars', `avatar-${String(number).padStart(2, '0')}-pullup.png`);
  if (!fs.existsSync(avatarPath)) return null;
  try { return await sharp(avatarPath).resize(900, 900, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 82 }).toBuffer(); }
  catch { return null; }
}

async function loadDjPresskitAssets(profile, allowedPrefix, profileUrl) {
  const galleryUrls = Array.isArray(profile.gallery) ? profile.gallery.slice(0, 6) : [];
  const flyerUrls = Array.isArray(profile.upcoming_events) ? profile.upcoming_events.map(event => event?.flyer_url).filter(Boolean).slice(0, 4) : [];
  const [profilePhoto, gallery, flyers, coverAvatar, qr] = await Promise.all([
    remoteImage(profile.photo_url, allowedPrefix),
    Promise.all(galleryUrls.map(url => remoteImage(url, allowedPrefix))),
    Promise.all(flyerUrls.map(url => remoteImage(url, allowedPrefix))),
    localCoverAvatar(profile.cover_avatar),
    qrWithLogo(profileUrl),
  ]);
  return { profilePhoto, gallery: gallery.filter(Boolean), flyers: flyers.filter(Boolean), coverAvatar, qr };
}

function generateDjPresskitPdf(profile, assets, profileUrl) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 0, compress: true, autoFirstPage: true, info: { Title: `Press kit — ${text(profile.stage_name, 60)}`, Author: 'Pull Up!', Subject: 'Artist press kit' } });
    const chunks = [];
    doc.on('data', chunk => chunks.push(chunk));
    doc.on('error', reject);
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    try {
      drawCover(doc, profile, assets || {}, profileUrl);
      drawAbout(doc, profile, assets || {}, profileUrl);
      drawMusic(doc, profile, assets || {}, profileUrl);
      drawExperience(doc, profile, assets || {}, profileUrl);
      drawCareer(doc, profile, assets || {}, profileUrl);
      drawEvents(doc, profile, assets || {}, profileUrl);
      drawMedia(doc, profile, assets || {}, profileUrl);
      doc.end();
    } catch (error) {
      doc.end();
      reject(error);
    }
  });
}

module.exports = { generateDjPresskitPdf, loadDjPresskitAssets };
