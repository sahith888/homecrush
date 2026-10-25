import ts from 'typescript';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
await fs.mkdir('work',{recursive:true});
for(const name of ['schema','engine','model-errors','workflow']){
 const source=await fs.readFile(`lib/home/${name}.ts`,'utf8');
 const js=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText.replace("'./schema'","'./schema.mjs'").replace("'./model-errors'","'./model-errors.mjs'");
 await fs.writeFile(`work/${name}.mjs`,js);
}
const {HouseSchema,DEFAULT_HOUSE,validatePatches}=await import('../work/schema.mjs');
const {runDesign,parseModelPlan}=await import('../work/workflow.mjs');
const oldHouse=structuredClone(DEFAULT_HOUSE);delete oldHouse.rooms.hallway;delete oldHouse.rooms.upperHallway;for(const r of Object.values(oldHouse.rooms)){delete r.lighting;delete r.decor;}
const migrated=HouseSchema.parse(oldHouse);assert.ok(migrated.rooms.hallway);assert.equal(migrated.rooms.living.lighting,'neutral');assert.equal(migrated.rooms.living.wall,oldHouse.rooms.living.wall);
const input={prompt:'give it a more cozy vibe with warm lighting',room:'living',house:migrated,history:[]};
let requests=[];
const plan={patches:[{room:'living',key:'lighting',value:'warm'},{room:'living',key:'lamp',value:true}],message:'Warm lighting added.',question:null};
const ok=(p)=>Response.json({candidates:[{content:{parts:[{text:JSON.stringify(p)}]},finishReason:'STOP'}]});
const result=await runDesign(input,'test-key',async(_url,options)=>{requests.push(JSON.parse(options.body));return ok(plan);});
assert.equal(requests[0].generationConfig.thinkingConfig.thinkingLevel,'minimal');assert.equal(result.house.rooms.living.lighting,'warm');assert.equal(migrated.rooms.living.lighting,'neutral');
let count=0;
const repaired=await runDesign(input,'test-key',async()=>++count===1?Response.json({candidates:[{content:{parts:[{text:'incomplete {'}]}}]}):ok(plan));
assert.equal(count,2);assert.equal(repaired.house.rooms.living.lighting,'warm');
count=0;
const invalid={...plan,patches:[{room:'living',key:'plants',value:99}]};
await runDesign(input,'test-key',async()=>ok(++count===1?invalid:plan));assert.equal(count,2);
await assert.rejects(()=>runDesign(input,'test-key',async()=>{throw new DOMException('Timed out','TimeoutError');}),e=>e.code==='TIMEOUT'&&e.status===504);
await assert.rejects(()=>runDesign(input,'test-key',async()=>new Response('',{status:429})),e=>e.code==='RATE_LIMIT'&&e.status===429);
await assert.rejects(()=>runDesign(input,'test-key',async()=>new Response('',{status:403})),e=>e.code==='AUTH'&&!e.retryable);
assert.equal(parseModelPlan('```json\n'+JSON.stringify(plan)+'\n```').patches.length,2);
assert.throws(()=>validatePatches(migrated,[{room:'living',key:'__proto__',value:'x'}]));
const hall=validatePatches(result.house,[{room:'hallway',key:'decor',value:'layered'},{room:'hallway',key:'plants',value:2}]);
assert.equal(hall.rooms.hallway.decor,'layered');assert.equal(hall.rooms.living.lighting,'warm');
// Captured live failure from the "Walnut floors and more plants" starter button.
const grouped={patches:[{room:'living',floorKind:'walnut',plants:4}],message:'Updated walnut flooring and plants.'};
count=0;
const normalized=await runDesign({...input,prompt:'Walnut floors and more plants'},'test-key',async()=>{count++;return ok(grouped);});
assert.equal(count,1);assert.equal(normalized.house.rooms.living.floorKind,'walnut');assert.equal(normalized.house.rooms.living.plants,4);
assert.equal(normalized.house.rooms.kitchen.floorKind,migrated.rooms.kitchen.floorKind);
assert.equal(parseModelPlan(JSON.stringify({patches:[{room:'upperHallway',set:{decor:'layered',lamp:true}}],message:'Updated.'})).patches.length,2);
const stringValues=parseModelPlan(JSON.stringify({patches:[{room:'upperHallway',key:'plants',value:'3'},{room:'living',key:'lamp',value:'false'}],message:'Updated.'}));
assert.equal(stringValues.patches[0].value,3);assert.equal(stringValues.patches[1].value,false);
assert.throws(()=>validatePatches(migrated,parseModelPlan(JSON.stringify({patches:[{room:'living',key:'plants',value:'99'}],message:'x'})).patches));
assert.throws(()=>parseModelPlan('{"patches":[{"room":"living","__proto__":{"polluted":true}}],"message":"x"}'));
assert.throws(()=>parseModelPlan(JSON.stringify({patches:[{room:'living',floorKind:'walnut',execute:'bad'}],message:'x'})));
// Repairs must receive the exact failing patch, not only a generic admonition.
requests=[];
const badGlobal={patches:[{room:'house',key:'floorKind',value:'walnut'}],message:'Updated.'};
const fixedGlobal={patches:[{room:'living',key:'floorKind',value:'walnut'}],message:'Updated.'};
await runDesign(input,'test-key',async(_url,options)=>{requests.push(JSON.parse(options.body));return ok(requests.length===1?badGlobal:fixedGlobal);});
const correction=JSON.parse(requests[1].contents[0].parts[0].text);
assert.match(correction.correction,/house.*only time/i);assert.equal(JSON.parse(correction.previousOutput).patches[0].key,'floorKind');
assert.ok(requests[1].generationConfig.maxOutputTokens>requests[0].generationConfig.maxOutputTokens);
// Whole-house edits need more than the previous 20-setting ceiling.
const largePlan={patches:Object.keys(DEFAULT_HOUSE.rooms).flatMap(room=>[{room,key:'lighting',value:'warm'},{room,key:'decor',value:'layered'},{room,key:'plants',value:3},{room,key:'rug',value:true},{room,key:'floorKind',value:'walnut'},{room,key:'wall',value:'#fffdd0'}]),message:'Updated all rooms.'};
const large=await runDesign(input,'test-key',async()=>ok(largePlan));assert.equal(large.plan.patches.length,48);assert.equal(large.house.revision,input.house.revision+1);
count=0;
await assert.rejects(()=>runDesign(input,'test-key',async()=>{count++;return ok(badGlobal);}),e=>e.code==='INVALID_PLAN');assert.equal(count,2);
count=0;
await runDesign(input,'test-key',async()=>++count===1?new Response('',{status:503}):ok(plan));assert.equal(count,2);
count=0;
await assert.rejects(()=>runDesign(input,'test-key',async()=>{count++;return new Response('',{status:503});}),e=>e.code==='UPSTREAM');assert.equal(count,2);
count=0;
await assert.rejects(()=>runDesign(input,'test-key',async()=>{count++;return Response.json({promptFeedback:{blockReason:'SAFETY'}});}),e=>e.code==='BLOCKED'&&!e.retryable);assert.equal(count,1);
await assert.rejects(()=>runDesign(input,'test-key',async()=>Response.json(null)),e=>e.code==='UPSTREAM');
count=0;
await assert.rejects(()=>runDesign(input,'test-key',async()=>{count++;return new Response('',{status:503,headers:{'Retry-After':'60'}});}),e=>e.code==='UPSTREAM'&&e.retryAfterSeconds===60);assert.equal(count,1);
console.log('PASS: saved-state migration, iterative preservation, live grouped-patch regression, precise bounded repairs, whole-house edits, transient recovery and distinct provider errors');
