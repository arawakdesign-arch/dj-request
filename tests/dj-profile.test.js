const {test}=require('node:test');
const assert=require('node:assert/strict');
const schema=require('../public/js/dj-profile-schema');
const valid={stage_name:'DJ Nova',tagline:'House et afro house',bio:'DJ à Paris.',genres:['House','Afrobeats'],service_types:['Club'],soundcloud:'https://soundcloud.com/nova',booking_email:'booking@example.com'};
test('complete profile normalizes and accepts optional empty fields',()=>{
 const {value,errors}=schema.validate(valid,'photo.jpg');assert.deepEqual(errors,{});assert.equal(value.genres,'House, Afrobeats');assert.equal(value.cover_avatar,null);
});
test('every mandatory field is enforced, including stored portrait and at least one mix',()=>{
 const {errors}=schema.validate({},null);
 for(const key of ['stage_name','tagline','bio','genres','service_types','booking_email','photo_url','mixes']) assert.ok(errors[key],key);
});
test('six genres accepted, seven rejected, duplicates normalized',()=>{
 assert.equal(schema.validate({...valid,genres:schema.genres.slice(0,6)},'photo').errors.genres,undefined);
 assert.ok(schema.validate({...valid,genres:schema.genres.slice(0,7)},'photo').errors.genres);
 assert.equal(schema.validate({...valid,genres:['House','House']},'photo').value.genres,'House');
});
test('tagline length 150 is accepted, 151 rejected; long biography supported',()=>{
 assert.equal(schema.validate({...valid,tagline:'a'.repeat(150),bio:'b'.repeat(4000)},'photo').errors.tagline,undefined);
 assert.ok(schema.validate({...valid,tagline:'a'.repeat(151)},'photo').errors.tagline);
});
test('URLs reject scripts, credentials, and spoofed platform domains',()=>{
 for(const url of ['javascript:alert(1)','https://soundcloud.com.evil.test/mix','https://evil.test/?soundcloud.com','https://u:p@soundcloud.com/mix']) assert.ok(schema.validate({...valid,soundcloud:url},'photo').errors.soundcloud,url);
 assert.equal(schema.url('javascript:alert(1)'),null);
 assert.equal(schema.url('soundcloud.com/nova',['soundcloud.com']),'https://soundcloud.com/nova');
});
test('Spotify alone meets the music link requirement',()=>assert.equal(schema.validate({...valid,soundcloud:'',spotify:'https://open.spotify.com/artist/abc'},'photo').errors.mixes,undefined));
test('Mixcloud player shortcodes are reduced to their playable URL',()=>{
 const shortcode='[mixcloud https://www.mixcloud.com/emilio-lameynardie/afro-vs-shatta-dj-paul-keranne-hustle-and-flow/ width=100% height=120 hide_cover=1 autoplay=1]';
 const {value,errors}=schema.validate({...valid,soundcloud:'',mixcloud:shortcode},'photo');assert.equal(errors.mixcloud,undefined);assert.equal(value.mixcloud,'https://www.mixcloud.com/emilio-lameynardie/afro-vs-shatta-dj-paul-keranne-hustle-and-flow/');
});
test('invalid types cannot crash validation',()=>{
 const {errors}=schema.validate({...valid,stage_name:{},soundcloud:[],genres:[{}],service_types:[{}]},'photo');assert.ok(errors.stage_name);assert.ok(errors.soundcloud);assert.ok(errors.genres);assert.ok(errors.service_types);
});
test('city is neither required nor included in saved profiles',()=>{
 const {value,errors}=schema.validate({...valid,city:'Paris, France'},'photo');assert.equal(errors.city,undefined);assert.equal('city' in value,false);
});
test('cover selection is constrained to generated catalog',()=>{
 for(const cover_avatar of [-1,0,21,1.5,'oops'])assert.ok(schema.validate({...valid,cover_avatar},'photo').errors.cover_avatar);
 for(let cover_avatar=1;cover_avatar<=20;cover_avatar++)assert.equal(schema.validate({...valid,cover_avatar},'photo').errors.cover_avatar,undefined);
});
test('upcoming DJ events are normalized and limited to four cards',()=>{
 const event={flyer_url:'example.com/flyer.jpg',date:'2026-10-18',name:'Hustle & Flow',place:'Le Balajo',address:'9 Rue de Lappe, 75011 Paris',link_url:'example.com/event'};
 const {value,errors}=schema.validate({...valid,upcoming_events:[event,event,event,event]},'photo');
 assert.equal(errors.upcoming_events,undefined);
 assert.equal(value.upcoming_events.length,4);
 assert.equal(value.upcoming_events[0].flyer_url,'https://example.com/flyer.jpg');
 assert.equal(value.upcoming_events[0].link_url,'https://example.com/event');
 assert.ok(schema.validate({...valid,upcoming_events:[{...event,link_url:'javascript:alert(1)'}]},'photo').errors.upcoming_events);
 assert.ok(schema.validate({...valid,upcoming_events:[{...event,date:'Vendredi 18 octobre'}]},'photo').errors.upcoming_events);
 assert.ok(schema.validate({...valid,upcoming_events:[event,event,event,event,event]},'photo').errors.upcoming_events);
 assert.deepEqual(schema.validate({...valid,upcoming_events:[{name:'Une soirée'},{}]},'photo').errors,{});
 assert.equal(schema.validate({...valid,upcoming_events:[{name:'Une soirée'},{}]},'photo').value.upcoming_events.length,1);
 assert.equal(schema.validate({...valid,upcoming_events:[{...event,flyer_url:''}]},'photo').errors.upcoming_events,undefined);
});

