import ts from 'typescript';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';

await fs.mkdir('work',{recursive:true});
for(const name of ['schema','design-client']){
  const source=await fs.readFile(`lib/home/${name}.ts`,'utf8');
  const js=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText.replace("'./schema'","'./design-client-schema.mjs'");
  await fs.writeFile(`work/${name==='schema'?'design-client-schema':name}.mjs`,js);
}
const {DEFAULT_HOUSE}=await import('../work/design-client-schema.mjs');
const {readDesignResponse,DesignRequestError}=await import('../work/design-client.mjs');
const success={house:DEFAULT_HOUSE,plan:{patches:[],message:'Nothing changed.',question:null},mode:'gemma',steps:['Keep current scene']};
const result=await readDesignResponse(Response.json(success));
assert.equal(result.mode,'gemma');
assert.deepEqual(result.house,DEFAULT_HOUSE);

await assert.rejects(
  ()=>readDesignResponse(Response.json({code:'RATE_LIMIT',error:'Gemma reached its request limit.',retryAfterSeconds:12.4,requestId:'diagnostic-id'},{status:429})),
  error=>error instanceof DesignRequestError&&error.code==='RATE_LIMIT'&&error.status===429&&error.retryAfterSeconds===13&&error.retryable&&error.requestId==='diagnostic-id',
);
await assert.rejects(
  ()=>readDesignResponse(new Response('Too many requests',{status:429,headers:{'Retry-After':'17'}})),
  error=>error.code==='RATE_LIMIT'&&error.retryAfterSeconds===17&&/request limit/.test(error.message),
);
await assert.rejects(
  ()=>readDesignResponse(new Response('<html><h1>Error 1102</h1>Worker exceeded resource limits</html>',{status:500})),
  error=>error.code==='HOSTING_LIMIT'&&error.retryable&&/hosting processing limit/.test(error.message)&&!error.message.includes('<html>'),
);
await assert.rejects(
  ()=>readDesignResponse(new Response('<html>Service Unavailable</html>',{status:503})),
  error=>error.code==='HOSTING_ERROR'&&error.retryable&&/house is unchanged/.test(error.message)&&!error.message.includes('JSON'),
);
await assert.rejects(
  ()=>readDesignResponse(Response.json({code:'AUTH',error:'Model access needs attention.',retryable:false},{status:503})),
  error=>error.code==='AUTH'&&!error.retryable&&error.message==='Model access needs attention.',
);
await assert.rejects(
  ()=>readDesignResponse(Response.json({code:'RATE_LIMIT',error:'Gemma reached its request limit.',retryAfterSeconds:-10},{status:429,headers:{'Retry-After':'9'}})),
  error=>error.retryAfterSeconds===9,
);
for(const response of [new Response('upstream response was cut off'),Response.json({...success,plan:null})]){
  await assert.rejects(()=>readDesignResponse(response),error=>error.code==='INVALID_RESPONSE'&&/house is unchanged/.test(error.message));
}
assert.deepEqual(DEFAULT_HOUSE,success.house);
console.log('PASS: design response validation, rate-limit metadata, Retry-After, Cloudflare resource errors, HTML failures, non-retryable errors, unchanged house');
