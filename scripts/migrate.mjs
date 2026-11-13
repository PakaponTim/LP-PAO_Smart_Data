import 'dotenv/config';
import mysql from 'mysql2/promise';
import { createIngestionRepository } from '../backend/repositories/ingestion.js';
const pool=mysql.createPool({host:process.env.DB_HOST||'localhost',port:Number(process.env.DB_PORT)||3306,user:process.env.DB_USER||'root',password:process.env.DB_PASS||'root',database:process.env.DB_NAME||'water_systems',connectionLimit:1,connectTimeout:5000});
try{await createIngestionRepository(pool).ensureSchema();console.log('Additive schema ready: app_ingest_batches, app_complaint_events. Existing records unchanged.');}finally{await pool.end();}