test('career locations are normalized, geolocated and limited to eight cards',()=>{
 const location={type:'Résidence',name:'La Bellevilloise',address:'19-21 Rue Boyer',city:'Paris',country:'France',period:'Depuis 2024',lat:'48.8682',lng:'2.3925'};
 const {value,errors}=schema.validate({...valid,career_locations:[location,{}]},'photo');
 assert.equal(errors.career_locations,undefined);assert.equal(value.career_locations.length,1);assert.equal(value.career_locations[0].lat,48.8682);assert.equal(value.career_locations[0].lng,2.3925);
 assert.ok(schema.validate({...valid,career_locations:Array(9).fill(location)},'photo').errors.career_locations);
 assert.ok(schema.validate({...valid,career_locations:[{...location,type:'Plan secret'}]},'photo').errors.career_locations);
 assert.ok(schema.validate({...valid,career_locations:[{...location,lat:120}]},'photo').errors.career_locations);
 assert.deepEqual(schema.validate({...valid,career_locations:[{name:'Collectif Nova'}]},'photo').errors,{});
});

test('API enforces stored photo and uploaded gallery ownership',async()=>{
 const express=require('express');
 const uploadedFlyer='https://storage.example/profile-photos/dj/test-user/event-flyer-abc.jpg';
 let stored={photo_url:'https://storage.example/avatar.jpg',gallery:['https://storage.example/owned.jpg']};
 let saved=null;
 const db={from:()=>({select:()=>({eq:()=>({maybeSingle:async()=>({data:stored,error:null})})}),upsert:value=>{saved=value;return {select:()=>({single:async()=>({data:value,error:null})})};}}),storage:{from:()=>({getPublicUrl:path=>({data:{publicUrl:'https://storage.example/profile-photos/'+path}})})}};
 for(const [path,exports] of [['../lib/supabase',db],['../middleware/auth',{requireAuth:(req,res,next)=>{req.user={id:'test-user'};next();}}],['../routes/events',{isClosed:()=>false,isUpcoming:()=>false}]]){
  require.cache[require.resolve(path)]={id:require.resolve(path),filename:require.resolve(path),loaded:true,exports};
 }
 const router=require('../routes/dj');
 const layer=router.stack.find(l=>l.route?.path==='/dj/profile'&&l.route.methods.post);
 const handler=layer.route.stack.at(-1).handle;
 const request=async body=>{let status=200,payload;const res={status(code){status=code;return this;},json(value){payload=value;return this;}};await handler({body,user:{id:'test-user'}},res);return {status,payload};};
 let result=await request({...valid,gallery:['https://storage.example/other-account.jpg']});assert.equal(result.status,400);
 result=await request({...valid,gallery:['https://storage.example/owned.jpg'],upcoming_events:[{flyer_url:'https://example.com/flyer.jpg',date:'2026-10-18',name:'Hustle & Flow',place:'Le Balajo',address:'9 Rue de Lappe, 75011 Paris',link_url:'https://example.com/event'}]});assert.equal(result.status,400);assert.ok(result.payload.fields.upcoming_events);
 result=await request({...valid,upcoming_events:[{name:'Une soirée'}]});assert.equal(result.status,200);assert.equal(saved.upcoming_events[0].name,'Une soirée');
 result=await request({...valid,gallery:['https://storage.example/owned.jpg'],upcoming_events:[{flyer_url:uploadedFlyer,date:'2026-10-18',name:'Hustle & Flow',place:'Le Balajo',address:'9 Rue de Lappe, 75011 Paris',link_url:'https://example.com/event'}]});assert.equal(result.status,200);assert.equal(saved.id,'test-user');assert.equal(saved.tagline,valid.tagline);assert.equal(saved.upcoming_events[0].name,'Hustle & Flow');
 stored={gallery:[]};result=await request(valid);assert.equal(result.status,400);assert.ok(result.payload.fields.photo_url);
 result=await request({...valid,photo_url:'https://evil.example/pretend.jpg'});assert.equal(result.status,400);assert.ok(result.payload.fields.photo_url);
});

