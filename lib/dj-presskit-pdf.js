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

function sectionTitle(doc, number, title, x, y, color = COLORS.purple) {
  doc.font('Helvetica-Bold').fontSize(7).fillColor(color).text(String(number).padStart(2, '0'), x, y, { characterSpacing: 1.4 });
  doc.font('Helvetica-Bold').fontSize(19).fillColor(COLORS.ink).text(title.toUpperCase(), x, y + 17, { width: 330 });
  doc.save().moveTo(x, y + 46).lineTo(x + 330, y + 46).lineWidth(0.8).strokeColor('#d6d0db').stroke().restore();
  return y + 60;
}

function pageFooter(doc, pageNumber, profileUrl, dark = false) {
  const color = dark ? '#bcb4c4' : '#625b68';
  doc.font('Helvetica-Bold').fontSize(6.5).fillColor(color).text('PULL UP! — ARTIST PRESS KIT', 40, 810, { characterSpacing: 1.1 });
  doc.font('Helvetica').text(text(profileUrl, 90), 225, 810, { width: 300, align: 'right' });
  doc.font('Helvetica-Bold').text(String(pageNumber).padStart(2, '0'), 535, 810, { width: 20, align: 'right' });
}

function fitStageName(name) {
  if (name.length > 25) return 38;
  if (name.length > 17) return 48;
  return 64;
}

function drawCover(doc, profile, assets, profileUrl) {
  fillPage(doc, COLORS.ink);
  if (assets.profilePhoto) {
    doc.save().rect(0, 0, PAGE.width, PAGE.height).clip();
    doc.image(assets.profilePhoto, 0, 0, { cover: [PAGE.width, PAGE.height], align: 'center', valign: 'center' });
    doc.restore();
    doc.save().fillOpacity(0.72).rect(0, 0, PAGE.width, PAGE.height).fill(COLORS.ink).restore();
  }
  doc.save().fillOpacity(0.72).circle(520, 165, 210).fill(COLORS.purple).restore();
  doc.save().fillOpacity(0.28).circle(75, 730, 180).fill(COLORS.pink).restore();
  if (fs.existsSync(logoPath)) doc.image(logoPath, 38, 32, { fit: [72, 72] });
  doc.font('Helvetica-Bold').fontSize(7).fillColor('#d8c5fa').text('ARTIST PRESS KIT', 405, 50, { width: 150, align: 'right', characterSpacing: 1.7 });
  doc.font('Helvetica-Bold').fontSize(8).fillColor('#fff').text('PULL UP! PRESENTS', 40, 252, { characterSpacing: 1.8 });
  const name = text(profile.stage_name, 60).toUpperCase() || 'ARTISTE';
  doc.font('Helvetica-Bold').fontSize(fitStageName(name)).fillColor('#fff').text(name, 38, 278, { width: 510, height: 175, lineGap: -5 });
  const tagline = text(profile.tagline, 220);
  if (tagline) doc.font('Helvetica').fontSize(13).fillColor('#ddd5e2').text(tagline, 42, 472, { width: 390, lineGap: 5 });
  const genres = list(profile.genres).join('  /  ');
  if (genres) doc.font('Helvetica-Bold').fontSize(8).fillColor('#fff').text(genres.toUpperCase(), 42, 590, { width: 480, characterSpacing: 0.7, lineGap: 5 });
  doc.save().moveTo(42, 740).lineTo(555, 740).lineWidth(1).strokeColor('#625b68').stroke().restore();
  doc.font('Helvetica-Bold').fontSize(8).fillColor('#fff').text(text(profileUrl, 90), 42, 760, { width: 420 });
  doc.font('Helvetica-Bold').fontSize(7).fillColor('#d8c5fa').text('01', 530, 760, { width: 25, align: 'right' });
}

function drawAbout(doc, profile, assets, profileUrl) {
  doc.addPage();
  fillPage(doc, COLORS.paper);
  if (fs.existsSync(logoPath)) doc.image(logoPath, 42, 28, { fit: [52, 52] });
  doc.font('Helvetica-Bold').fontSize(7).fillColor(COLORS.purple).text('ARTIST PRESS KIT', 410, 43, { width: 145, align: 'right', characterSpacing: 1.4 });

  let y = sectionTitle(doc, 2, 'À propos', 42, 112);
  const bio = text(profile.bio, 2300);
  doc.font('Helvetica').fontSize(10).fillColor('#403947').text(bio || 'Présentation à venir.', 42, y, { width: 330, height: 285, lineGap: 4, ellipsis: true });
  y = 480;
  const experience = text(profile.experience, 850);
  if (experience) {
    y = sectionTitle(doc, 3, 'Parcours', 42, y);
    doc.font('Helvetica').fontSize(9.5).fillColor('#403947').text(experience, 42, y, { width: 330, height: 135, lineGap: 4, ellipsis: true });
  }
  const gallery = assets.gallery || [];
  if (gallery.length) {
    const top = 662, gap = 7, width = (330 - gap * 2) / 3;
    gallery.slice(0, 3).forEach((image, index) => {
      try { doc.image(image, 42 + index * (width + gap), top, { cover: [width, 102], align: 'center', valign: 'center' }); } catch {}
    });
  }

  doc.save().roundedRect(396, 112, 159, 650, 12).fill(COLORS.purple).restore();
  doc.font('Helvetica-Bold').fontSize(7).fillColor('#d9c8fb').text('BOOKING & CONTACT', 416, 138, { characterSpacing: 1.2 });
  if (assets.qr) {
    doc.save().roundedRect(416, 176, 119, 119, 8).fill('#fff').restore();
    doc.image(assets.qr, 422, 182, { fit: [107, 107] });
  }
  doc.font('Helvetica-Bold').fontSize(8).fillColor('#fff').text('SCANNER POUR VOIR LE PROFIL', 416, 310, { width: 119, align: 'center', lineGap: 3 });
  let sideY = 365;
  const contactRows = [
    ['E-MAIL', profile.booking_email], ['TÉLÉPHONE', profile.phone], ['DÉPLACEMENTS', profile.travel_areas],
  ];
  contactRows.forEach(([label, value]) => {
    value = text(value, 180); if (!value) return;
    doc.font('Helvetica-Bold').fontSize(6).fillColor('#d9c8fb').text(label, 416, sideY, { characterSpacing: 1 });
    doc.font('Helvetica').fontSize(8.5).fillColor('#fff').text(value, 416, sideY + 13, { width: 119, lineGap: 3 });
    sideY += 66;
  });
  const services = list(profile.service_types, 8);
  if (services.length) {
    doc.font('Helvetica-Bold').fontSize(6).fillColor('#d9c8fb').text('PRESTATIONS', 416, sideY, { characterSpacing: 1 });
    doc.font('Helvetica').fontSize(8.5).fillColor('#fff').text(services.join('\n'), 416, sideY + 14, { width: 119, lineGap: 5 });
  }
  pageFooter(doc, 2, profileUrl);
}

