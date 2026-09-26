const PDFDocument = require('pdfkit');
const QRCode = require('qrcode');
const sharp = require('sharp');
const fs = require('node:fs');
const path = require('node:path');

const PAGE = { width: 595.28, height: 841.89 };
const COLORS = { ink: '#0b0810', purple: '#7026e8', pink: '#ff2a93', paper: '#f4f1f6', muted: '#82798a' };
const logoPath = path.join(__dirname, '..', 'public', 'images', 'logo.png');
const CREATE_PRESSKIT_URL = 'https://pull-up.live/app?intent=dj-register';

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
  doc.save().rotate(-90, { origin: [24, 420] });
  doc.font('Helvetica-Bold').fontSize(8).fillColor('#c8c2cb').text('PULL UP!  /  ARTIST PRESS KIT', 24, 420, { characterSpacing: 1.8 });
  doc.restore();
  doc.save().moveTo(558, 124).lineTo(558, 258).lineWidth(0.7).strokeColor('#b8b0bd').stroke().restore();
  doc.font('Helvetica-Bold').fontSize(9).fillColor('#fff').text(String(page).padStart(2, '0'), 530, 270, { width: 28, align: 'right' });
}

function drawCreatePresskitCta(doc) {
  const x = 299, y = 720, width = 256, height = 78;
  doc.save().roundedRect(x, y, width, height, 8).fill(COLORS.purple).restore();
  doc.font('Helvetica-Bold').fontSize(16).fillColor('#fff').text('CRÉE TON\nPRESS KIT', x + 17, y + 18, { width: 142, height: 45, lineGap: 1, characterSpacing: 0.3, link: CREATE_PRESSKIT_URL });
  if (fs.existsSync(logoPath)) doc.image(logoPath, x + 178, y + 6, { fit: [66, 66] });
  doc.link(x, y, width, height, CREATE_PRESSKIT_URL);
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
  doc.font('Helvetica-Bold').fontSize(11).fillColor('#fff').text('PULL UP! ARTISTS', 357, 41, { width: 200, align: 'right', characterSpacing: 1.2 });
  doc.save().rect(38, 456, 34, 3).fill(COLORS.purple).restore();
  doc.font('Helvetica-Bold').fontSize(9).fillColor('#d5cde0').text('DJ  /  SOUND  /  PERFORMANCE', 38, 475, { characterSpacing: 1.4 });
  const name = text(profile.stage_name, 60).toUpperCase() || 'ARTISTE';
  doc.font('Helvetica-Bold').fontSize(fitStageName(name)).fillColor('#fff').text(name, 36, 503, { width: 520, height: 175, lineGap: -10, ellipsis: true });
  const tagline = text(profile.tagline, 220);
  if (tagline) doc.font('Helvetica').fontSize(14).fillColor('#ded8e2').text(tagline, 40, 669, { width: 475, height: 58, lineGap: 5, ellipsis: true });
  const genres = list(profile.genres).join('  /  ');
  if (genres) doc.font('Helvetica-Bold').fontSize(9.5).fillColor('#fff').text(genres.toUpperCase(), 40, 755, { width: 500, characterSpacing: 0.6, lineGap: 4 });
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
  doc.font('Helvetica-Bold').fontSize(14).fillColor('#fff').text('ABOUT ME', 39, 40, { characterSpacing: 1.5 });
  const name = text(profile.stage_name, 60).toUpperCase() || 'ARTISTE';
  doc.font('Helvetica-Bold').fontSize(fitStageName(name) - 4).fillColor('#fff').text(name, 38, 112, { width: 518, height: 104, lineGap: -8, ellipsis: true });
  doc.save().rect(39, 216, 52, 4).fill(COLORS.purple).restore();
  doc.font('Helvetica-Bold').fontSize(17).fillColor('#d7c5f5').text('BIOGRAPHIE', 39, 239, { characterSpacing: 1 });
  const bio = text(profile.bio, 5000) || 'Présentation à venir.';
  const bioSize = bio.length > 4000 ? 10 : bio.length > 2800 ? 11 : bio.length > 1700 ? 12.5 : bio.length > 900 ? 14 : 16.5;
  const bioColumns = bio.length > 1700 ? 2 : 1;
  doc.font('Helvetica').fontSize(bioSize).fillColor('#fff').text(bio, 39, 282, { width: 516, height: 438, columns: bioColumns, columnGap: 30, lineGap: bioColumns === 1 ? 7 : 5, ellipsis: true });
  doc.save().fillOpacity(0.16).roundedRect(38, 741, 517, 58, 5).fill('#ffffff').restore();
  doc.font('Helvetica-Bold').fontSize(9.5).fillColor('#cdb5f5').text('SIGNATURE ARTISTIQUE', 51, 752, { characterSpacing: 0.9 });
  doc.font('Helvetica').fontSize(11.5).fillColor('#fff').text(text(profile.tagline, 150), 51, 775, { width: 480, height: 18, ellipsis: true });
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
  doc.font('Helvetica-Bold').fontSize(13).fillColor('#fff').text('MUSIC / SERVICES', 39, 40, { characterSpacing: 1.5 });
  doc.font('Helvetica-Bold').fontSize(36).fillColor('#fff').text('UNIVERS MUSICAL', 39, 111, { width: 516 });
  doc.save().rect(39, 163, 42, 3).fill(COLORS.purple).restore();

  const genres = list(profile.genres, 6);
  doc.font('Helvetica-Bold').fontSize(10.5).fillColor('#cdb5f5').text('STYLES', 39, 190, { characterSpacing: 1.1 });
  doc.font('Helvetica-Bold').fontSize(23).fillColor('#fff').text(genres.join('  /  ').toUpperCase() || 'À COMPLÉTER', 39, 219, { width: 516, height: 95, lineGap: 5, ellipsis: true });
  const services = list(profile.service_types, 8);
  doc.font('Helvetica-Bold').fontSize(10.5).fillColor('#cdb5f5').text('PRESTATIONS', 39, 335, { characterSpacing: 1.1 });
  services.forEach((service, index) => {
    const col = index % 2, row = Math.floor(index / 2), x = 39 + col * 260, y = 364 + row * 43;
    doc.save().roundedRect(x, y, 246, 34, 17).lineWidth(0.7).strokeColor('#746d78').stroke().restore();
    doc.font('Helvetica-Bold').fontSize(9.5).fillColor('#fff').text(service.toUpperCase(), x + 13, y + 11, { width: 220, align: 'center', characterSpacing: 0.5 });
  });

  const musicLinks = [['SOUNDCLOUD', profile.soundcloud], ['MIXCLOUD', profile.mixcloud], ['SPOTIFY', profile.spotify], ['YOUTUBE', profile.youtube]].filter(([, value]) => safeLink(value));
  const linkTop = 551;
  doc.font('Helvetica-Bold').fontSize(10.5).fillColor('#cdb5f5').text('ÉCOUTER / REGARDER', 39, linkTop - 2, { characterSpacing: 1.1 });
  musicLinks.forEach(([label, value], index) => {
    const col = index % 2, row = Math.floor(index / 2), x = 39 + col * 260, y = linkTop + 30 + row * 58, href = safeLink(value);
    doc.font('Helvetica-Bold').fontSize(9.5).fillColor('#fff').text(label, x, y, { characterSpacing: 0.7, link: href });
    doc.font('Helvetica').fontSize(10.5).fillColor('#c9c2cd').text(linkLabel(href), x, y + 19, { width: 240, height: 22, ellipsis: true, link: href, underline: true });
  });

  doc.save().fillOpacity(0.16).roundedRect(39, 696, 516, 74, 5).fill('#ffffff').restore();
  doc.font('Helvetica-Bold').fontSize(9.5).fillColor('#cdb5f5').text('IDENTITÉ MUSICALE', 52, 708, { characterSpacing: 0.9 });
  doc.font('Helvetica').fontSize(11).fillColor('#fff').text(text(profile.tagline, 150), 52, 731, { width: 490, height: 30, lineGap: 4, ellipsis: true });
}

