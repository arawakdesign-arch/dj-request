/* Extended DJ editor: all text is inserted with textContent, never HTML. */
let djMediaBusy = false;
let djGallery = [];
let djViewedProfileId = null;
const djFieldIds = {stage_name:'stage-name',booking_email:'booking-email',resident_advisor:'ra'};
function djField(key) { return document.getElementById('dj-edit-'+(djFieldIds[key] || key.replaceAll('_','-'))); }
function djFeedback(message) { document.getElementById('djr-feedback').textContent=message; }
function djChoice(container, value, checked, name) {
  const label=document.createElement('label'); label.className='djr-choice';
  const input=document.createElement('input'); input.type='checkbox'; input.name=name; input.value=value; input.checked=checked;
  label.append(input,document.createTextNode(value));container.append(label);
  return input;
}
function djSelected(name) { return [...document.querySelectorAll(`#djr-editor input[name="${name}"]:checked`)].map(e=>e.value); }
function djGenreState() {
  const count=djSelected('genres').length;
  const query=document.getElementById('djr-genre-search').value.toLocaleLowerCase('fr');
  document.querySelectorAll('#djr-genres input').forEach(input=>{
    input.disabled=!input.checked && count>=6;
    input.parentElement.hidden=!input.checked && !input.value.toLocaleLowerCase('fr').includes(query);
    input.parentElement.style.display=input.parentElement.hidden?'none':'';
  });
  document.getElementById('djr-genre-count').textContent=`${count} / 6 styles sélectionnés`;
}
function initDjProfileEditor(profile) {
  djFeedback('');
  document.querySelectorAll('#djr-editor [data-error]').forEach(e=>e.textContent='');
  document.querySelectorAll('#djr-editor [aria-invalid]').forEach(e=>e.removeAttribute('aria-invalid'));
  for(const key of [...Object.keys(DjProfileSchema.limits),...Object.keys(DjProfileSchema.links)]) {
    const field=djField(key);if(field) field.value=profile[key] || '';
  }
  const slugField=document.getElementById('dj-edit-slug');if(slugField) slugField.value=profile.slug || '';
  const selected=(profile.genres||'').split(',').map(s=>s.trim()).filter(Boolean);
  const genres=document.getElementById('djr-genres');genres.replaceChildren();
  [...new Set([...DjProfileSchema.genres,...selected])].forEach(g=>djChoice(genres,g,selected.includes(g),'genres').addEventListener('change',djGenreState));
  document.getElementById('djr-genre-search').value='';
  document.getElementById('djr-genre-search').oninput=djGenreState;djGenreState();
  const services=document.getElementById('djr-services');services.replaceChildren();
  DjProfileSchema.services.forEach(s=>djChoice(services,s,(profile.service_types||[]).includes(s),'services'));
  const coverPicker=document.querySelector('.djr-cover-picker'),coverSummary=coverPicker?.querySelector('summary'),coverHint=coverSummary?.querySelector('span');
  if(coverPicker)coverPicker.open=true;
  if(coverSummary){coverSummary.firstChild.textContent='Ton avatar Pull Up ';if(coverHint)coverHint.textContent='Choisis le personnage affiché dans ton médaillon · 20 créations';}
  const covers=document.getElementById('djr-cover-options');covers.replaceChildren();
  for(let i=0;i<=20;i++) {
    const label=document.createElement('label'),name=document.createElement('span');label.className='djr-cover-option';
    const radio=document.createElement('input');radio.type='radio';radio.name='cover';radio.value=i||'';radio.checked=i===(profile.cover_avatar||0);
    if(i){const img=document.createElement('img');img.src=`/images/dj-avatars/avatar-${String(i).padStart(2,'0')}-pullup.png`;img.alt='';img.loading='lazy';label.append(img);}
    else {const none=document.createElement('div');none.className='djr-cover-none';none.textContent='Sans avatar';label.append(none);}
    name.textContent=i?`Avatar ${String(i).padStart(2,'0')}`:'Aucun';label.append(radio,name);covers.append(label);
  }
  djGallery=[...(profile.gallery||[])];renderDjGallery();
  document.getElementById('djr-gallery-input').onchange=uploadDjGallery;
}
function collectDjProfile() {
  const input={};
  for(const key of [...Object.keys(DjProfileSchema.limits),...Object.keys(DjProfileSchema.links)]) input[key]=djField(key)?.value || '';
  input.genres=djSelected('genres');input.service_types=djSelected('services');
  input.cover_avatar=document.querySelector('#djr-editor input[name="cover"]:checked')?.value||null;
  const result=DjProfileSchema.validate(input,_djProfileCache?.photo_url);
  document.querySelectorAll('#djr-editor [data-error]').forEach(el=>{const key=el.dataset.error;el.textContent=result.errors[key]||'';el.id='djr-error-'+key;});
  document.querySelectorAll('#djr-editor [aria-invalid]').forEach(el=>el.removeAttribute('aria-invalid'));
  for(const key of Object.keys(result.errors)){const field=djField(key);if(field){field.setAttribute('aria-invalid','true');field.setAttribute('aria-describedby','djr-error-'+key);}}
  if(Object.keys(result.errors).length){
    djFeedback('Complète les champs indiqués avant d’enregistrer.');
    const key=Object.keys(result.errors)[0];const field=djField(key)||document.querySelector(`[data-error="${key}"]`);
    field?.scrollIntoView({block:'center',behavior:'smooth'});if(field?.focus)field.focus();return null;
  }
  result.value.slug=document.getElementById('dj-edit-slug')?.value.trim()||'';
  djFeedback('');return result.value;
}
function setDjMediaBusy(busy) {
  djMediaBusy=busy;
  document.querySelectorAll('#djr-editor button, #djr-editor input[type="file"]').forEach(e=>e.disabled=busy);
}
function renderDjGallery() {
  const box=document.getElementById('djr-gallery');box.replaceChildren();
  djGallery.forEach((url,index)=>{
    const item=document.createElement('div');const img=document.createElement('img');img.src=url;img.alt=`Photo ${index+1}`;
    const button=document.createElement('button');button.type='button';button.textContent='Supprimer';button.setAttribute('aria-label',`Supprimer la photo ${index+1}`);button.disabled=djMediaBusy;
    button.onclick=async()=>{
      if(djMediaBusy)return;setDjMediaBusy(true);
      try{const result=await api('DELETE','/dj/profile/gallery',{url});djGallery=result.gallery;_djProfileCache.gallery=[...djGallery];renderDjGallery();applyDjProfileToPresskit();}
      catch(e){djFeedback(e.message||'Impossible de supprimer cette photo.');}
      finally{setDjMediaBusy(false);}
    };
    item.append(img,button);box.append(item);
  });
  document.getElementById('djr-gallery-status').textContent=`${djGallery.length} / 6 photos`;
}
async function uploadDjGallery(event) {
  if(djMediaBusy)return;
  const input=event.target,files=[...input.files];input.value='';
  if(files.length+djGallery.length>6){djFeedback('Tu peux ajouter jusqu’à 6 photos au total.');return;}
  if(files.some(file=>file.size>5*1024*1024||!file.type.startsWith('image/'))){djFeedback('Choisis uniquement des images de moins de 5 Mo.');return;}
  setDjMediaBusy(true);djFeedback('');
  try{
    for(let i=0;i<files.length;i++){
      document.getElementById('djr-gallery-status').textContent=`Envoi de la photo ${i+1} sur ${files.length}…`;
      const form=new FormData();form.append('photo',files[i]);
      const response=await fetch('/api/dj/profile/gallery',{method:'POST',headers:{Authorization:'Bearer '+(_sbSession?.access_token||_authToken)},body:form});
      const result=await response.json();if(!response.ok)throw new Error(result.error||'Envoi impossible.');
      djGallery=result.gallery;_djProfileCache=_djProfileCache||{};_djProfileCache.gallery=[...djGallery];
    }
    applyDjProfileToPresskit();
  }catch(e){djFeedback(e.message);}
  finally{setDjMediaBusy(false);renderDjGallery();}
}
function renderDjProfileDetails(p) {
  const box=document.getElementById('pk-profile-details');if(!box)return;box.replaceChildren();
  function heading(s,title,kicker){const head=document.createElement('div'),label=document.createElement('span'),h=document.createElement('h2');head.className='pk3-section-heading';label.className='pk3-section-label';label.textContent=kicker;h.textContent=title;head.append(label,h);s.append(head);}
  function section(title,text,id,kicker){if(!text)return null;const s=document.createElement('section'),content=document.createElement('p');s.id=id;s.className='pk3-section';heading(s,title,kicker);content.textContent=text;s.append(content);box.append(s);return s;}
  function link(parent,label,value){const href=DjProfileSchema.url(value);if(!href)return;const a=document.createElement('a');a.textContent=label;a.href=href;a.target='_blank';a.rel='noopener noreferrer';parent.append(a);}
  function linksSection(title,entries,id,kicker){const links=document.createElement('div');links.className='pk-profile-links';entries.forEach(([label,value])=>link(links,label,value));if(!links.childNodes.length)return;const s=document.createElement('section');s.id=id;s.className='pk3-section';heading(s,title,kicker);s.append(links);box.append(s);}
  const portrait=document.getElementById('pk-photo');
  const avatarUrl=p.cover_avatar?`/images/dj-avatars/avatar-${String(p.cover_avatar).padStart(2,'0')}-pullup.png`:'';
  if(portrait){portrait.src=avatarUrl||p.photo_url||'/images/logo.png';portrait.alt=avatarUrl?`Avatar Pull Up de ${p.stage_name||'ce DJ'}`:`Photo de ${p.stage_name||'ce DJ'}`;portrait.style.display=(avatarUrl||p.photo_url)?'block':'none';portrait.classList.toggle('pk2-avatar-medallion',!!avatarUrl);}
  const art=document.getElementById('pk-hero-art');
  if(art){art.style.backgroundImage=p.photo_url?`url(${JSON.stringify(p.photo_url)})`:'';art.closest('.pk3-avatar-stage')?.classList.toggle('has-profile-photo',!!p.photo_url);}
  const genres=(p.genres||'').split(',').map(value=>value.trim()).filter(Boolean),genreBox=document.getElementById('pk-genre-chips');
  genreBox?.replaceChildren();genres.forEach(value=>{const chip=document.createElement('span');chip.textContent=value;genreBox?.append(chip);});
  const about=section('À propos',p.bio,'pk-about','01 / IDENTITÉ');
  const services=Array.isArray(p.service_types)?p.service_types:[];
  if(services.length&&about){const chips=document.createElement('div');chips.className='pk-profile-chips';services.forEach(value=>{const chip=document.createElement('span');chip.textContent=value;chips.append(chip);});about.append(chips);}
  linksSection('Écouter',[['SoundCloud',p.soundcloud],['Mixcloud',p.mixcloud],['YouTube',p.youtube],['Spotify',p.spotify]],'pk-music','02 / SÉLECTION');
  section('Résidences & collaborations',p.experience,'pk-experience','03 / PARCOURS');
  if(p.gallery?.length){const gallery=document.createElement('section'),grid=document.createElement('div');gallery.id='pk-gallery';gallery.className='pk3-section pk3-gallery-section';heading(gallery,'Photos','04 / GALERIE');grid.className='pk-profile-gallery';p.gallery.forEach((url,i)=>{const photo=document.createElement('div'),img=document.createElement('img');photo.className='pk-profile-photo';img.src=url;img.alt=`${p.stage_name} — photo ${i+1}`;img.loading='lazy';photo.append(img);grid.append(photo);});gallery.append(grid);box.append(gallery);}
  linksSection('En ligne',[['Instagram',p.instagram],['TikTok',p.tiktok],['Site web',p.website],['Resident Advisor',p.resident_advisor],['Vidéo live',p.video_url]],'pk-links','05 / CONTACT');
  const area=document.getElementById('pk-travel-areas');if(area)area.textContent=p.travel_areas||'Zones de déplacement à confirmer';
  const email=document.getElementById('pk-booking-email');if(email)email.textContent=p.booking_email||'Non renseigné';
  const phone=document.getElementById('pk-booking-phone');if(phone){phone.hidden=!p.phone;phone.textContent=p.phone?`WhatsApp / téléphone · ${p.phone}`:'';phone.href=p.phone?'tel:'+p.phone.replace(/[^+\d]/g,''):'';}
  const contact=document.getElementById('pk-booking-contact');if(contact){contact.disabled=!p.booking_email;contact.onclick=()=>{if(p.booking_email)location.href='mailto:'+p.booking_email;};}
}

