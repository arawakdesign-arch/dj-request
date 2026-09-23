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
  const selected=(profile.genres||'').split(',').map(s=>s.trim()).filter(Boolean);
  const genres=document.getElementById('djr-genres');genres.replaceChildren();
  [...new Set([...DjProfileSchema.genres,...selected])].forEach(g=>djChoice(genres,g,selected.includes(g),'genres').addEventListener('change',djGenreState));
  document.getElementById('djr-genre-search').value='';
  document.getElementById('djr-genre-search').oninput=djGenreState;djGenreState();
  const services=document.getElementById('djr-services');services.replaceChildren();
  DjProfileSchema.services.forEach(s=>djChoice(services,s,(profile.service_types||[]).includes(s),'services'));
  const covers=document.getElementById('djr-cover-options');covers.replaceChildren();
  for(let i=0;i<=20;i++) {
    const label=document.createElement('label');label.className='djr-cover-option';
    const radio=document.createElement('input');radio.type='radio';radio.name='cover';radio.value=i||'';radio.checked=i===(profile.cover_avatar||0);
    if(i){const img=document.createElement('img');img.src=`/images/dj-avatars/avatar-${String(i).padStart(2,'0')}-pullup.png`;img.alt='';img.loading='lazy';label.append(img);}
    label.append(radio,document.createTextNode(i?` Avatar ${i}`:' Aucune couverture'));covers.append(label);
  }
  djGallery=[...(profile.gallery||[])];renderDjGallery();
  document.getElementById('djr-gallery-input').onchange=uploadDjGallery;
  const cities=['Paris, France','Marseille, France','Lyon, France','Toulouse, France','Bordeaux, France','Lille, France','Nantes, France','Nice, France','Montpellier, France','Strasbourg, France','Rennes, France','Rouen, France','Grenoble, France','Dijon, France','Tours, France','Orléans, France','Clermont-Ferrand, France','Reims, France','Saint-Étienne, France','Perpignan, France','Fort-de-France, Martinique','Pointe-à-Pitre, Guadeloupe','Les Abymes, Guadeloupe','Cayenne, Guyane','Saint-Denis, La Réunion','Mamoudzou, Mayotte','Bruxelles, Belgique','Liège, Belgique','Genève, Suisse','Lausanne, Suisse','Montréal, Canada','Québec, Canada','Dakar, Sénégal','Abidjan, Côte d’Ivoire','Douala, Cameroun','Kinshasa, RD Congo','Londres, Royaume-Uni','Lisbonne, Portugal','Berlin, Allemagne','Barcelone, Espagne','Madrid, Espagne','Casablanca, Maroc','Tunis, Tunisie','Alger, Algérie','Port-au-Prince, Haïti','Port-Louis, Maurice','Lagos, Nigeria','Accra, Ghana','Johannesburg, Afrique du Sud','New York, États-Unis','Miami, États-Unis','Dubaï, Émirats arabes unis'];
  const datalist=document.getElementById('djr-cities');datalist.replaceChildren();
  cities.forEach(city=>{const option=document.createElement('option');option.value=city;datalist.append(option);});
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
  function section(title,text){if(!text)return null;const s=document.createElement('section'),h=document.createElement('h2'),content=document.createElement('p');h.textContent=title;content.textContent=text;s.append(h,content);box.append(s);return s;}
  function link(parent,label,value){const href=DjProfileSchema.url(value);if(!href)return;const a=document.createElement('a');a.textContent=label;a.href=href;a.target='_blank';a.rel='noopener noreferrer';parent.append(a);}
  function linksSection(title,entries){const links=document.createElement('div');links.className='pk-profile-links';entries.forEach(([label,value])=>link(links,label,value));if(!links.childNodes.length)return;const s=document.createElement('section'),h=document.createElement('h2');h.textContent=title;s.append(h,links);box.append(s);}
  const portrait=document.getElementById('pk-photo');
  if(portrait){portrait.alt=`Photo de ${p.stage_name||'ce DJ'}`;portrait.style.display=p.photo_url?'block':'none';}
  const art=document.getElementById('pk-hero-art');
  if(art)art.style.backgroundImage=p.cover_avatar?`url('/images/dj-avatars/avatar-${String(p.cover_avatar).padStart(2,'0')}-pullup.png')`:'';
  const genres=(p.genres||'').split(',').map(value=>value.trim()).filter(Boolean),genreBox=document.getElementById('pk-genre-chips');
  genreBox?.replaceChildren();genres.forEach(value=>{const chip=document.createElement('span');chip.textContent=value;genreBox?.append(chip);});
  section('À propos',p.bio);
  const services=Array.isArray(p.service_types)?p.service_types:[];
  if(services.length){const s=document.createElement('section'),h=document.createElement('h2'),chips=document.createElement('div');h.textContent='Prestations';chips.className='pk-profile-chips';services.forEach(value=>{const chip=document.createElement('span');chip.textContent=value;chips.append(chip);});s.append(h,chips);box.append(s);}
  linksSection('Écouter',[['SoundCloud',p.soundcloud],['Mixcloud',p.mixcloud],['YouTube',p.youtube],['Spotify',p.spotify]]);
  section('Résidences & collaborations',p.experience);
  if(p.gallery?.length){const gallery=document.createElement('section'),h=document.createElement('h2'),grid=document.createElement('div');h.textContent='Photos';grid.className='pk-profile-gallery';p.gallery.forEach((url,i)=>{const a=document.createElement('a'),img=document.createElement('img');a.href=url;a.target='_blank';a.rel='noopener noreferrer';img.src=url;img.alt=`${p.stage_name} — photo ${i+1}`;img.loading='lazy';a.append(img);grid.append(a);});gallery.append(h,grid);box.append(gallery);}
  linksSection('Liens',[['Instagram',p.instagram],['TikTok',p.tiktok],['Site web',p.website],['Resident Advisor',p.resident_advisor],['Vidéo live',p.video_url]]);
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
function djProfileUrl(){const id=djViewedProfileId||_djProfileCache?.id||_sbSession?.user?.id||currentUser?.uid;return id?`${location.origin}/app?dj=${encodeURIComponent(id)}`:location.href;}
async function shareDjProfile(){const data={title:_djProfileCache?.stage_name||'Profil DJ Pull Up',text:_djProfileCache?.tagline||'Découvre ce profil DJ sur Pull Up.',url:djProfileUrl()};try{if(navigator.share){await navigator.share(data);return;}await navigator.clipboard.writeText(data.url);toast('Lien du profil copié');}catch(e){if(e?.name!=='AbortError')toast('Impossible de partager le profil');}}
function djProfileBack(){if(djViewedProfileId){if(document.referrer.startsWith(location.origin))history.back();else location.href='/';return;}showPage(eid?'client':(currentUser?'profile':'auth'));}
