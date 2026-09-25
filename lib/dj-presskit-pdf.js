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
  if (background) darkOverlay(doc, 0.66);
  darkOverlay(doc, 0.28, 322, 0, 273, PAGE.height);
  imageCover(doc, assets.profilePhoto, 72, 128, 258, 506, 'center', 'top');
  doc.save().fillOpacity(0.22).rect(72, 128, 258, 506).fill('#070509').restore();
  editorialChrome(doc, 2, 'About me');
  doc.font('Helvetica-Bold').fontSize(7).fillColor('#fff').text('ABOUT ME', 79, 42, { characterSpacing: 1.8 });

  const bio = text(profile.bio, 2200) || 'Présentation à venir.';
  doc.font('Helvetica-Bold').fontSize(6.5).fillColor('#bfa0f2').text('BIOGRAPHIE', 354, 137, { characterSpacing: 1.4 });
  doc.font('Helvetica').fontSize(9.4).fillColor('#fff').text(bio, 354, 160, { width: 190, height: 286, lineGap: 4, ellipsis: true, align: 'right' });
  const experience = text(profile.experience, 700);
  if (experience) {
    doc.font('Helvetica-Bold').fontSize(6.5).fillColor('#bfa0f2').text('PARCOURS', 354, 470, { width: 190, align: 'right', characterSpacing: 1.4 });
    doc.font('Helvetica').fontSize(8.5).fillColor('#ddd7e1').text(experience, 354, 490, { width: 190, height: 92, lineGap: 3, ellipsis: true, align: 'right' });
  }
  const name = text(profile.stage_name, 60).toUpperCase() || 'ARTISTE';
  doc.font('Helvetica-Bold').fontSize(fitStageName(name) - 5).fillColor('#fff').text(name, 39, 548, { width: 510, height: 112, lineGap: -8, ellipsis: true });

  const career = Array.isArray(profile.career_locations) ? profile.career_locations.slice(0, 6) : [];
  if (career.length) {
    doc.font('Helvetica-Bold').fontSize(6).fillColor('#bfa0f2').text('SELECTED PLACES', 39, 673, { characterSpacing: 1.4 });
    doc.font('Helvetica-Bold').fontSize(8).fillColor('#fff').text(career.map(entry => text(entry.name, 32).toUpperCase()).filter(Boolean).join('\n'), 39, 694, { width: 170, height: 80, lineGap: 4, ellipsis: true });
  }
  const contacts = [text(profile.booking_email, 100), text(profile.phone, 50), text(profile.travel_areas, 100)].filter(Boolean);
  doc.font('Helvetica-Bold').fontSize(6).fillColor('#bfa0f2').text('CONTACT / BOOKING', 354, 673, { width: 190, align: 'right', characterSpacing: 1.4 });
  doc.font('Helvetica').fontSize(8).fillColor('#fff').text(contacts.join('\n'), 354, 694, { width: 190, height: 54, lineGap: 4, align: 'right', ellipsis: true });
  const socials = socialNames(profile).map(([label]) => label).join('  /  ');
  if (socials) doc.font('Helvetica-Bold').fontSize(6).fillColor('#d6d0da').text(socials, 245, 758, { width: 299, align: 'right', characterSpacing: 0.6 });
  footer(doc, profileUrl);
}