test('DJ public-link availability accepts the current owner and rejects existing DJ or organizer links',async()=>{
 const profiles={mine:{id:'test-user'},taken:{id:'another-user'}},organizers={club:{owner_id:'organizer-user'}};
 const db={from:table=>({select:()=>({eq:(column,slug)=>({maybeSingle:async()=>({data:table==='dj_profiles'?(profiles[slug]||null):(organizers[slug]||null),error:null})})})}),storage:{from:()=>({})}};
 for(const [path,exports] of [['../lib/supabase',db],['../middleware/auth',{requireAuth:(req,res,next)=>{req.user={id:'test-user'};next();}}],['../routes/events',{isClosed:()=>false,isUpcoming:()=>false}]]){
  require.cache[require.resolve(path)]={id:require.resolve(path),filename:require.resolve(path),loaded:true,exports};
 }
 delete require.cache[require.resolve('../routes/dj')];
 const router=require('../routes/dj');
 const handler=router.stack.find(l=>l.route?.path==='/dj/slug-availability/:slug').route.stack.at(-1).handle;
 const request=async slug=>{let status=200,payload;const res={status(code){status=code;return this;},json(value){payload=value;return this;}};await handler({params:{slug},user:{id:'test-user'}},res);return {status,payload};};
 assert.equal((await request('libre')).payload.available,true);
 assert.equal((await request('mine')).payload.available,true);
 assert.equal((await request('taken')).payload.available,false);
 assert.equal((await request('club')).payload.available,false);
 assert.equal((await request('DJ invalide')).status,400);
});

test('API keeps saving basic DJ profiles when upcoming events migration is missing',async()=>{
 let upsertCalls=0,saved=null;
 const missing={code:'42703',message:'column "upcoming_events" does not exist'};
 const db={from:()=>({
  select:()=>({eq:()=>({maybeSingle:async()=>({data:{photo_url:'photo.jpg',gallery:[]},error:null})})}),
  upsert:value=>{upsertCalls++;saved=value;return {select:()=>({single:async()=>upsertCalls===1?{data:null,error:missing}:{data:value,error:null}})};},
 }),storage:{from:()=>({getPublicUrl:path=>({data:{publicUrl:'https://storage.example/profile-photos/'+path}})})}};
 for(const [path,exports] of [['../lib/supabase',db],['../middleware/auth',{requireAuth:(req,res,next)=>{req.user={id:'test-user'};next();}}],['../routes/events',{isClosed:()=>false,isUpcoming:()=>false}]]){
  require.cache[require.resolve(path)]={id:require.resolve(path),filename:require.resolve(path),loaded:true,exports};
 }
 delete require.cache[require.resolve('../routes/dj')];
 const router=require('../routes/dj');
 const handler=router.stack.find(l=>l.route?.path==='/dj/profile'&&l.route.methods.post).route.stack.at(-1).handle;
 const request=async body=>{let status=200,payload;const res={status(code){status=code;return this;},json(value){payload=value;return this;}};await handler({body,user:{id:'test-user'}},res);return {status,payload};};
 let result=await request(valid);assert.equal(result.status,200);assert.equal(upsertCalls,2);assert.equal('upcoming_events' in saved,false);
 upsertCalls=0;
 result=await request({...valid,upcoming_events:[{flyer_url:'https://storage.example/profile-photos/dj/test-user/event-flyer-abc.jpg',date:'2026-10-18',name:'Hustle & Flow',place:'Le Balajo',address:'9 Rue de Lappe, 75011 Paris',link_url:'https://example.com/event'}]});
 assert.equal(result.status,500);assert.match(result.payload.error,/Migration Supabase manquante/);
});

