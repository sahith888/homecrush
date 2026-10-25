import ts from 'typescript';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';

await fs.mkdir('work',{recursive:true});
const source=await fs.readFile('lib/home/model-errors.ts','utf8');
await fs.writeFile('work/model-errors.mjs',ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText);
const {classifyModelError,ModelServiceError}=await import('../work/model-errors.mjs');
const response=(status,error,headers={})=>Response.json({error},{status,headers});
const retryInfo=delay=>({'@type':'type.googleapis.com/google.rpc.RetryInfo',retryDelay:delay});
const quotaFailure=violation=>({'@type':'type.googleapis.com/google.rpc.QuotaFailure',violations:[violation]});

const burst=await classifyModelError(response(429,{details:[quotaFailure({quotaId:'GenerateRequestsPerMinutePerProjectPerModel-FreeTier',quotaValue:'30'}),retryInfo('2.5s')]}));
assert.ok(burst instanceof ModelServiceError);
assert.equal(burst.code,'RATE_LIMIT');assert.equal(burst.status,429);assert.equal(burst.retryable,true);assert.equal(burst.retryAfterSeconds,3);
const header=await classifyModelError(response(429,{details:[retryInfo('2s')]},{'Retry-After':'17'}));
assert.equal(header.retryAfterSeconds,17);
const dateHeader=await classifyModelError(response(429,{}, {'Retry-After':new Date(Date.now()+20000).toUTCString()}));
assert.ok(dateHeader.retryAfterSeconds>=19&&dateHeader.retryAfterSeconds<=20);
const duration=await classifyModelError(response(429,{details:[retryInfo({seconds:'5',nanos:500000000})]}));
assert.equal(duration.retryAfterSeconds,6);
const daily=await classifyModelError(response(429,{details:[quotaFailure({quotaId:'GenerateRequestsPerDayPerProjectPerModel-FreeTier',quotaValue:'1000'}),retryInfo('1s')]}));
assert.equal(daily.code,'QUOTA_EXHAUSTED');assert.equal(daily.retryable,false);assert.equal(daily.retryAfterSeconds,undefined);assert.match(daily.message,/daily quota/);
const zero=await classifyModelError(response(429,{details:[quotaFailure({quotaId:'GenerateRequestsPerMinutePerProjectPerModel-FreeTier',quotaValue:'0'})]}));
assert.equal(zero.code,'QUOTA_EXHAUSTED');assert.equal(zero.retryable,false);assert.match(zero.message,/no quota available/);
const messageZero=await classifyModelError(response(429,{message:'Quota exceeded for metric example, limit: 0, model: example'}));
assert.equal(messageZero.code,'QUOTA_EXHAUSTED');assert.equal(messageZero.retryable,false);
const notZero=await classifyModelError(response(429,{details:[quotaFailure({quotaValue:null})]}));
assert.equal(notZero.code,'RATE_LIMIT');assert.equal(notZero.retryAfterSeconds,30);
const fractionalQuota=await classifyModelError(response(429,{message:'Quota exceeded for metric example, limit: 0.5, model: example'}));
assert.equal(fractionalQuota.code,'RATE_LIMIT');
const malformed=await classifyModelError(new Response('<html>provider failure, sensitive-test-value</html>',{status:429}));
assert.equal(malformed.code,'RATE_LIMIT');assert.equal(malformed.retryAfterSeconds,30);assert.ok(!malformed.message.includes('sensitive-test-value'));
for(const status of [401,403]){
  const auth=await classifyModelError(response(status,{message:'provider secret or prompt: sensitive-test-value'}));
  assert.equal(auth.code,'AUTH');assert.equal(auth.status,503);assert.equal(auth.retryable,false);assert.ok(!auth.message.includes('sensitive-test-value'));
}
const unavailable=await classifyModelError(response(503,{message:'sensitive-test-value'},{'Retry-After':'8'}));
assert.equal(unavailable.code,'UPSTREAM');assert.equal(unavailable.retryable,true);assert.equal(unavailable.retryAfterSeconds,8);assert.ok(!unavailable.message.includes('sensitive-test-value'));
const invalid=await classifyModelError(response(400,{message:'sensitive-test-value'}));
assert.equal(invalid.code,'UPSTREAM');assert.equal(invalid.retryable,false);
let reads=0,canceled=false;
const oversized=new ReadableStream({pull(controller){reads++;controller.enqueue(new TextEncoder().encode('x'.repeat(20000)));},cancel(){canceled=true;}});
const bounded=await classifyModelError(new Response(oversized,{status:429}));
assert.equal(bounded.retryAfterSeconds,30);assert.ok(canceled);assert.ok(reads<=2);
console.log('PASS: burst rate limits, Retry-After headers, RetryInfo durations, daily/zero quota, bounded malformed bodies, auth and upstream classifications');
