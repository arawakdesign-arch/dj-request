// Run with PLAYWRIGHT_MODULE pointing to an installed Playwright package.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const path=require('node:path');
const express=require('express');
const assert=require('node:assert/strict');

(async()=>{
  const app=express();
  const root=path.resolve(__dirname,'../public');
  app.use(express.static(root));
  app.get('*',(req,res)=>res.sendFile(path.join(root,'index.html')));
  const server=app.listen(3108,'127.0.0.1');
  let browser;
  try {
    browser=await chromium.launch({
      ...(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{channel:'chrome'}),
      headless:true,
    });
    const page=await browser.newPage({viewport:{width:390,height:844}});
    const errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    const organizer={
      name:'Hustle & Flow',
      bio:'Des soirées qui réunissent la scène locale, les DJs et le public autour de la musique.',
      email:'hello@example.com',
      logo_url:'/images/organisateur-icon.png',
      banner_url:'/images/venue-photo.jpg',
      instagram_url:'https://instagram.com/hustleflow',
      website_url:'https://example.com',
      followers_count:284,
      following:false,
      events:[
        {id:'live',name:'Friday Pull Up',club_name:'Le Cargo',flyer_url:'/images/auth-hero-promo.jpg',upcoming:false,closed:false},
        {id:'next-1',name:'Rooftop Session',club_name:'Le Sucre',scheduled_at:'2027-06-18T20:30:00+02:00',upcoming:true,closed:false},
        {id:'next-2',name:'Afro Club',club_name:'La Machine',scheduled_at:'2027-07-04T22:00:00+02:00',upcoming:true,closed:false},
        {id:'past',name:'Summer Opening',club_name:'Le Cargo',upcoming:false,closed:true},
      ],
    };
    await page.route('**/*',async route=>{
      const url=new URL(route.request().url());
      if(url.hostname!=='127.0.0.1')return route.abort();
      if(url.pathname==='/api/orga/by-slug/test-club')return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(organizer)});
      if(url.pathname.startsWith('/api/'))return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(url.pathname==='/api/config/public'?{}:[])});
      return route.continue();
    });

    await page.goto('http://127.0.0.1:3108/test-club');
    await page.locator('#pg-orga-public.active').waitFor();
    assert.equal(await page.locator('#op-name').innerText(),'HUSTLE & FLOW');
    assert.equal(await page.locator('#op-events-live .op-live-card').count(),1);
    assert.equal(await page.locator('#op-events-upcoming .op-up-row').count(),2);
    assert.equal(await page.locator('#op-events-closed .op-up-row').count(),1);
    assert.equal(await page.locator('#op-socials a').count(),2);
    assert.equal(await page.locator('#op-email-btn').isVisible(),true);
    assert.equal(await page.locator('#pg-orga-public .scroll').evaluate(el=>el.scrollWidth<=el.clientWidth),true);
    await page.screenshot({path:path.join(require('node:os').tmpdir(),'orga-public-mobile.png'),fullPage:true});

    await page.setViewportSize({width:1280,height:900});
    assert.equal(await page.locator('.op2-content').evaluate(el=>getComputedStyle(el).gridTemplateColumns.split(' ').length),2);
    assert.equal(await page.locator('#pg-orga-public .scroll').evaluate(el=>el.scrollWidth<=el.clientWidth),true);
    await page.screenshot({path:path.join(require('node:os').tmpdir(),'orga-public-desktop.png'),fullPage:true});

    const relevant=errors.filter(error=>!error.includes('supabase')&&!error.includes('QRCode'));
    assert.deepEqual(relevant,[]);
    console.log('PASS: organizer public page renders live, upcoming and past events on mobile and desktop.');
  } finally {
    await browser?.close();
    server.close();
  }
})().catch(error=>{console.error(error);process.exitCode=1});
