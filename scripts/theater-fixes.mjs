import fs from 'node:fs/promises';
let s=await fs.readFile('src/theater/schema.ts','utf8');s=s.replace("kind==='visual'?.15:.2","kind==='visual'?0:.2");await fs.writeFile('src/theater/schema.ts',s);