test('API explains the career locations migration and preserves basic profile saves',async()=>{
 let upsertCalls=0,saved=null;
 const missing={code:'42703',message:'column "career_locations" does not exist'};
 const db={from:()=>({
  select:()=>({eq:()=>({maybeSingle:async()=>({data:{photo_url:'photo.jpg',gallery:[]},error:null})})}),
  upsert:value=>{upsertCalls++;saved=value;return {select:()=>({single:async()=>upsertCalls===1?{data:null,error:missing}:{data:value,error:null}})};},
 }),storage:{from:()=>({getPublicUrl:path=>({data:{publicUrl:'https://storage.example/profile-photos/'+path}})})}};
 for(const [path,exports] of [['../lib/supabase',db],['../middleware/auth',{requireAuth:(req,res,next)=>{req.user={id:'test-user'};next();}}],['../routes/events',{isClosed:()=>false,isUpcoming:()=>false}]]){
  require.cache[require.resolve(path)]={id:require.resolve(path),filename:require.resolve(path),loaded:true,exports};
 }
 delete require.cache[require.resolve('../routes/dj')];
 const router=require('../routes/dj');
 const handler=router.stack.find(l=>l.route?.path==='/dj/profile'&&l.route.methods.post).route.stack.at(-1).handle;
 const request=async body=>{let status=200,payload;const res={status(code){status=code;return this;},json(value){payload=value;return this;}};await handler({body,user:{id:'test-user'}},res);return {status,payload};};
 let result=await request(valid);assert.equal(result.status,200);assert.equal(upsertCalls,2);assert.equal('career_locations' in saved,false);
 upsertCalls=0;
 result=await request({...valid,career_locations:[{type:'Club',name:'Le Balajo',address:'9 Rue de Lappe',city:'Paris',country:'France',lat:48.853,lng:2.374}]});
 assert.equal(result.status,500);assert.match(result.payload.error,/migration-add-dj-career-locations/);
});

test('press kit PDF upload still succeeds while the optional database column is missing',async()=>{
 let saved=null,columnError=null;
 const db={
  from:()=>({upsert:async value=>{saved=value;return {error:columnError};}}),
  storage:{from:()=>({upload:async()=>({error:null}),getPublicUrl:path=>({data:{publicUrl:'https://storage.example/profile-photos/'+path}})})},
 };
 for(const [path,exports] of [['../lib/supabase',db],['../middleware/auth',{requireAuth:(req,res,next)=>{req.user={id:'test-user'};next();}}],['../routes/events',{isClosed:()=>false,isUpcoming:()=>false}]]){
  require.cache[require.resolve(path)]={id:require.resolve(path),filename:require.resolve(path),loaded:true,exports};
 }
 delete require.cache[require.resolve('../routes/dj')];
 const router=require('../routes/dj');
 const handler=router.stack.find(layer=>layer.route?.path==='/dj/profile/presskit-pdf'&&layer.route.methods.post).route.stack.at(-1).handle;
 const request=async()=>{let status=200,payload;const res={status(code){status=code;return this;},json(value){payload=value;return this;}};await handler({file:{buffer:Buffer.from('%PDF-1.4 test'),mimetype:'application/pdf',originalname:'press-kit.pdf'},user:{id:'test-user'}},res);return {status,payload};};
 let result=await request();assert.equal(result.status,200);assert.match(result.payload.url,/presskit\.pdf\?v=\d+$/);assert.match(saved.presskit_pdf_url,/presskit\.pdf/);
 columnError={code:'PGRST204',message:"Could not find the 'presskit_pdf_url' column of 'dj_profiles' in the schema cache"};
 result=await request();assert.equal(result.status,200);assert.equal(result.payload.storage_only,true);assert.match(result.payload.url,/presskit\.pdf/);
});

