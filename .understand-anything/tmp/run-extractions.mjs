import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

const projectRoot = process.argv[2] || process.cwd();
const intermediateDir = path.join(projectRoot, '.understand-anything', 'intermediate');
const tmpDir = path.join(projectRoot, '.understand-anything', 'tmp');

if (!fs.existsSync(tmpDir)) {
  fs.mkdirSync(tmpDir, { recursive: true });
}

const batchesFile = path.join(intermediateDir, 'batches.json');
if (!fs.existsSync(batchesFile)) {
  console.error(`Could not find ${batchesFile}`);
  process.exit(1);
}

const batchesData = JSON.parse(fs.readFileSync(batchesFile, 'utf8'));

console.log(`Preparing ${batchesData.totalBatches} batches for extraction...`);

for (const batch of batchesData.batches) {
  const inputData = {
    projectRoot: projectRoot,
    batchFiles: batch.files,
    batchImportData: batch.batchImportData
  };
  
  const inputFile = path.join(tmpDir, `ua-file-analyzer-input-${batch.batchIndex}.json`);
  fs.writeFileSync(inputFile, JSON.stringify(inputData, null, 2));
  
  const outputFile = path.join(tmpDir, `ua-file-extract-results-${batch.batchIndex}.json`);
  
  console.log(`Running extraction for Batch ${batch.batchIndex}...`);
  try {
    execSync(`node "C:\\Users\\Owner\\.understand-anything-plugin\\skills\\understand\\extract-structure.mjs" "${inputFile}" "${outputFile}"`, { stdio: 'inherit' });
  } catch (error) {
    console.error(`Failed extraction for batch ${batch.batchIndex}`);
  }
}

console.log('All extractions complete.');