function drawCareer(doc, profile, assets, profileUrl) {
  const career = Array.isArray(profile.career_locations) ? profile.career_locations.slice(0, 8) : [];
  const events = Array.isArray(profile.upcoming_events) ? profile.upcoming_events.slice(0, 4) : [];
  if (!career.length && !events.length) return;
  doc.addPage();
  fillPage(doc, COLORS.ink);
  if (fs.existsSync(logoPath)) doc.image(logoPath, 42, 28, { fit: [52, 52] });
  doc.font('Helvetica-Bold').fontSize(7).fillColor('#d8c5fa').text('PARCOURS & ACTUALITÉS', 385, 43, { width: 170, align: 'right', characterSpacing: 1.3 });
  doc.font('Helvetica-Bold').fontSize(28).fillColor('#fff').text('SUR LA ROUTE', 42, 112);
  doc.font('Helvetica').fontSize(9).fillColor('#aaa2b0').text('Résidences, collaborations et prochaines dates.', 42, 150);
  let y = 195;
  career.slice(0, 6).forEach((entry, index) => {
    const cardY = y + index * 82;
    doc.save().roundedRect(42, cardY, 315, 68, 7).fill('#17131b').restore();
    doc.font('Helvetica-Bold').fontSize(6.5).fillColor('#b98af8').text(text(entry.type, 30).toUpperCase() || 'EXPÉRIENCE', 57, cardY + 13, { characterSpacing: 1 });
    doc.font('Helvetica-Bold').fontSize(13).fillColor('#fff').text(text(entry.name, 100) || 'Lieu', 57, cardY + 29, { width: 210, height: 19, ellipsis: true });
    const address = [text(entry.address, 120), text(entry.city, 60), text(entry.country, 50)].filter(Boolean).join(' · ');
    doc.font('Helvetica').fontSize(7.5).fillColor('#aaa2b0').text(address, 57, cardY + 49, { width: 245, height: 12, ellipsis: true });
    doc.font('Helvetica-Bold').fontSize(7.5).fillColor('#fff').text(text(entry.period, 40), 302, cardY + 16, { width: 38, align: 'right' });
  });
  doc.save().roundedRect(379, 195, 176, 535, 10).fill(COLORS.purple).restore();
  doc.font('Helvetica-Bold').fontSize(7).fillColor('#ddcefa').text('PROCHAINES SOIRÉES', 398, 218, { characterSpacing: 1 });
  if (!events.length) {
    doc.font('Helvetica').fontSize(10).fillColor('#fff').text('Nouvelles dates bientôt disponibles.', 398, 255, { width: 137, lineGap: 4 });
  } else {
    events.forEach((event, index) => {
      const eventY = 258 + index * 106;
      doc.save().moveTo(398, eventY - 14).lineTo(535, eventY - 14).lineWidth(0.7).strokeColor('#a987df').stroke().restore();
      const date = text(event.date, 10);
      doc.font('Helvetica-Bold').fontSize(7).fillColor('#e4d7fb').text(date || 'DATE À VENIR', 398, eventY, { characterSpacing: 0.7 });
      doc.font('Helvetica-Bold').fontSize(12).fillColor('#fff').text(text(event.name, 80) || 'Soirée à venir', 398, eventY + 18, { width: 137, height: 32, ellipsis: true });
      doc.font('Helvetica').fontSize(8).fillColor('#e4d7fb').text([text(event.place, 80), text(event.address, 100)].filter(Boolean).join('\n'), 398, eventY + 55, { width: 137, height: 38, ellipsis: true });
    });
  }
  pageFooter(doc, 3, profileUrl, true);
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
  const [profilePhoto, gallery, qr] = await Promise.all([
    remoteImage(profile.photo_url, allowedPrefix),
    Promise.all(galleryUrls.map(url => remoteImage(url, allowedPrefix))),
    qrWithLogo(profileUrl),
  ]);
  return { profilePhoto, gallery: gallery.filter(Boolean), qr };
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
      drawCareer(doc, profile, assets || {}, profileUrl);
      doc.end();
    } catch (error) {
      doc.end();
      reject(error);
    }
  });
}

module.exports = { generateDjPresskitPdf, loadDjPresskitAssets };
