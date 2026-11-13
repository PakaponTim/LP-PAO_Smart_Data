import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import { installOperations } from '../backend/routes/operations.js';
import { FileStore } from '../backend/services/file-store.js';
import { createIngestionService } from '../backend/services/ingestion.js';

test('incident tracking preserves actor/history and rejects unknown events', async t => {
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'water-incidents-test-'));
  const app=express();app.use(express.json());app.use((req,res,next)=>{req.user={username:'trusted-operator'};next();});
  const pool={async query(){return [[{id:1,alert_title:'Test incident'}]];},async execute(sql,[id]){return [id===1?[{id:1}]:[]];}};
  installOperations(app,{pool,directory,outbox:{},ingestion:{},recovery:new FileStore(path.join(directory,'recovery.json'),{jobs:[]}),excel:{metrics:{}},metrics:{snapshot:()=>[]}});
  const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
  t.after(async()=>{await new Promise(r=>server.close(r));await fs.rm(directory,{recursive:true,force:true});});
  const base=`http://127.0.0.1:${server.address().port}`;
  const update=(id,status)=>fetch(base+'/api/incidents/'+id,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({status,owner:'Team A',note:'Checked',actor:'spoofed-user'})});
  assert.equal((await update(99,'acknowledged')).status,404);
  assert.equal((await update(1,'invalid')).status,400);
  assert.equal((await update(1,'acknowledged')).status,200);
  assert.equal((await update(1,'resolved')).status,200);
  const {incidents}=await (await fetch(base+'/api/incidents')).json();
  assert.equal(incidents[0].status,'resolved');assert.equal(incidents[0].history.length,2);assert.equal(incidents[0].history[0].actor,'trusted-operator');
});
test('failed ingestion keeps original payload for replay with the same key',async t=>{
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'water-recovery-test-'));t.after(()=>fs.rm(directory,{recursive:true,force:true}));
  const recovery=new FileStore(path.join(directory,'recovery.json'),{jobs:[]});let fail=true;const keys=[];
  const service=createIngestionService({recovery,repository:{async write(kind,rows,key){keys.push(key);if(fail)throw new Error('DB unavailable');return {batchId:kind+':'+key};}},excelWriters:{rainfall:async()=>{}},outbox:{enqueue:async()=>{}}});
  const rows=[{station_name:'Test rainfall',rain_mm:0}];
  assert.equal((await service.save('rainfall',rows,'recover-me')).success,false);
  const [job]=(await recovery.read()).jobs;assert.deepEqual(job.rows,rows);
  fail=false;assert.equal((await service.save(job.kind,job.rows,job.key)).success,true);
  assert.equal((await recovery.read()).jobs.length,0);assert.deepEqual(keys,['recover-me','recover-me']);
});
