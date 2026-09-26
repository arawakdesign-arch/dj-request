const test = require('node:test');
const assert = require('node:assert/strict');
const { generateDjPresskitPdf, loadDjPresskitAssets } = require('../lib/dj-presskit-pdf');

const profile = {
  stage_name: 'DJ Étoile',
  tagline: 'Afro house et vibrations caribéennes',
  bio: 'Une présentation complète du parcours artistique et de son univers musical.',
  experience: 'Résident de plusieurs clubs et invité de festivals.',
  genres: 'Afro house, Amapiano, Shatta',
  service_types: ['Club', 'Festival'],
  booking_email: 'booking@example.com',
  phone: '+33 6 12 34 56 78',
  travel_areas: 'France et Europe',
  instagram: 'https://instagram.com/dj-etoile',
  website: 'https://dj-etoile.example.com',
  soundcloud: 'https://soundcloud.com/dj-etoile',
  career_locations: [{ type: 'Résidence', name: 'Le Club', address: '1 rue de Paris', city: 'Paris', country: 'France', period: '2024' }],
  upcoming_events: [{ date: '2026-10-18', name: 'Pull Up Night', place: 'Le Club', address: 'Paris', link_url: 'https://tickets.example.com/pull-up-night' }],
};

test('automatic DJ press kit generation returns a valid multi-page PDF', async () => {
  const pdf = await generateDjPresskitPdf(profile, {}, 'https://pull-up.live/dj-etoile');
  assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
  assert.match(pdf.subarray(-20).toString(), /%%EOF/);
  assert.ok(pdf.length > 3000);
  const source = pdf.toString('latin1');
  assert.equal((source.match(/\/Type \/Page\b/g) || []).length, 7);
  assert.ok(source.includes('/URI (https://soundcloud.com/dj-etoile)'));
  assert.ok(source.includes('/URI (https://instagram.com/dj-etoile)'));
  assert.ok(source.includes('/URI (https://dj-etoile.example.com/)'));
  assert.ok(source.includes('/URI (https://tickets.example.com/pull-up-night)'));
  assert.ok(source.includes('/URI (https://pull-up.live/app?intent=dj-register)'));
});

test('press kit assets reject photos outside the DJ storage prefix', async () => {
  const assets = await loadDjPresskitAssets({ ...profile, photo_url: 'https://evil.example/photo.jpg', gallery: ['https://evil.example/gallery.jpg'], upcoming_events: [{ flyer_url: 'https://evil.example/flyer.jpg' }] }, 'https://storage.example/dj/test/', 'https://pull-up.live/dj-etoile');
  assert.equal(assets.profilePhoto, null);
  assert.deepEqual(assets.gallery, []);
  assert.deepEqual(assets.flyers, []);
  assert.equal(assets.coverAvatar, null);
  assert.equal(assets.qr.subarray(1, 4).toString(), 'PNG');
});
