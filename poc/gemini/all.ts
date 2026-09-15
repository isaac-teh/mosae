import { spawn } from 'node:child_process';
import { models, defaultIntents } from './config.js';
const set = process.argv[2]; if (!set) throw new Error('Usage: npm run all -- <trip|creator>');
const run = (file: string, args: string[]) => new Promise<void>((resolve, reject) => { const p = spawn('npx', ['tsx', file, ...args], { stdio: 'inherit', env: process.env }); p.on('exit', c => c === 0 ? resolve() : reject(new Error(`${file} failed`))); });
await run('01-ingest.ts',[set]); await run('02-analyze.ts',[set]); await run('03-catalog.ts',[set]); await run('04-story.ts',[set,defaultIntents[set]]); await run('05-compose.ts',[set]); await run('06-preview.ts',[set]); await run('07-report.ts',[]); console.log(`Completed ${set}; use 02-analyze.ts ${set} --model ${models.analyzeCompare} for the comparison run.`);
