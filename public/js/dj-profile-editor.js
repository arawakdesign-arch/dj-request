/* Extended DJ editor: all text is inserted with textContent, never HTML. */
// Consentement (par plateforme, mémorisé pour la session) avant de charger un
// lecteur SoundCloud/Mixcloud/Spotify/YouTube — cf. playersSection() plus bas.
// Réinitialisable depuis Paramètres → Confidentialité.
const EMBED_PLATFORMS = ['soundcloud', 'mixcloud', 'spotify', 'youtube'];
function resetEmbedConsent() {
  try { EMBED_PLATFORMS.forEach(p => sessionStorage.removeItem('pullup_embed_ok_' + p)); } catch(e) {}
  if (typeof djViewedProfileId !== 'undefined' && document.getElementById('pg-presskit')?.classList.contains('active') && typeof applyDjProfileToPresskit === 'function') applyDjProfileToPresskit();
  if (typeof toast === 'function') toast('Préférences de contenus externes réinitialisées');
}
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
function djEventField(index,key){return document.getElementById(`dj-event-${index}-${key.replaceAll('_','-')}`);}
let djSlugCheckTimer=null,djSlugCheckSequence=0;
function normalizeDjSlug(value){
  return (value||'').toLocaleLowerCase('fr').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'').slice(0,60);
}
function updateDjPublicUrlPreview(){
  const field=document.getElementById('dj-edit-slug'),preview=document.getElementById('djr-public-url-preview');
  if(!field||!preview)return;
  const slug=normalizeDjSlug(field.value),label=`pull-up.live/${slug||'nom-du-dj'}`;
  preview.textContent=label;preview.href=slug?`${location.origin}/${encodeURIComponent(slug)}`:'#';
  preview.classList.toggle('is-placeholder',!slug);
}
function showDjSlugAvailability(state,message){
  const status=document.getElementById('djr-slug-status'),field=document.querySelector('.djr-url-field');
  if(status){status.dataset.state=state;status.textContent=message;}
  if(field)field.dataset.availability=state;
}
function checkDjSlugAvailability(delay=450){
  clearTimeout(djSlugCheckTimer);
  const field=document.getElementById('dj-edit-slug'),slug=normalizeDjSlug(field?.value),sequence=++djSlugCheckSequence;
  if(!slug){showDjSlugAvailability('idle','Entre ton nom de DJ pour vérifier l’adresse.');return;}
  showDjSlugAvailability('checking','Vérification de l’adresse…');
  djSlugCheckTimer=setTimeout(async()=>{
    try{
      const result=await api('GET','/dj/slug-availability/'+encodeURIComponent(slug));
      if(sequence!==djSlugCheckSequence||normalizeDjSlug(field?.value)!==slug)return;
      showDjSlugAvailability(result.available?'available':'taken',result.available?'Cette adresse est disponible !':'Cette adresse est déjà prise. Essaie une autre variante.');
    }catch(e){
      if(sequence===djSlugCheckSequence)showDjSlugAvailability('error','Vérification impossible pour le moment. Tu peux continuer à remplir ton profil.');
    }
  },delay);
}
async function copyDjPublicUrl(){
  const slug=normalizeDjSlug(document.getElementById('dj-edit-slug')?.value);
  if(!slug){djFeedback('Choisis ton nom de scène pour créer ton lien.');document.getElementById('dj-edit-stage-name')?.focus();return;}
  if(document.getElementById('djr-slug-status')?.dataset.state==='taken'){djFeedback('Cette adresse est déjà prise. Choisis-en une autre avant de copier le lien.');document.getElementById('dj-edit-slug')?.focus();return;}
  const url=`${location.origin}/${encodeURIComponent(slug)}`;
  try{await navigator.clipboard.writeText(url);if(typeof toast==='function')toast('Lien copié !');}
  catch(e){if(typeof toast==='function')toast(url);}
}
function updateDjEventFlyerPreview(index,url){
  const preview=document.getElementById(`dj-event-${index}-flyer-preview`);
  if(!preview)return;
  preview.style.backgroundImage=url?`url(${JSON.stringify(url)})`:'';
  preview.classList.toggle('has-flyer',!!url);
  preview.textContent=url?'':'Aucun flyer';
}
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
function collectDjEvents() {
  return [...document.querySelectorAll('#djr-upcoming-events .djr-event-card')].map((card,i)=>
    Object.fromEntries(Object.keys(DjProfileSchema.eventLimits).map(key=>[key,djEventField(i,key)?.value||''])));
}
function renderDjEventEditor(events) {
  const list=document.getElementById('djr-upcoming-events');if(!list)return;list.replaceChildren();
  const safeEvents=Array.isArray(events)?events.slice(0,4):[];
  for(let i=0;i<Math.max(1,safeEvents.length);i++){
    const event=safeEvents[i]||{},card=document.createElement('div');card.className='djr-event-card';
    const head=document.createElement('div'),index=document.createElement('span'),title=document.createElement('strong');
    head.className='djr-event-card-head';index.textContent=String(i+1).padStart(2,'0');title.textContent=i===0?'Prochaine soirée':'Soirée à venir';head.append(index,title);
    const fields=document.createElement('div');fields.className='djr-fields';
    const flyerWrap=document.createElement('div'),flyerLabel=document.createElement('label'),flyerInput=document.createElement('input'),file=document.createElement('input'),preview=document.createElement('div'),actions=document.createElement('div'),choose=document.createElement('button'),clear=document.createElement('button');
    flyerWrap.className='fl djr-wide';flyerLabel.htmlFor=`dj-event-${i}-flyer-input`;flyerLabel.textContent='Flyer';
    flyerInput.type='hidden';flyerInput.id=`dj-event-${i}-flyer-url`;flyerInput.value=event.flyer_url||'';
    file.type='file';file.id=`dj-event-${i}-flyer-input`;file.accept='image/*';file.hidden=true;file.onchange=()=>uploadDjEventFlyer(file,i);
    preview.id=`dj-event-${i}-flyer-preview`;preview.className='djr-event-flyer-preview';preview.setAttribute('aria-hidden','true');
    actions.className='djr-event-flyer-actions';
    choose.type='button';choose.textContent=event.flyer_url?'Changer le flyer':'Charger le flyer';choose.onclick=()=>file.click();
    clear.type='button';clear.textContent='Retirer';clear.onclick=()=>{flyerInput.value='';choose.textContent='Charger le flyer';updateDjEventFlyerPreview(i,'');};
    actions.append(choose,clear);flyerWrap.append(flyerLabel,flyerInput,file,preview,actions);fields.append(flyerWrap);
    if(event.flyer_url){preview.style.backgroundImage=`url(${JSON.stringify(event.flyer_url)})`;preview.classList.add('has-flyer');}
    else preview.textContent='Aucun flyer';
    [
      ['date','Date','','date'],
      ['name','Nom de l’event','Hustle & Flow','text'],
      ['place','Lieu','Nom du club ou de la salle','text'],
      ['address','Adresse','Adresse préremplie après choix du lieu','text'],
      ['link_url','Lien de redirection','https://…','url'],
    ].forEach(([key,label,placeholder,type])=>{
      const wrap=document.createElement('div'),lab=document.createElement('label'),input=document.createElement('input');
      wrap.className=(key==='link_url'||key==='address')?'fl djr-wide':'fl';lab.htmlFor=`dj-event-${i}-${key.replaceAll('_','-')}`;lab.textContent=label;
      input.id=lab.htmlFor;input.className='fi';input.type=type;input.maxLength=String(DjProfileSchema.eventLimits[key]||1000);input.placeholder=placeholder;input.value=event[key]||'';
      if(key==='place'){
        input.autocomplete='off';
        input.oninput=()=>{ if(typeof _venueSearch==='function') _venueSearch(input.value,input.id,`dj-event-${i}-address`); };
        const results=document.createElement('div');results.id=input.id+'-results';results.className='djr-event-search-results';
        wrap.append(lab,input,results);
      } else if(key==='address'){
        input.autocomplete='off';
        input.oninput=()=>{ if(typeof _addressSearch==='function') _addressSearch(input.value,input.id); };
        const results=document.createElement('div');results.id=input.id+'-results';results.className='djr-event-search-results';
        wrap.append(lab,input,results);
      } else wrap.append(lab,input);
      fields.append(wrap);
    });
    const remove=document.createElement('button');remove.type='button';remove.className='djr-event-remove';remove.textContent='Supprimer la soirée';
    remove.onclick=()=>{const current=collectDjEvents();current.splice(i,1);renderDjEventEditor(current);};
    head.append(remove);card.append(head,fields);list.append(card);
  }
  if(list.children.length<4){
    const add=document.createElement('button');add.type='button';add.className='djr-event-add';add.textContent='Ajouter une soirée';
    add.onclick=()=>{const current=collectDjEvents();if(current.length<4){current.push({});renderDjEventEditor(current);djEventField(current.length-1,'name')?.focus();}};
    list.append(add);
  }
}
function initDjProfileEditor(profile) {
  djFeedback('');
  const photoHint=document.querySelector('#pg-dj-register .djr-photo-row p');if(photoHint)photoHint.textContent='JPG, PNG ou WebP · 5 Mo maximum · recadrage et zoom après sélection';
  const mixError=document.querySelector('#djr-editor [data-error="mixes"]'),mixHelp=mixError?.previousElementSibling,mixTitle=mixHelp?.previousElementSibling;
  if(mixTitle)mixTitle.textContent='Choisis ta plateforme *';
  if(mixHelp)mixHelp.textContent='Choisis SoundCloud, Mixcloud ou Spotify, puis colle le lien de ta playlist ou de ton mix. YouTube reste disponible pour une vidéo ou une playlist.';
  const soundcloudField=djField('soundcloud');if(soundcloudField)soundcloudField.placeholder='Lien de ta playlist ou de ton mix SoundCloud';
  const mixcloudField=djField('mixcloud');if(mixcloudField){mixcloudField.type='text';mixcloudField.placeholder='Lien ou code de ta playlist Mixcloud';}
  const spotifyField=djField('spotify');if(spotifyField)spotifyField.placeholder='Lien de ta playlist Spotify';
  document.querySelectorAll('#djr-editor [data-error]').forEach(e=>e.textContent='');
  document.querySelectorAll('#djr-editor [aria-invalid]').forEach(e=>e.removeAttribute('aria-invalid'));
  for(const key of [...Object.keys(DjProfileSchema.limits),...Object.keys(DjProfileSchema.links)]) {
    const field=djField(key);if(field) field.value=profile[key] || '';
  }
  const slugField=document.getElementById('dj-edit-slug'),stageField=djField('stage_name');
  if(slugField){
    slugField.value=profile.slug||normalizeDjSlug(profile.stage_name||'');slugField.dataset.auto=profile.slug?'false':'true';
    slugField.oninput=()=>{slugField.value=normalizeDjSlug(slugField.value);slugField.dataset.auto='false';updateDjPublicUrlPreview();checkDjSlugAvailability();};
  }
  if(stageField)stageField.oninput=()=>{if(slugField&&(slugField.dataset.auto==='true'||!slugField.value)){slugField.value=normalizeDjSlug(stageField.value);slugField.dataset.auto='true';updateDjPublicUrlPreview();checkDjSlugAvailability();}};
  const copyButton=document.getElementById('djr-copy-public-url');if(copyButton)copyButton.onclick=copyDjPublicUrl;
  updateDjPublicUrlPreview();checkDjSlugAvailability(0);
  const selected=(profile.genres||'').split(',').map(s=>s.trim()).filter(Boolean);
  const genres=document.getElementById('djr-genres');genres.replaceChildren();
  [...new Set([...DjProfileSchema.genres,...selected])].forEach(g=>djChoice(genres,g,selected.includes(g),'genres').addEventListener('change',djGenreState));
  document.getElementById('djr-genre-search').value='';
  document.getElementById('djr-genre-search').oninput=djGenreState;djGenreState();
  const services=document.getElementById('djr-services');services.replaceChildren();
  DjProfileSchema.services.forEach(s=>djChoice(services,s,(profile.service_types||[]).includes(s),'services'));
  renderDjEventEditor(profile.upcoming_events);
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
  renderDjPresskitPdf(profile.presskit_pdf_url || '');
  document.getElementById('djr-gallery-input').onchange=uploadDjGallery;
}
function collectDjProfile() {
  const input={};
  for(const key of [...Object.keys(DjProfileSchema.limits),...Object.keys(DjProfileSchema.links)]) input[key]=djField(key)?.value || '';
  input.genres=djSelected('genres');input.service_types=djSelected('services');
  input.cover_avatar=document.querySelector('#djr-editor input[name="cover"]:checked')?.value||null;
  input.upcoming_events=collectDjEvents();
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
async function uploadDjEventFlyer(input,index) {
  if(djMediaBusy)return;
  const file=input.files[0];input.value='';
  if(!file)return;
  if(!file.type.startsWith('image/')||file.size>5*1024*1024){djFeedback('Choisis un flyer image de moins de 5 Mo.');return;}
  setDjMediaBusy(true);djFeedback(`Envoi du flyer ${index+1}…`);
  try{
    const form=new FormData();form.append('photo',file);
    const response=await fetch('/api/dj/profile/event-flyer',{method:'POST',headers:{Authorization:'Bearer '+(_sbSession?.access_token||_authToken)},body:form});
    const result=await response.json();if(!response.ok)throw new Error(result.error||'Envoi impossible.');
    const field=djEventField(index,'flyer_url');if(field)field.value=result.url;
    const choose=document.querySelector(`label[for="dj-event-${index}-flyer-input"]`)?.parentElement?.querySelector('.djr-event-flyer-actions button');
    if(choose)choose.textContent='Changer le flyer';
    updateDjEventFlyerPreview(index,result.url);
    djFeedback('Flyer chargé. Pense à enregistrer ton profil.');
  }catch(e){djFeedback(e.message||'Le flyer n’a pas pu être envoyé.');}
  finally{setDjMediaBusy(false);}
}
function renderDjPresskitPdf(url) {
  const safe=DjProfileSchema.url(url),link=document.getElementById('djr-pdf-link'),remove=document.getElementById('djr-pdf-remove'),status=document.getElementById('djr-pdf-status');
  if(link){link.hidden=!safe;link.href=safe||'';}
  if(remove)remove.hidden=!safe;
  if(status)status.textContent=safe?'PDF chargé et visible sur la page DJ.':'Aucun PDF chargé pour le moment.';
}
async function uploadDjPresskitPdf(input) {
  if(djMediaBusy)return;
  const file=input.files[0];input.value='';
  if(!file)return;
  if(file.size>10*1024*1024||!(file.type==='application/pdf'||/\.pdf$/i.test(file.name))){djFeedback('Choisis un PDF de moins de 10 Mo.');return;}
  setDjMediaBusy(true);djFeedback('Envoi du press kit PDF…');
  try{
    const form=new FormData();form.append('pdf',file);
    const response=await fetch('/api/dj/profile/presskit-pdf',{method:'POST',headers:{Authorization:'Bearer '+(_sbSession?.access_token||_authToken)},body:form});
    const result=await response.json();if(!response.ok)throw new Error(result.error||'Envoi impossible.');
    _djProfileCache=_djProfileCache||{};_djProfileCache.presskit_pdf_url=result.url;
    renderDjPresskitPdf(result.url);applyDjProfileToPresskit();djFeedback('Press kit PDF chargé.');
  }catch(e){djFeedback(e.message||'Le PDF n’a pas pu être envoyé.');}
  finally{setDjMediaBusy(false);}
}
async function removeDjPresskitPdf() {
  if(djMediaBusy)return;
  setDjMediaBusy(true);djFeedback('Suppression du press kit PDF…');
  try{
    const response=await fetch('/api/dj/profile/presskit-pdf',{method:'DELETE',headers:{Authorization:'Bearer '+(_sbSession?.access_token||_authToken)}});
    const result=await response.json().catch(()=>({}));if(!response.ok)throw new Error(result.error||'Suppression impossible.');
    if(_djProfileCache)_djProfileCache.presskit_pdf_url='';
    renderDjPresskitPdf('');applyDjProfileToPresskit();djFeedback('Press kit PDF retiré.');
  }catch(e){djFeedback(e.message||'Le PDF n’a pas pu être retiré.');}
  finally{setDjMediaBusy(false);}
}
function renderDjProfileDetails(p) {
  const box=document.getElementById('pk-profile-details');if(!box)return;box.replaceChildren();
  function heading(s,title,kicker){const head=document.createElement('div'),label=document.createElement('span'),h=document.createElement('h2');head.className='pk3-section-heading';label.className='pk3-section-label';label.textContent=kicker;h.textContent=title;head.append(label,h);s.append(head);}
  function section(title,text,id,kicker){if(!text)return null;const s=document.createElement('section'),content=document.createElement('p');s.id=id;s.className='pk3-section';heading(s,title,kicker);content.textContent=text;s.append(content);box.append(s);return s;}
  function socialIcon(label){
    const brand=label.toLowerCase().replace(/\s+/g,'-'),wrap=document.createElement('span');wrap.className='pk-social-icon pk-social-icon-'+brand;
    if(label==='Resident Advisor'){wrap.textContent='RA';return wrap;}
    const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox','0 0 24 24');svg.setAttribute('aria-hidden','true');
    const paths={
      Instagram:['M7 2h10a5 5 0 0 1 5 5v10a5 5 0 0 1-5 5H7a5 5 0 0 1-5-5V7a5 5 0 0 1 5-5Z','M8.5 12a3.5 3.5 0 1 0 7 0 3.5 3.5 0 0 0-7 0Z','M17.5 6.5h.01'],
      TikTok:['M14 3v11.2a4.2 4.2 0 1 1-4.2-4.2c.35 0 .69.04 1.02.13V7.4a7 7 0 0 0 7 3.8V8.2A4.7 4.7 0 0 1 14 3Z'],
      'Site web':['M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Z','M2 12h20','M12 2c2.5 2.7 3.8 6 3.8 10S14.5 19.3 12 22c-2.5-2.7-3.8-6-3.8-10S9.5 4.7 12 2Z'],
      'Vidéo live':['M5 4.5v15l14-7.5-14-7.5Z'],
    }[label]||['M12 5v14M5 12h14'];
    paths.forEach(d=>{const path=document.createElementNS('http://www.w3.org/2000/svg','path');path.setAttribute('d',d);svg.append(path);});
    wrap.append(svg);return wrap;
  }
  function link(parent,label,value){const href=DjProfileSchema.url(value);if(!href)return;const a=document.createElement('a');a.href=href;a.target='_blank';a.rel='noopener noreferrer';a.title=label;a.setAttribute('aria-label',label);a.className='pk-social-link';a.append(socialIcon(label));parent.append(a);}
  function linksSection(title,entries,id,kicker){const links=document.createElement('div');links.className='pk-profile-links';entries.forEach(([label,value])=>link(links,label,value));if(!links.childNodes.length)return;const s=document.createElement('section');s.id=id;s.className='pk3-section';heading(s,title,kicker);s.append(links);box.append(s);}
  function embedUrl(platform,value){
    const hosts={soundcloud:['soundcloud.com'],mixcloud:['mixcloud.com'],youtube:['youtube.com','youtu.be'],spotify:['spotify.com']}[platform];
    const safe=DjProfileSchema.url(value,hosts);if(!safe)return '';
    const url=new URL(safe);
    if(platform==='soundcloud')return `https://w.soundcloud.com/player/?url=${encodeURIComponent(safe)}&color=%23ff2a93&auto_play=false&hide_related=true&show_comments=false&show_reposts=false`;
    if(platform==='mixcloud')return `https://player-widget.mixcloud.com/?hide_cover=1&mini=1&feed=${encodeURIComponent(url.pathname)}`;
    if(platform==='spotify'){
      const parts=url.pathname.split('/').filter(Boolean),offset=parts[0]?.startsWith('intl-')?1:0,type=parts[offset],id=parts[offset+1];
      if(!['artist','track','album','playlist','episode','show'].includes(type)||!id)return '';
      return `https://open.spotify.com/embed/${type}/${encodeURIComponent(id)}?utm_source=generator&theme=0`;
    }
    let videoId='';
    if(url.hostname==='youtu.be')videoId=url.pathname.split('/').filter(Boolean)[0]||'';
    else if(url.pathname==='/watch')videoId=url.searchParams.get('v')||'';
    else if(/^\/(shorts|live|embed)\//.test(url.pathname))videoId=url.pathname.split('/')[2]||'';
    if(/^[\w-]{6,}$/.test(videoId))return `https://www.youtube-nocookie.com/embed/${encodeURIComponent(videoId)}`;
    const playlistId=url.searchParams.get('list');
    return /^[\w-]{6,}$/.test(playlistId||'')?`https://www.youtube-nocookie.com/embed/videoseries?list=${encodeURIComponent(playlistId)}`:'';
  }
  // Charger un lecteur SoundCloud/Mixcloud/Spotify/YouTube établit une
  // connexion directe avec ce service (cookies/traceurs possibles) — on ne
  // crée donc l'iframe qu'après un clic explicite, jamais au chargement de
  // la page. Le choix est mémorisé pour la session en cours (par plateforme),
  // et réinitialisable depuis Paramètres → Confidentialité (cf. resetEmbedConsent()).
  function embedConsentKey(platform){return 'pullup_embed_ok_'+platform;}
  function hasEmbedConsent(platform){try{return sessionStorage.getItem(embedConsentKey(platform))==='1';}catch(e){return false;}}
  function grantEmbedConsent(platform){try{sessionStorage.setItem(embedConsentKey(platform),'1');}catch(e){}}
  function mountPlayer(player,label,platform,src){
    const frame=document.createElement('iframe');
    frame.src=src;frame.title=`Lecteur ${label}`;frame.loading='lazy';
    frame.allow='autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture';
    frame.referrerPolicy='strict-origin-when-cross-origin';frame.setAttribute('allowfullscreen','');
    player.replaceChildren();
    const head=document.createElement('div'),name=document.createElement('strong'),status=document.createElement('span');
    head.className='pk-profile-player-head';name.textContent=label;status.textContent='Lecture intégrée';head.append(name,status);
    player.append(head,frame);
  }
  function playersSection(entries){
    const players=document.createElement('div');players.className='pk-profile-players';
    entries.forEach(([label,platform,value])=>{
      const src=embedUrl(platform,value);if(!src)return;
      const player=document.createElement('div');player.className='pk-profile-player';player.dataset.platform=platform;
      if(hasEmbedConsent(platform)){mountPlayer(player,label,platform,src);}
      else{
        const gate=document.createElement('div');gate.className='pk-profile-player-gate';
        const text=document.createElement('p');text.textContent=`Ce contenu est fourni par ${label}. En l’affichant, vous acceptez qu’une connexion soit établie avec ${label}.`;
        const btn=document.createElement('button');btn.type='button';btn.textContent='Afficher le lecteur';
        btn.onclick=()=>{grantEmbedConsent(platform);mountPlayer(player,label,platform,src);};
        gate.append(text,btn);player.append(gate);
      }
      players.append(player);
    });
    if(!players.childNodes.length)return;const s=document.createElement('section');s.id='pk-music';s.className='pk3-section';heading(s,'Écouter','02 / SÉLECTION');s.append(players);box.append(s);
  }
  function formatEventDate(value){
    if(!/^\d{4}-\d{2}-\d{2}$/.test(value||''))return value||'';
    const [year,month,day]=value.split('-').map(Number);
    return new Intl.DateTimeFormat('fr-FR',{weekday:'long',day:'numeric',month:'long',year:'numeric'}).format(new Date(year,month-1,day));
  }
  function eventsSection(events){
    const safe=(Array.isArray(events)?events:[]).filter(event=>event && Object.keys(DjProfileSchema.eventLimits).some(key=>typeof event[key]==='string'&&event[key].trim())).slice(0,4);
    if(!safe.length)return;
    const s=document.createElement('section'),grid=document.createElement('div');s.id='pk-upcoming-events';s.className='pk3-section';grid.className='pk-profile-events';
    heading(s,'Soirées à venir','03 / DATES');
    safe.forEach(event=>{
      const href=DjProfileSchema.url(event.link_url),flyer=DjProfileSchema.url(event.flyer_url);
      const card=document.createElement(href?'a':'article'),visual=document.createElement('span'),info=document.createElement('span'),date=document.createElement('span'),name=document.createElement('strong'),place=document.createElement('span'),address=document.createElement('span'),cta=document.createElement('span');
      card.className='pk-profile-event';if(href){card.href=href;card.target='_blank';card.rel='noopener noreferrer';}
      visual.className='pk-profile-event-flyer';
      if(flyer)visual.style.backgroundImage=`url(${JSON.stringify(flyer)})`;
      else visual.textContent='Soirée à venir';
      info.className='pk-profile-event-info';date.className='pk-profile-event-date';place.className='pk-profile-event-place';address.className='pk-profile-event-address';cta.className='pk-profile-event-cta';
      date.textContent=formatEventDate(event.date);name.textContent=event.name||'Soirée à venir';place.textContent=event.place||'';address.textContent=event.address||'';cta.textContent='Voir la soirée';
      if(event.date)info.append(date);info.append(name);if(event.place)info.append(place);if(event.address)info.append(address);if(href)info.append(cta);card.append(visual,info);grid.append(card);
    });
    s.append(grid);box.append(s);
  }
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
  eventsSection(p.upcoming_events);
  playersSection([['SoundCloud','soundcloud',p.soundcloud],['Mixcloud','mixcloud',p.mixcloud],['YouTube','youtube',p.youtube],['Spotify','spotify',p.spotify]]);
  section('Résidences & collaborations',p.experience,'pk-experience','04 / PARCOURS');
  if(p.gallery?.length){const gallery=document.createElement('section'),grid=document.createElement('div');gallery.id='pk-gallery';gallery.className='pk3-section pk3-gallery-section';heading(gallery,'Photos','05 / GALERIE');grid.className='pk-profile-gallery';p.gallery.forEach((url,i)=>{const photo=document.createElement('div'),img=document.createElement('img');photo.className='pk-profile-photo';img.src=url;img.alt=`${p.stage_name} — photo ${i+1}`;img.loading='lazy';photo.append(img);grid.append(photo);});gallery.append(grid);box.append(gallery);}
  linksSection('Réseaux',[['Instagram',p.instagram],['TikTok',p.tiktok],['Site web',p.website],['Resident Advisor',p.resident_advisor],['Vidéo live',p.video_url]],'pk-links','06 / CONTACT');
  renderDjPublicShareTools(p,box);
  const area=document.getElementById('pk-travel-areas');if(area)area.textContent=p.travel_areas||'Zones de déplacement à confirmer';
  const email=document.getElementById('pk-booking-email');if(email)email.textContent=p.booking_email||'Non renseigné';
  const phone=document.getElementById('pk-booking-phone');if(phone){phone.hidden=!p.phone;phone.textContent=p.phone?`WhatsApp / téléphone · ${p.phone}`:'';phone.href=p.phone?'tel:'+p.phone.replace(/[^+\d]/g,''):'';}
  const pdf=document.getElementById('pk-presskit-pdf');if(pdf){const href=DjProfileSchema.url(p.presskit_pdf_url);pdf.hidden=!href;pdf.href=href||'';}
}

function renderDjPublicShareTools(profile,parent){
  const slug=normalizeDjSlug(profile?.slug),url=slug?`${location.origin}/${encodeURIComponent(slug)}`:'';
  if(!parent||!url)return;
  const section=document.createElement('section'),copy=document.createElement('div'),label=document.createElement('span'),link=document.createElement('a'),qr=document.createElement('div'),actions=document.createElement('div'),copyButton=document.createElement('button'),shareButton=document.createElement('button'),downloadButton=document.createElement('button');
  section.id='pk-public-share';section.className='pk3-public-share';section.setAttribute('aria-label','Partager cette page DJ');
  copy.className='pk3-public-share-copy';label.textContent='07 / PARTAGE';link.id='pk-public-url';link.target='_blank';link.rel='noopener noreferrer';
  qr.id='pk-public-qr';qr.className='pk3-public-qr';qr.setAttribute('aria-hidden','true');
  actions.className='pk3-public-share-actions';
  copyButton.type='button';copyButton.textContent='Copier le lien';copyButton.onclick=copyDjProfilePublicLink;
  shareButton.type='button';shareButton.textContent='Partager';shareButton.onclick=shareDjProfile;
  downloadButton.type='button';downloadButton.textContent='Télécharger le QR';downloadButton.onclick=downloadDjProfileQr;
  actions.append(copyButton,shareButton,downloadButton);copy.append(label,link);section.append(copy,qr,actions);parent.append(section);
  link.href=url;link.textContent=`pull-up.live/${slug}`;section.dataset.url=url;section.dataset.slug=slug;
  if(typeof QRCode==='function'){
    new QRCode(qr,{text:url,width:512,height:512,colorDark:'#09070b',colorLight:'#ffffff',correctLevel:QRCode.CorrectLevel.H});
    const logo=document.createElement('img');logo.id='pk-public-qr-logo';logo.className='pk3-public-qr-logo';logo.src='/images/logo.png';logo.alt='';qr.append(logo);
  }
}

async function copyDjProfilePublicLink(){
  const url=document.getElementById('pk-public-share')?.dataset.url;if(!url)return;
  try{await navigator.clipboard.writeText(url);if(typeof toast==='function')toast('Lien du profil copié');}
  catch(e){
    const input=document.createElement('input');input.value=url;input.style.position='fixed';input.style.opacity='0';document.body.append(input);input.select();document.execCommand('copy');input.remove();if(typeof toast==='function')toast('Lien du profil copié');
  }
}

async function downloadDjProfileQr(){
  const section=document.getElementById('pk-public-share'),qr=document.getElementById('pk-public-qr'),source=qr?.querySelector('canvas,img:not(.pk3-public-qr-logo)'),logo=document.getElementById('pk-public-qr-logo');
  if(!section?.dataset.url||!source){if(typeof toast==='function')toast('QR code indisponible.');return;}
  if(logo&&!logo.complete)await new Promise(resolve=>{logo.onload=logo.onerror=resolve;});
  const size=Math.max(512,source.width||source.naturalWidth||512),output=document.createElement('canvas'),ctx=output.getContext('2d');output.width=size;output.height=size;
  ctx.imageSmoothingEnabled=false;ctx.drawImage(source,0,0,size,size);
  if(logo?.naturalWidth){
    const pad=Math.round(size*.21),mark=Math.round(size*.17),x=Math.round((size-pad)/2),y=x;
    ctx.fillStyle='#fff';ctx.fillRect(x,y,pad,pad);ctx.imageSmoothingEnabled=true;ctx.drawImage(logo,(size-mark)/2,(size-mark)/2,mark,mark);
  }
  const href=output.toDataURL('image/png');
  const download=document.createElement('a');download.href=href;download.download=`qr-${section.dataset.slug||'profil-dj'}-pull-up.png`;document.body.append(download);download.click();download.remove();
  if(typeof toast==='function')toast('QR code téléchargé');
}

let _djProfileBackTo=null;
async function openPublicDjProfile(id) {
  if(!id)return false;
  try{const profile=await api('GET','/dj/profile/'+encodeURIComponent(id));djViewedProfileId=id;_djProfileCache=profile;showPage('presskit');return true;}
  catch(e){return false;}
}
// Bannière DJ de la page vote : ouvre le profil du DJ réellement au line-up
// de CETTE soirée, jamais celui déjà en cache (ex. son propre profil si
// l'utilisateur est aussi un DJ inscrit) — sans ce fetch dédié, navTo('presskit')
// réaffichait le profil déjà en mémoire plutôt que celui de la soirée.
// Avec plusieurs DJs au line-up, la bannière n'en montre qu'un (le premier) —
// le clic propose donc de choisir lequel consulter plutôt que d'ouvrir
// silencieusement toujours le même.
async function openDjBannerProfile() {
  closeTopMenu(); // au cas où l'appel vienne du bouton "DJ's" du menu déroulant
  const clickable = _currentLineup.filter(dj => (dj.type === 'app' && dj.id) || (dj.type === 'external' && dj.soundcloud_url));
  // Rien à montrer (pas de soirée en cours, ou line-up vide) — "DJ's" reste
  // utile et propose de gérer son propre profil plutôt que de ne rien faire.
  if (!clickable.length) { await openDjRegister(); return; }
  const backTo = eid ? 'client' : (currentUser ? 'profile' : 'auth');
  if (clickable.length === 1) { await _openLineupDj(clickable[0], backTo); return; }
  _renderDjLineupGrid(clickable);
  showPage('dj-lineup');
}
async function _openLineupDj(dj, backTo) {
  if (dj.type === 'app' && dj.id) { _djProfileBackTo = backTo; await openPublicDjProfile(dj.id); return; }
  if (dj.type === 'external' && dj.soundcloud_url) window.open(dj.soundcloud_url, '_blank', 'noopener,noreferrer');
}
function _renderDjLineupGrid(list) {
  const grid = document.getElementById('dj-lineup-grid'); if (!grid) return;
  grid.replaceChildren();
  list.forEach(dj => {
    const img = dj.cover_avatar ? `/images/dj-avatars/avatar-${String(dj.cover_avatar).padStart(2,'0')}-pullup.png` : (dj.photo_url || '/images/dj-avatar.webp?v=2');
    const card = document.createElement('button');
    card.type = 'button'; card.className = 'dj-lineup-card';
    card.style.backgroundImage = `url('${img}')`;
    card.onclick = () => _openLineupDj(dj, 'dj-lineup');
    const name = document.createElement('span');
    name.className = 'dj-lineup-card-name'; name.textContent = dj.name;
    card.append(name);
    grid.append(card);
  });
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
function djProfileBack(){
  if(_djProfileBackTo){const p=_djProfileBackTo;_djProfileBackTo=null;showPage(p);return;}
  if(djViewedProfileId){if(document.referrer.startsWith(location.origin))history.back();else location.href='/';return;}
  showPage(eid?'client':(currentUser?'profile':'auth'));
}