test('automatic press kit generation stores the generated PDF and its public URL',async()=>{
 let uploaded=null,saved=null;
 const profile={id:'test-user',slug:'dj-test',stage_name:'DJ Test',bio:'Biographie',photo_url:'https://storage.example/profile-photos/dj/test-user/avatar.jpg'};
 const db={
  from:()=>({select:()=>({eq:()=>({maybeSingle:async()=>({data:profile,error:null})})}),update:value=>({eq:async()=>{saved=value;return {error:null};}})}),
  storage:{from:()=>({getPublicUrl:path=>({data:{publicUrl:'https://storage.example/profile-photos/'+path}}),upload:async(path,buffer)=>{uploaded={path,buffer};return {error:null};}})},
 };
 const generated=Buffer.from('%PDF-1.4 generated press kit');
 for(const [path,exports] of [
  ['../lib/supabase',db],
  ['../middleware/auth',{requireAuth:(req,res,next)=>{req.user={id:'test-user'};next();}}],
  ['../routes/events',{isClosed:()=>false,isUpcoming:()=>false}],
  ['../lib/dj-presskit-pdf',{loadDjPresskitAssets:async()=>({}),generateDjPresskitPdf:async()=>generated}],
 ]) require.cache[require.resolve(path)]={id:require.resolve(path),filename:require.resolve(path),loaded:true,exports};
 delete require.cache[require.resolve('../routes/dj')];
 const router=require('../routes/dj');
 const handler=router.stack.find(layer=>layer.route?.path==='/dj/profile/presskit-pdf/generate').route.stack.at(-1).handle;
 let status=200,payload;const res={status(code){status=code;return this;},json(value){payload=value;return this;}};
 await handler({user:{id:'test-user'}},res);
 assert.equal(status,200);assert.equal(payload.generated,true);assert.match(payload.url,/presskit\.pdf\?v=\d+$/);
 assert.equal(uploaded.path,'dj/test-user/presskit.pdf');assert.equal(uploaded.buffer,generated);assert.match(saved.presskit_pdf_url,/presskit\.pdf/);
 delete require.cache[require.resolve('../lib/dj-presskit-pdf')];
});

test('public press kit PDF supports inline previews and forced downloads',async()=>{
 const prefix='https://storage.example/profile-photos/dj/test-user/presskit.pdf';
 let profile={stage_name:'DJ Étoile',presskit_pdf_url:prefix+'?v=123'},downloadCalls=0,recovered=null,schemaMissing=false;
 const db={
  from:()=>({select:fields=>({eq:()=>({maybeSingle:async()=>schemaMissing&&fields.includes('presskit_pdf_url')?{data:null,error:{code:'PGRST204',message:"Could not find the 'presskit_pdf_url' column of 'dj_profiles' in the schema cache"}}:{data:profile,error:null}})}),update:value=>({eq:async()=>{recovered=value;return {error:null};}})}),
  storage:{from:()=>({getPublicUrl:()=>({data:{publicUrl:prefix}}),download:async()=>{downloadCalls++;return {data:{arrayBuffer:async()=>Buffer.from('%PDF-1.4 public test')},error:null};}})},
 };
 for(const [path,exports] of [['../lib/supabase',db],['../middleware/auth',{requireAuth:(req,res,next)=>next()}],['../routes/events',{isClosed:()=>false,isUpcoming:()=>false}]]){
  require.cache[require.resolve(path)]={id:require.resolve(path),filename:require.resolve(path),loaded:true,exports};
 }
 delete require.cache[require.resolve('../routes/dj')];
 const router=require('../routes/dj');
 const handler=router.stack.find(layer=>layer.route?.path==='/dj/profile/:id/presskit-pdf/download').route.stack.at(-1).handle;
 const request=async(preview=false)=>{let status=200,payload,body;const headers={};const res={status(code){status=code;return this;},json(value){payload=value;return this;},setHeader(key,value){headers[key]=value;},send(value){body=value;return this;}};await handler({params:{id:'test-user'},query:preview?{preview:'1'}:{}},res);return {status,payload,body,headers};};
 let result=await request();assert.equal(result.status,200);assert.equal(result.headers['Content-Type'],'application/pdf');assert.equal(result.headers['Content-Disposition'],'attachment; filename="press-kit-dj-etoile.pdf"');assert.ok(Buffer.isBuffer(result.body));assert.equal(downloadCalls,1);
 result=await request(true);assert.equal(result.status,200);assert.equal(result.headers['Content-Disposition'],'inline; filename="press-kit-dj-etoile.pdf"');assert.equal(downloadCalls,2);
 profile={stage_name:'DJ Étoile',presskit_pdf_url:'https://evil.example/presskit.pdf'};result=await request();assert.equal(result.status,404);assert.equal(downloadCalls,2);
 profile={stage_name:'DJ Étoile',presskit_pdf_url:null};result=await request();assert.equal(result.status,200);assert.equal(downloadCalls,3);assert.match(recovered.presskit_pdf_url,/presskit\.pdf\?v=\d+$/);
 schemaMissing=true;recovered=null;result=await request();assert.equal(result.status,200);assert.equal(downloadCalls,4);assert.equal(recovered,null);
});
