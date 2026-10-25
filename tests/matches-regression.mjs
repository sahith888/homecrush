import ts from 'typescript';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
await fs.mkdir('work',{recursive:true});
for(const name of ['schema','match-profile','listing-sources','matching']){
const source=await fs.readFile(`lib/home/${name}.ts`,'utf8');
const js=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText.replace(/from '(\.\/[^']+)'/g,"from '$1.mjs'");await fs.writeFile(`work/${name}.mjs`,js);
}
const {DEFAULT_HOUSE}=await import('../work/schema.mjs');
const {dreamDescription,MatchRequestSchema}=await import('../work/match-profile.mjs');
const {listingUrl,parseListing,rankListings,findMatches}=await import('../work/matching.mjs');
const url='https://www.compass.com/homedetails/123-Test-St-Town-NY-10001/TEST_pid/';
function fixture(status='Active',text='Warm hardwood floors with large windows, kitchen island and a second floor.'){
const node={'@type':['RealEstateListing','SingleFamilyResidence'],address:{streetAddress:'123 Test St',addressLocality:'Town',addressRegion:'NY',addressCountry:'US'},description:text,offers:{price:450000},image:[{url:'https://www.compass.com/m/test/640x480.jpg'}],accommodationFloorPlan:{numberOfBedrooms:3,numberOfBathroomsTotal:2},floorSize:{value:'1,800 '}};
return `<meta property="og:description" content="A home listed for sale"><meta property="og:image" content="https://www.compass.com/m/test/640x480.jpg"><script type="application/ld+json">${JSON.stringify(node)}</script><script>{"key":"Status","value":"${status}"}</script>`;
}
for(const bad of ['http://www.compass.com/homedetails/x/y/','https://www.compass.com.evil.com/homedetails/x/y/','https://127.0.0.1/homedetails/x/y/','https://user:pass@www.compass.com/homedetails/x/y/','https://www.compass.com/search/','https://www.compass.com:8080/homedetails/x/y/'])assert.equal(listingUrl(bad),null);
const listing=parseListing(fixture(),url);assert.equal(listing.price,450000);assert.equal(listing.beds,3);assert.equal(listing.sqft,1800);
for(const status of ['Closed','Sold','Pending','Active Under Contract','Unknown'])assert.equal(parseListing(fixture(status),url),null);
assert.equal(parseListing(fixture().replace('A home listed for sale','A home not currently listed. Last sold for $450,000'),url),null);
assert.equal(parseListing(fixture().replaceAll('https://www.compass.com/m/test/640x480.jpg','https://evil.test/fake.jpg'),url),null);
const request=MatchRequestSchema.parse({house:DEFAULT_HOUSE,description:dreamDescription(DEFAULT_HOUSE)});
assert.ok(rankListings([listing],request)[0].matches.includes('Wood floors'));
assert.equal(rankListings([listing],{...request,maxPrice:400000}).length,0);
assert.equal(rankListings([listing],{...request,intent:'rent'}).length,0);
assert.equal(rankListings([listing],{...request,location:'California'}).length,0);
assert.ok(!rankListings([{...listing,description:'A condo with tile floors.'}],request)[0].matches.includes('Wood floors'));
let calls=[];
const result=await findMatches(request,'test-key',async(url,options)=>{calls.push({url,options});if(String(url).includes('googleapis.com'))return new Response('',{status:429});if(options?.method==='HEAD')return new Response(null,{headers:{'content-type':'image/jpeg'}});return new Response(fixture());});
assert.equal(result.mode,'collection');assert.ok(result.notice.includes('quota'));assert.equal(result.listings.length,3);assert.equal(result.listings[0].description,'');assert.ok(result.listings.every(l=>l.images.length));
let contacted=[];const blocked=await findMatches(request,undefined,async(url)=>{contacted.push(url);return new Response(null,{status:302,headers:{location:'http://127.0.0.1/private'}});});assert.equal(blocked.listings.length,0);assert.ok(contacted.every(u=>String(u).startsWith('https://www.compass.com/')));
const noPhotos=await findMatches(request,undefined,async(url,options)=>options?.method==='HEAD'?new Response(null,{status:403}):new Response(fixture()));assert.equal(noPhotos.listings.length,0);
console.log('PASS: source status, historical prices, photo provenance, filters, trait evidence, quota fallback and redirect restrictions.');