function drawMedia(doc, profile, assets, profileUrl) {
  doc.addPage();
  fillPage(doc, COLORS.ink);
  const background = assets.gallery?.[1] || assets.gallery?.[0] || assets.profilePhoto;
  imageCover(doc, background, 0, 0, PAGE.width, PAGE.height, 'center', 'top');
  if (background) darkOverlay(doc, 0.76);
  darkOverlay(doc, 0.22, 218, 0, 377, PAGE.height);
  editorialChrome(doc, 3, 'Dates / Visuals');
  doc.font('Helvetica-Bold').fontSize(7).fillColor('#fff').text('DATES / VISUELS', 79, 42, { characterSpacing: 1.8 });

  const name = text(profile.stage_name, 60).toUpperCase() || 'ARTISTE';
  doc.save().rotate(-90, { origin: [63, 722] });
  doc.font('Helvetica-Bold').fontSize(Math.min(62, fitStageName(name))).fillColor('#fff').text(name, 63, 722, { width: 525, height: 80, ellipsis: true });
  doc.restore();
  if (assets.profilePhoto) imageCover(doc, assets.profilePhoto, 92, 130, 142, 485, 'center', 'top');
  doc.save().fillOpacity(0.25).rect(92, 130, 142, 485).fill('#050407').restore();

  const visuals = [...(assets.flyers || []), ...(assets.gallery || [])].slice(0, 4);
  const visualX = 263, visualY = 126, visualGap = 8, visualW = 137, visualH = 150;
  for (let index = 0; index < 4; index++) {
    const x = visualX + (index % 2) * (visualW + visualGap), y = visualY + Math.floor(index / 2) * (visualH + visualGap);
    doc.save().rect(x, y, visualW, visualH).fill(index % 2 ? '#211b27' : '#17131b').restore();
    if (visuals[index]) imageCover(doc, visuals[index], x, y, visualW, visualH, 'center', 'center');
    doc.save().rect(x + 8, y + 8, 24, 3).fill(COLORS.purple).restore();
  }

  const events = Array.isArray(profile.upcoming_events) ? profile.upcoming_events.slice(0, 4) : [];
  doc.font('Helvetica-Bold').fontSize(6.5).fillColor('#bfa0f2').text('PROCHAINES SOIRÉES', 263, 462, { characterSpacing: 1.4 });
  if (!events.length) {
    doc.font('Helvetica').fontSize(10).fillColor('#fff').text('Nouvelles dates bientôt disponibles.', 263, 489, { width: 282 });
  } else {
    events.forEach((event, index) => {
      const x = 263 + (index % 2) * 145, y = 490 + Math.floor(index / 2) * 92;
      doc.save().moveTo(x, y).lineTo(x + 133, y).lineWidth(0.7).strokeColor('#77707c').stroke().restore();
      doc.font('Helvetica-Bold').fontSize(6.3).fillColor('#bfa0f2').text(text(event.date, 10) || 'DATE À VENIR', x, y + 11, { characterSpacing: 0.7 });
      doc.font('Helvetica-Bold').fontSize(10).fillColor('#fff').text(text(event.name, 80) || 'Soirée à venir', x, y + 28, { width: 133, height: 28, ellipsis: true });
      doc.font('Helvetica').fontSize(7).fillColor('#c9c2cd').text([text(event.place, 70), text(event.address, 100)].filter(Boolean).join(' · '), x, y + 59, { width: 133, height: 24, ellipsis: true });
    });
  }
  if (assets.qr) {
    doc.save().rect(104, 651, 104, 104).fill('#fff').restore();
    doc.image(assets.qr, 109, 656, { fit: [94, 94] });
    doc.font('Helvetica-Bold').fontSize(6).fillColor('#fff').text('SCANNER LE PROFIL', 104, 765, { width: 104, align: 'center', characterSpacing: 0.8 });
  }
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

async function loadDjPresskitAssets(profile, allowedPrefix, profileUrl) {
  const galleryUrls = Array.isArray(profile.gallery) ? profile.gallery.slice(0, 3) : [];
  const flyerUrls = Array.isArray(profile.upcoming_events) ? profile.upcoming_events.map(event => event?.flyer_url).filter(Boolean).slice(0, 4) : [];
  const [profilePhoto, gallery, flyers, qr] = await Promise.all([
    remoteImage(profile.photo_url, allowedPrefix),
    Promise.all(galleryUrls.map(url => remoteImage(url, allowedPrefix))),
    Promise.all(flyerUrls.map(url => remoteImage(url, allowedPrefix))),
    qrWithLogo(profileUrl),
  ]);
  return { profilePhoto, gallery: gallery.filter(Boolean), flyers: flyers.filter(Boolean), qr };
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
      drawMedia(doc, profile, assets || {}, profileUrl);
      doc.end();
    } catch (error) {
      doc.end();
      reject(error);
    }
  });
}

module.exports = { generateDjPresskitPdf, loadDjPresskitAssets };