function drawExperience(doc, profile, assets, profileUrl) {
  doc.addPage();
  fillPage(doc, COLORS.ink);
  const background = assets.gallery?.[2] || assets.profilePhoto;
  imageCover(doc, background, 0, 0, PAGE.width, PAGE.height, 'center', 'top');
  if (background) darkOverlay(doc, 0.84);
  editorialChrome(doc, 4, 'Story / Collaborations');
  doc.font('Helvetica-Bold').fontSize(13).fillColor('#fff').text('STORY / COLLABORATIONS', 39, 40, { characterSpacing: 1.5 });
  doc.font('Helvetica-Bold').fontSize(35).fillColor('#fff').text('PARCOURS ARTISTIQUE', 39, 108, { width: 516 });
  doc.save().rect(39, 159, 42, 3).fill(COLORS.purple).restore();
  const experience = text(profile.experience, 2000);
  doc.font('Helvetica-Bold').fontSize(10.5).fillColor('#cdb5f5').text('AUTRES COLLABORATIONS ET PRÉCISIONS', 39, 190, { characterSpacing: 0.9 });
  if (experience) {
    const experienceSize = experience.length > 1500 ? 10.5 : experience.length > 900 ? 11.5 : 13;
    doc.font('Helvetica').fontSize(experienceSize).fillColor('#fff').text(experience, 39, 230, { width: 516, height: 438, columns: 2, columnGap: 30, lineGap: 5, ellipsis: true });
  } else {
    doc.font('Helvetica').fontSize(14).fillColor('#d7d0da').text('Les collaborations détaillées apparaîtront ici.', 39, 230, { width: 516 });
  }
  const selected = (Array.isArray(profile.career_locations) ? profile.career_locations : []).map(entry => text(entry.name, 60)).filter(Boolean).slice(0, 8);
  if (selected.length) {
    doc.save().fillOpacity(0.16).roundedRect(39, 686, 516, 84, 5).fill('#ffffff').restore();
    doc.font('Helvetica-Bold').fontSize(9.5).fillColor('#cdb5f5').text('LIEUX MARQUANTS', 52, 699, { characterSpacing: 0.9 });
    doc.font('Helvetica-Bold').fontSize(11).fillColor('#fff').text(selected.join('  /  ').toUpperCase(), 52, 725, { width: 490, height: 36, lineGap: 4, ellipsis: true });
  }
}

