import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

// Serialize read-modify-write operations; rename keeps readers on a complete version.
export class FileStore {
  constructor(filename, initial) { this.filename = filename; this.initial = initial; this.tail = Promise.resolve(); }
  async read() {
    try { return JSON.parse(await fs.readFile(this.filename, 'utf8')); }
    catch (error) { if (error.code === 'ENOENT') return structuredClone(this.initial); throw error; }
  }
  update(change) {
    const operation = this.tail.then(async () => {
      const data = await this.read();
      const result = await change(data);
      await fs.mkdir(path.dirname(this.filename), { recursive: true });
      const temporary = `${this.filename}.${randomUUID()}.tmp`;
      try {
        await fs.writeFile(temporary, JSON.stringify(data, null, 2), { mode: 0o600 });
        await fs.rename(temporary, this.filename);
      } finally { await fs.rm(temporary, { force: true }); }
      return result;
    });
    this.tail = operation.catch(() => {});
    return operation;
  }
}
