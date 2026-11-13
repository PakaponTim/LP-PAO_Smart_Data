import fs from 'node:fs';
import vm from 'node:vm';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
const roots = ['server.js','notification_module.js','report_generator_service.js','backend','backend_ui','01System_Water','04ext_TraffyLP'];
let checked = 0;
function check(file) {
  if (fs.statSync(file).isDirectory()) { for (const item of fs.readdirSync(file)) check(path.join(file,item)); return; }
  if (/\.min\.js$/.test(file)) return;
  if (/\.(js|mjs)$/.test(file)) {
    const result = spawnSync(process.execPath, ['--check',file], { encoding:'utf8' });
    if (result.status) throw new Error(`${file}: ${result.stderr}`); checked++;
  } else if (file.endsWith('.html')) {
    const html = fs.readFileSync(file,'utf8');
    for (const [index, match] of [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)].entries()) {
      if (/\bsrc\s*=|type\s*=\s*["'](?:module|application\/)/i.test(match[1]) || !match[2].trim()) continue;
      new vm.Script(match[2], { filename:`${file}:script-${index}` }); checked++;
    }
  }
}
roots.forEach(check); console.log(`Syntax passed: ${checked} JavaScript files / inline scripts`);