function drawCareer(doc, profile, assets, profileUrl) {
  doc.addPage();
  fillPage(doc, COLORS.ink);
  const background = assets.gallery?.[2] || assets.profilePhoto;
  imageCover(doc, background, 0, 0, PAGE.width, PAGE.height, 'center', 'top');
  if (background) darkOverlay(doc, 0.86);
  editorialChrome(doc, 5, 'Career / Places');
  doc.font('Helvetica-Bold').fontSize(13).fillColor('#fff').text('CAREER / PLACES', 39, 40, { characterSpacing: 1.5 });
  doc.font('Helvetica-Bold').fontSize(31).fillColor('#fff').text('RÉSIDENCES &\nCOLLABORATIONS', 39, 102, { width: 516, height: 78, lineGap: -2 });
  doc.save().rect(39, 190, 42, 3).fill(COLORS.purple).restore();
  const career = Array.isArray(profile.career_locations) ? profile.career_locations.slice(0, 8) : [];
  if (!career.length) {
    doc.font('Helvetica').fontSize(14).fillColor('#d7d0da').text('Aucune résidence ou collaboration renseignée.', 39, 226, { width: 516 });
  } else {
    career.forEach((entry, index) => {
      const col = index % 2, row = Math.floor(index / 2), x = 39 + col * 260, y = 211 + row * 139;
      doc.save().fillOpacity(0.18).roundedRect(x, y, 246, 120, 6).fill('#ffffff').restore();
      doc.font('Helvetica-Bold').fontSize(9).fillColor('#cdb5f5').text(text(entry.type, 30).toUpperCase() || 'EXPÉRIENCE', x + 14, y + 12, { width: 145, characterSpacing: 0.6 });
      doc.font('Helvetica-Bold').fontSize(9).fillColor('#fff').text(text(entry.period, 80), x + 166, y + 13, { width: 66, align: 'right' });
      doc.font('Helvetica-Bold').fontSize(17).fillColor('#fff').text(text(entry.name, 120) || 'Lieu', x + 14, y + 35, { width: 218, height: 39, ellipsis: true });
      const address = [text(entry.address, 180), text(entry.city, 100), text(entry.country, 80)].filter(Boolean).join(' · ');
      doc.font('Helvetica').fontSize(10).fillColor('#d0c9d4').text(address || 'Adresse non renseignée', x + 14, y + 79, { width: 218, height: 31, lineGap: 3, ellipsis: true });
    });
  }
}

