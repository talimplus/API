/**
 * Bazaga tegmasdan xlsx -> model hisobotini chiqaradi.
 *
 *   npx ts-node -r tsconfig-paths/register --transpile-only \
 *     scripts/legacy-import/litech/dry-run.ts "new-data/LITECH 2026.xlsx" [--verbose]
 */
import { parseWorkbook } from './parse';
import { buildModel } from './model';
import { printModelReport } from './report';

(async () => {
  const file = process.argv[2] ?? 'new-data/LITECH 2026.xlsx';
  const model = buildModel(await parseWorkbook(file));
  printModelReport(model, { verbose: process.argv.includes('--verbose') });
})();
