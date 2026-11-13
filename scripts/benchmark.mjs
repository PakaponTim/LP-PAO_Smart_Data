import 'dotenv/config';
import mysql from 'mysql2/promise';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createAsyncCache } from '../backend/services/cache.js';
import { createExcelRepository } from '../backend/repositories/excel.js';
const pool=mysql.createPool({host:process.env.DB_HOST||'localhost',port:Number(process.env.DB_PORT)||3306,user:process.env.DB_USER||'root',password:process.env.DB_PASS||'root',database:process.env.DB_NAME||'water_systems',connectionLimit:1,connectTimeout:5000});
const temporary=await fs.mkdtemp(path.join(os.tmpdir(),'water-benchmark-'));
const results={at:new Date().toISOString(),scope:'20 status reads, single client; 10 synthetic Excel batches; not a production load test'};
try {
  let queries=0;
  async function readStatus(){for(const table of ['tbl_water_disaster_monitoring','tbl_drought_monitoring','tbl_pm25_monitoring','tbl_complaints_monitoring']){await pool.query(`SELECT COUNT(*) AS count FROM ${table}`);await pool.query(`SELECT MAX(recorded_at) AS last_update FROM ${table}`);queries+=2;}return true;}
  await readStatus();queries=0;let started=performance.now();for(let i=0;i<20;i++)await readStatus();results.statusBefore={ms:Math.round(performance.now()-started),queries};
  const cache=createAsyncCache(60000);queries=0;started=performance.now();for(let i=0;i<20;i++)await cache.get('status',readStatus);results.statusAfter={ms:Math.round(performance.now()-started),queries};
  const rows=Array.from({length:20},(_,i)=>['station-'+i,'river','district','province',1,2,1,'stable','normal','12:00',0,5,0,'normal','2026-09-07']);
  const jobs=Array.from({length:10},(_,i)=>({id:'benchmark-'+i,rows,createdAt:new Date().toISOString()}));
  for(const mode of ['separate','combined']){
    const directory=path.join(temporary,mode);await fs.mkdir(directory);const excel=createExcelRepository(directory);started=performance.now();
    if(mode==='separate')for(const job of jobs)await excel.writeJobs('water',[job]);else await excel.writeJobs('water',jobs);
    results['excel_'+mode]={ms:Math.round(performance.now()-started),writes:excel.metrics.writes,rows:excel.metrics.rows};
  }
  await fs.mkdir('runtime',{recursive:true});await fs.writeFile('runtime/benchmark.json',JSON.stringify(results,null,2));console.log(JSON.stringify(results,null,2));
}finally{await pool.end();await fs.rm(temporary,{recursive:true,force:true});}