function drawEvents(doc, profile, assets, profileUrl) {
  doc.addPage();
  fillPage(doc, COLORS.ink);
  const background = assets.gallery?.[3] || assets.gallery?.[0] || assets.profilePhoto;
  imageCover(doc, background, 0, 0, PAGE.width, PAGE.height, 'center', 'top');
  if (background) darkOverlay(doc, 0.88);
  editorialChrome(doc, 6, 'Upcoming events');
  doc.font('Helvetica-Bold').fontSize(13).fillColor('#fff').text('UPCOMING EVENTS', 39, 40, { characterSpacing: 1.5 });
  doc.font('Helvetica-Bold').fontSize(36).fillColor('#fff').text('PROCHAINES SOIRÉES', 39, 108, { width: 516 });
  doc.save().rect(39, 159, 42, 3).fill(COLORS.purple).restore();
  const events = Array.isArray(profile.upcoming_events) ? profile.upcoming_events.slice(0, 4) : [];
  if (!events.length) {
    doc.font('Helvetica').fontSize(14).fillColor('#d7d0da').text('Nouvelles dates bientôt disponibles.', 39, 206, { width: 516 });
  } else {
    events.forEach((event, index) => {
      const col = index % 2, row = Math.floor(index / 2), x = 39 + col * 260, y = 191 + row * 281, flyer = assets.flyers?.[index];
      doc.save().fillOpacity(0.18).roundedRect(x, y, 246, 258, 6).fill('#ffffff').restore();
      if (flyer) imageCover(doc, flyer, x, y, 246, 137, 'center', 'center');
      else {
        doc.save().fillOpacity(0.28).rect(x, y, 246, 137).fill(COLORS.purple).restore();
        doc.font('Helvetica-Bold').fontSize(8).fillColor('#fff').text('PULL UP! EVENT', x, y + 63, { width: 246, align: 'center', characterSpacing: 1.5 });
      }
      doc.font('Helvetica-Bold').fontSize(10).fillColor('#cdb5f5').text(text(event.date, 10) || 'DATE À VENIR', x + 13, y + 148, { characterSpacing: 0.5 });
      doc.font('Helvetica-Bold').fontSize(16).fillColor('#fff').text(text(event.name, 80) || 'Soirée à venir', x + 13, y + 170, { width: 220, height: 36, ellipsis: true });
      doc.font('Helvetica').fontSize(10).fillColor('#d0c9d4').text([text(event.place, 120), text(event.address, 180)].filter(Boolean).join(' · '), x + 13, y + 208, { width: 220, height: 27, ellipsis: true });
      const eventLink = safeLink(event.link_url);
      if (eventLink) doc.font('Helvetica-Bold').fontSize(9.5).fillColor('#c7a6f8').text('BILLETTERIE / INFOS', x + 13, y + 238, { width: 220, link: eventLink, underline: true, characterSpacing: 0.4 });
    });
  }
}

