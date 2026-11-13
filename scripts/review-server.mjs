import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
const directory = await fs.mkdtemp(path.join(os.tmpdir(),'water-ui-review-'));
const port = '3107';
const child = spawn(process.execPath,['server.js'],{cwd:path.resolve(import.meta.dirname,'..'),env:{...process.env,PORT:port,HOST:'127.0.0.1',WATER_DATA_DIR:directory,WATER_DISABLE_AUTOMATION:'1'},windowsHide:true,stdio:['ignore','pipe','pipe']});
let buffered = '', started = false;
child.stderr.on('data',data=>process.stderr.write(data));
child.stdout.on('data',async chunk=>{
  buffered += chunk.toString();
  const token = buffered.match(/setup\.html#([a-f0-9]{64})/);
  if (token && !started) {
    started=true;
    const response=await fetch(`http://127.0.0.1:${port}/api/auth/bootstrap`,{method:'POST',headers:{'Content-Type':'application/json','X-Bootstrap-Token':token[1]},body:JSON.stringify({username:'review',password:'review-only-password-2026'})});
    if(!response.ok) {console.error('Review bootstrap failed:',response.status);child.kill();return;}
    console.log(`Review ready: http://127.0.0.1:${port}/login.html (temporary account review / review-only-password-2026)`);
    buffered='';
  }
});
async function stop(){child.kill();await fs.rm(directory,{recursive:true,force:true,maxRetries:5,retryDelay:200});process.exit();}
process.on('SIGINT',stop);process.on('SIGTERM',stop);
child.on('exit',code=>{if(code)console.error('Review server exited:',code);});