async function openPublicDjProfile(id) {
  if(!id)return false;
  try{const profile=await api('GET','/dj/profile/'+encodeURIComponent(id));djViewedProfileId=id;_djProfileCache=profile;showPage('presskit');return true;}
  catch(e){return false;}
}
async function openPublicDjProfileBySlug(slug) {
  if(!slug)return false;
  try{const profile=await api('GET','/dj/by-slug/'+encodeURIComponent(slug));djViewedProfileId=profile.id;_djProfileCache=profile;showPage('presskit');return true;}
  catch(e){return false;}
}
function djProfileUrl(){
  const slug=_djProfileCache?.slug;
  if(slug) return `${location.origin}/${encodeURIComponent(slug)}`;
  const id=djViewedProfileId||_djProfileCache?.id||_sbSession?.user?.id||currentUser?.uid;
  return id?`${location.origin}/app?dj=${encodeURIComponent(id)}`:location.href;
}
async function shareDjProfile(){const data={title:_djProfileCache?.stage_name||'Profil DJ Pull Up',text:_djProfileCache?.tagline||'Découvre ce profil DJ sur Pull Up.',url:djProfileUrl()};try{if(navigator.share){await navigator.share(data);return;}await navigator.clipboard.writeText(data.url);toast('Lien du profil copié');}catch(e){if(e?.name!=='AbortError')toast('Impossible de partager le profil');}}
function djProfileBack(){if(djViewedProfileId){if(document.referrer.startsWith(location.origin))history.back();else location.href='/';return;}showPage(eid?'client':(currentUser?'profile':'auth'));}
