const fs = require('fs');
const path = require('path');
const MONSHA = 'C:/Users/USER/OneDrive/Desktop/JAGAN/extracted_monsha';

const agents = [
  'Nova_Nova_1', 'Nova_Nova_2', 'Nova_Nova_3', 'Nova_Nova_4',
  'Nova_Nova_5', 'Nova_Nova_6', 'Nova_Nova_7', 'Nova_Nova_8',
  'Nova_Nova_9', 'Nova_Nova_10', 'Orion_Nova'
];

console.log('=== DETAILED ANALYSIS OF ALL AGENTS ===\n');

for (const a of agents) {
  const dir = path.join(MONSHA, a);
  const evalJson = JSON.parse(fs.readFileSync(path.join(dir, 'eval-result.json'), 'utf8'));
  const patch = fs.existsSync(path.join(dir, 'solution-patch.patch')) 
    ? fs.readFileSync(path.join(dir, 'solution-patch.patch'), 'utf8') 
    : '';
  
  console.log(`--- [${a}] ---`);
  console.log(`Verdict:     ${evalJson.verdict}`);
  console.log(`Tests:       ${evalJson.test_results.passed}/${evalJson.test_results.total} passed`);
  console.log(`Patch Size:  ${patch.length} bytes`);
  console.log(`Unfair:      ${evalJson.environment_assessment.agent_blame_unfair || false}`);
  console.log(`Blockers:    ${evalJson.environment_assessment.blocker_type}`);
  
  // Analyze what features the patch touched
  const touchedFiles = [];
  const matches = patch.match(/diff --git a\/([^\s]+)/g) || [];
  for (const m of matches) {
    touchedFiles.push(m.replace('diff --git a/', ''));
  }
  console.log(`Touched:     ${touchedFiles.join(', ')}`);
  
  // Feature checks
  const hasMaxReq = patch.includes('maxRequestSize');
  const hasMaxRes = patch.includes('maxResponseSize');
  const hasSizeErr = patch.includes('hasSizeError');
  const hasDirection = patch.includes('direction');
  const hasUnzip = patch.includes('unzip') || touchedFiles.includes('src/node/unzip.js');
  const hasMultipart = patch.includes('isReplayableFormData') || patch.includes('serializeFormData') || patch.includes('buildFormDataBlob');
  const hasBOM = patch.includes('getTextDecodedByteLength');
  
  console.log(`Features:    maxReq=${hasMaxReq}, maxRes=${hasMaxRes}, hasSizeErr=${hasSizeErr}, dir=${hasDirection}, unzip=${hasUnzip}, multipart=${hasMultipart}, BOM=${hasBOM}`);
  const summaryText = evalJson.summary || evalJson.justification || '';
  console.log(`Summary:     ${summaryText.slice(0, 150)}...`);
  console.log('');
}
