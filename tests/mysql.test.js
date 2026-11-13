import 'dotenv/config';
import test from 'node:test';
import assert from 'node:assert/strict';
import mysql from 'mysql2/promise';
import { randomBytes } from 'node:crypto';
import { createIngestionRepository } from '../backend/repositories/ingestion.js';
import { dailyDamQuery } from '../backend/services/data-definitions.js';

test('isolated MySQL schema: ingestion, replay, rollback, and daily dam totals', {skip:process.env.WATER_DB_TEST !== '1'}, async () => {
  const config = { host:process.env.DB_HOST||'localhost',port:Number(process.env.DB_PORT)||3306,user:process.env.DB_USER||'root',password:process.env.DB_PASS||'root',connectTimeout:5000 };
  const source = await mysql.createConnection({...config,database:process.env.DB_NAME||'water_system2'});
  const schema = `water_test_${randomBytes(6).toString('hex')}`;
  let pool;
  try {
    await source.query(`CREATE DATABASE \`${schema}\` CHARACTER SET utf8mb4`);
    pool = mysql.createPool({...config,database:schema,connectionLimit:2});
    for (const name of ['tbl_water_disaster_monitoring','tbl_rainfall_monitoring','tbl_drought_monitoring','tbl_pm25_monitoring','tbl_complaints_monitoring']) {
      const [rows] = await source.query(`SHOW CREATE TABLE \`${name}\``); await pool.query(rows[0]['Create Table']);
    }
    const repository = createIngestionRepository(pool,{sleep:async () => {}});
    const water = ['station','river','district','province','1','2','1','stable','normal','12:00','0','10','0','normal'];
    await repository.write('water',[water],'first');
    assert.equal((await repository.write('water',[water],'first')).duplicate,true);
    const [count] = await pool.query('SELECT COUNT(*) AS n FROM tbl_water_disaster_monitoring'); assert.equal(count[0].n,1);
    const wrapped = { query:pool.query.bind(pool),execute:pool.execute.bind(pool),async getConnection() {
      const connection = await pool.getConnection(); const query = connection.query.bind(connection); let writes = 0;
      return { execute:connection.execute.bind(connection), beginTransaction:connection.beginTransaction.bind(connection),commit:connection.commit.bind(connection),rollback:connection.rollback.bind(connection),release:connection.release.bind(connection),async query(...args) { if (++writes === 2) throw new Error('simulated interruption after first chunk'); return query(...args); } };
    }};
    await assert.rejects(createIngestionRepository(wrapped).write('water',Array(251).fill(water),'rollback'),/simulated interruption/);
    const [after] = await pool.query('SELECT COUNT(*) AS n FROM tbl_water_disaster_monitoring'); assert.equal(after[0].n,1);
    await repository.write('drought',[['today','now','large','Dam A','100','1','20','20%','15','1'],['today','now','large','Dam B','100','1','30','30%','25','1']],'dams-first');
    await repository.write('drought',[['today','now','large','Dam A','100','1','25','25%','20','1']],'dams-second');
    const [totals] = await pool.query(dailyDamQuery()); assert.equal(Number(totals[0].total_val),55);
    await repository.write('rainfall',[{station_name:'rain',rain_mm:0}],'rain');
    await repository.write('pm25',[['today','now','air','tambon','district','province','12:00',0,0,'normal']],'air');
    await repository.write('complaints',[{ticket_id:'test-1',state_name:'รอรับเรื่อง',org_name:'อบจ.ลำปาง'}],'complaint-first');
    await repository.write('complaints',[{ticket_id:'test-1',state_name:'เสร็จสิ้น',org_name:'อบจ.ลำปาง'}],'complaint-next');
    const [events] = await pool.query('SELECT COUNT(*) AS n FROM app_complaint_events'); assert.equal(events[0].n,2);
  } finally {
    if (pool) await pool.end();
    if (!/^water_test_[a-f0-9]{12}$/.test(schema)) throw new Error('Unsafe test schema cleanup target');
    await source.query(`DROP DATABASE IF EXISTS \`${schema}\``); await source.end();
  }
});
