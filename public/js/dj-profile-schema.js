/* Shared browser/server contract for DJ profiles. */
(function(root) {
  'use strict';
  const genres = ['Shatta','Afrobeats','Amapiano','Hip-hop','Zouk','House','Afro house','Dancehall','Reggae','Kompa','R&B','Soul','Funk','Disco','Techno','Électro','UK garage','Drum & bass','Baile funk','Latino','Pop','Généraliste'];
  const services = ['Club','Mariage','Festival','Événement privé','Corporate','Bar / restaurant','Radio'];
  const links = {
    soundcloud: ['SoundCloud',['soundcloud.com']], mixcloud: ['Mixcloud',['mixcloud.com']],
    youtube: ['YouTube',['youtube.com','youtu.be']], spotify: ['Spotify',['spotify.com']],
    instagram: ['Instagram',['instagram.com']], tiktok: ['TikTok',['tiktok.com']],
    resident_advisor: ['Resident Advisor',['ra.co']], website: ['Site web',null], video_url: ['Vidéo',null]
  };
  const limits = {stage_name:30,tagline:150,bio:5000,experience:2000,booking_email:254,phone:40,travel_areas:300};
  const eventLimits = {name:80,place:120,address:180,date:10,flyer_url:1000,link_url:1000};
  function url(value, hosts) {
    if (typeof value !== 'string') return null;
    value=value.trim();
    if (!value) return '';
    const embedded=value.match(/https?:\/\/[^\s\]\)]+/i);
    if(embedded)value=embedded[0];
    if (!/^https?:\/\//i.test(value)) value='https://'+value;
    try {
      const u=new URL(value);
      if (!['http:','https:'].includes(u.protocol) || u.username || u.password || !u.hostname.includes('.') || value.length>1000) return null;
      if (hosts && !hosts.some(h=>u.hostname===h || u.hostname.endsWith('.'+h))) return null;
      return u.href;
    } catch { return null; }
  }
  function validate(input, photo) {
    const value={}, errors={};
    for (const [key,max] of Object.entries(limits)) {
      if (input[key] != null && typeof input[key] !== 'string') {errors[key]='Texte invalide.';continue;}
      value[key]=(input[key]||'').trim();
      if(value[key].length>max) errors[key]=`Maximum ${max} caractères.`;
    }
    for (const [key,label] of Object.entries({stage_name:'Le nom de scène',tagline:'La phrase d’accroche',bio:'La biographie',booking_email:'L’e-mail professionnel'})) {
      if(!value[key]) errors[key]=label+' est obligatoire.';
    }
    if(!photo) errors.photo_url='Ajoute une photo de profil.';
    if(value.booking_email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.booking_email)) errors.booking_email='Entre une adresse e-mail valide.';
    if(value.phone && !/^\+?[\d\s().-]{6,40}$/.test(value.phone)) errors.phone='Entre un numéro de téléphone valide.';
    const selected=Array.isArray(input.genres)?input.genres:typeof input.genres==='string'?input.genres.split(',').map(s=>s.trim()).filter(Boolean):[];
    value.genres=[...new Set(selected)];
    if(!value.genres.length || value.genres.length>6 || value.genres.some(g=>typeof g!=='string'||!g.trim()||g.length>40)) errors.genres='Choisis entre 1 et 6 styles musicaux.';
    value.genres=value.genres.join(', ');
    value.service_types=Array.isArray(input.service_types)?[...new Set(input.service_types)]:[];
    if(!value.service_types.length || value.service_types.some(s=>!services.includes(s))) errors.service_types='Choisis au moins un type de prestation.';
    for (const [key,[label,hosts]] of Object.entries(links)) {
      let raw=input[key]||'';
      if (key==='instagram' && typeof raw==='string' && raw.startsWith('@')) raw='https://www.instagram.com/'+raw.slice(1);
      const normalized=url(raw,hosts);
      if(normalized===null) errors[key]=`Lien ${label} invalide (http ou https).`;
      else value[key]=normalized;
    }
    if(!['soundcloud','mixcloud','youtube','spotify'].some(k=>value[k])) errors.mixes='Ajoute au moins un lien SoundCloud, Mixcloud, YouTube ou Spotify.';
    value.cover_avatar=input.cover_avatar==null||input.cover_avatar===''?null:Number(input.cover_avatar);
    if(value.cover_avatar!==null && (!Number.isInteger(value.cover_avatar)||value.cover_avatar<1||value.cover_avatar>20)) errors.cover_avatar='Choisis un avatar parmi les 20 proposés.';
    value.upcoming_events=[];
    const rawEvents=Array.isArray(input.upcoming_events)?input.upcoming_events:[];
    rawEvents.forEach((event,index)=>{
      if(!event || typeof event!=='object')return;
      const normalized={};
      for(const [key,max] of Object.entries(eventLimits)){
        const raw=typeof event[key]==='string'?event[key].trim():'';
        if(raw.length>max) errors.upcoming_events=`La soirée ${index+1} contient un champ trop long.`;
        normalized[key]=raw;
      }
      const hasAny=Object.values(normalized).some(Boolean);
      if(!hasAny)return;

      if(normalized.date && !/^\d{4}-\d{2}-\d{2}$/.test(normalized.date)) errors.upcoming_events='Choisis la date dans le calendrier.';
      const flyer=normalized.flyer_url?url(normalized.flyer_url):'';
      const link=url(normalized.link_url);
      if(flyer===null) errors.upcoming_events='Lien du flyer invalide.';
      if(link===null) errors.upcoming_events='Lien de redirection invalide.';
      value.upcoming_events.push({...normalized,flyer_url:flyer,link_url:link||''});
    });
    if(value.upcoming_events.length>4) errors.upcoming_events='Ajoute au maximum 4 soirées.';
    return {value,errors};
  }
  const schema={genres,services,links,limits,eventLimits,url,validate};
  if(typeof module==='object' && module.exports) module.exports=schema;
  else root.DjProfileSchema=schema;
})(typeof globalThis!=='undefined'?globalThis:this);
