import { readFile } from 'node:fs/promises';
import { verifyReportLocally } from '../dist/index.js';

const path = process.argv[2];
if (!path) {
  console.error('Usage: node scripts/verify-report.mjs path/to/report.json');
  process.exitCode = 2;
} else {
  try {
    const result = verifyReportLocally(JSON.parse(await readFile(path, 'utf8')));
    console.log(JSON.stringify(result, null, 2));
    process.exitCode = result.isLocallyValid ? 0 : 1;
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Report verification failed');
    process.exitCode = 2;
  }
}
