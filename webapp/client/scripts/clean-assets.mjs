import { rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// Vite's outDir points at webapp/ with emptyOutDir:false (so it doesn't wipe
// this client/ source folder). That means old hashed bundle files would pile
// up in webapp/assets across builds unless we clear them first.
const assetsDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../assets');

rmSync(assetsDir, { recursive: true, force: true });
