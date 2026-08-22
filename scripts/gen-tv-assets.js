// Génère les icônes et le banner Android TV à partir du logo existant (public/images/logo.png).
// Usage : node scripts/gen-tv-assets.js
const path   = require('path');
const sharp  = require('sharp');

const ROOT   = path.join(__dirname, '..');
const LOGO   = path.join(ROOT, 'public/images/logo.png');
const RES    = path.join(ROOT, 'android-tv/app/src/main/res');
const BRAND  = '#08080B'; // --ink (fond de marque, cf. public/css/app.css)
const VIOLET = '#6E3FF3'; // --vi

const ICONS = {
  'mipmap-mdpi/ic_launcher.png':    48,
  'mipmap-hdpi/ic_launcher.png':    72,
  'mipmap-xhdpi/ic_launcher.png':   96,
  'mipmap-xxhdpi/ic_launcher.png':  144,
  'mipmap-xxxhdpi/ic_launcher.png': 192,
};

async function run() {
  for (const [rel, size] of Object.entries(ICONS)) {
    const out = path.join(RES, rel);
    await sharp(LOGO)
      .resize(Math.round(size * 0.8), Math.round(size * 0.8), { fit: 'contain', background: BRAND })
      .extend({
        top: Math.round(size * 0.1), bottom: Math.round(size * 0.1),
        left: Math.round(size * 0.1), right: Math.round(size * 0.1),
        background: BRAND,
      })
      .flatten({ background: BRAND })
      .png()
      .toFile(out);
    console.log('✓', rel);
  }

  // Banner TV (requis par android:banner, format 320x180)
  const bannerLogo = await sharp(LOGO).resize(140, 140, { fit: 'contain' }).toBuffer();
  await sharp({
    create: { width: 320, height: 180, channels: 4, background: BRAND },
  })
    .composite([{ input: bannerLogo, gravity: 'center' }])
    .png()
    .toFile(path.join(RES, 'drawable-xhdpi/tv_banner.png'));
  console.log('✓ drawable-xhdpi/tv_banner.png');

  // Splash screen (plein écran, fond de marque + logo centré)
  const splashLogo = await sharp(LOGO).resize(360, 360, { fit: 'contain' }).toBuffer();
  await sharp({
    create: { width: 1920, height: 1080, channels: 4, background: BRAND },
  })
    .composite([{ input: splashLogo, gravity: 'center' }])
    .png()
    .toFile(path.join(RES, 'drawable/splash.png'));
  console.log('✓ drawable/splash.png');
}

run().catch((e) => { console.error(e); process.exit(1); });
