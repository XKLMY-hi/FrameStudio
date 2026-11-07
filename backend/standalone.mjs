import {createStudioServer} from './server.mjs';
import {fileURLToPath} from 'node:url';
const service=await createStudioServer({root:fileURLToPath(new URL('../',import.meta.url)),port:Number(process.env.PORT)||4191,token:process.env.STUDIO_TOKEN||'local-development'});
console.log(service.url);
