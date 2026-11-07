import fs from 'node:fs/promises';
let s=await fs.readFile('scripts/v11-qa.mjs','utf8');s=s.replace(/qa\/v11-app-\d+/,'qa/v11-app-'+Date.now()).replace("STUDIO_TEST_MODE:'1'","STUDIO_TEST_MODE:''");await fs.writeFile('scripts/v11-qa.mjs',s);