function drawMedia(doc, profile, assets, profileUrl) {
  doc.addPage();
  fillPage(doc, COLORS.ink);
  const background = assets.gallery?.[4] || assets.gallery?.[0] || assets.profilePhoto;
  imageCover(doc, background, 0, 0, PAGE.width, PAGE.height, 'center', 'top');
  if (background) darkOverlay(doc, 0.88);
  editorialChrome(doc, 7, 'Media / Contact');
  doc.font('Helvetica-Bold').fontSize(13).fillColor('#fff').text('MEDIA / CONTACT', 39, 40, { characterSpacing: 1.5 });
  doc.font('Helvetica-Bold').fontSize(36).fillColor('#fff').text('GALERIE & BOOKING', 39, 108, { width: 516 });
  doc.save().rect(39, 159, 42, 3).fill(COLORS.purple).restore();

  const gallery = assets.gallery || [];
  const cells = 6, gap = 7, cellW = (516 - gap * 2) / 3, cellH = 133;
  for (let index = 0; index < cells; index++) {
    const col = index % 3, row = Math.floor(index / 3), x = 39 + col * (cellW + gap), y = 190 + row * (cellH + gap);
    doc.save().rect(x, y, cellW, cellH).fill(index % 2 ? '#211b27' : '#17131b').restore();
    const visual = gallery[index] || (index === 0 ? assets.coverAvatar : null);
    if (visual) imageCover(doc, visual, x, y, cellW, cellH, 'center', 'center');
    else {
      doc.font('Helvetica-Bold').fontSize(8).fillColor('#82798a').text(`PHOTO ${String(index + 1).padStart(2, '0')}`, x, y + 62, { width: cellW, align: 'center', characterSpacing: 0.8 });
    }
    doc.save().rect(x + 8, y + 8, 24, 3).fill(COLORS.purple).restore();
  }

  doc.save().fillOpacity(0.16).roundedRect(39, 477, 247, 321, 6).fill('#ffffff').restore();
  doc.font('Helvetica-Bold').fontSize(11).fillColor('#cdb5f5').text('BOOKING', 54, 494, { characterSpacing: 1 });
  const bookingRows = [['E-MAIL', profile.booking_email], ['TÉLÉPHONE', profile.phone], ['DÉPLACEMENTS', profile.travel_areas]];
  bookingRows.forEach(([label, value], index) => {
    const y = 529 + index * 58;
    doc.font('Helvetica-Bold').fontSize(9.5).fillColor('#bdb5c1').text(label, 54, y, { characterSpacing: 0.5 });
    const content = text(value, 300) || 'Non renseigné';
    const link = label === 'E-MAIL' && content !== 'Non renseigné' ? `mailto:${content}` : label === 'TÉLÉPHONE' && content !== 'Non renseigné' ? `tel:${content.replace(/\s/g, '')}` : undefined;
    doc.font('Helvetica').fontSize(10.5).fillColor('#fff').text(content, 54, y + 17, { width: 215, height: 35, lineGap: 3, ellipsis: true, link, underline: Boolean(link) });
  });
  const publicHref = safeLink(profileUrl);
  doc.font('Helvetica-Bold').fontSize(9.5).fillColor('#bdb5c1').text('PAGE PUBLIQUE', 54, 708, { characterSpacing: 0.5 });
  doc.font('Helvetica').fontSize(10).fillColor('#fff').text(linkLabel(profileUrl) || text(profileUrl, 100), 54, 727, { width: 120, height: 43, lineGap: 3, ellipsis: true, link: publicHref, underline: true });

  if (assets.qr) {
    doc.save().rect(183, 697, 88, 88).fill('#fff').restore();
    doc.image(assets.qr, 187, 701, { fit: [80, 80] });
    if (publicHref) doc.link(183, 697, 88, 88, publicHref);
  }
  doc.font('Helvetica-Bold').fontSize(11).fillColor('#cdb5f5').text('LIENS INTERNET', 299, 494, { characterSpacing: 1 });
  const contactLinks = [['INSTAGRAM', profile.instagram], ['TIKTOK', profile.tiktok], ['SITE INTERNET', profile.website], ['RESIDENT ADVISOR', profile.resident_advisor], ['VIDÉO / LIVE', profile.video_url]].filter(([, value]) => safeLink(value));
  contactLinks.forEach(([label, value], index) => {
    const y = 526 + index * 37, href = safeLink(value);
    doc.font('Helvetica-Bold').fontSize(9.5).fillColor('#fff').text(label, 299, y, { width: 256, link: href, characterSpacing: 0.4 });
    doc.font('Helvetica').fontSize(10.2).fillColor('#c7a6f8').text(linkLabel(href), 299, y + 16, { width: 256, height: 16, ellipsis: true, link: href, underline: true });
  });
  drawCreatePresskitCta(doc);
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
