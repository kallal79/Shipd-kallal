const fs = require('fs');
const path = require('path');
const BASE = 'c:/Users/USER/OneDrive/Desktop/JAGAN';
const MONSHA = path.join(BASE, 'nova_extracted');

const agents = fs.readdirSync(MONSHA).filter(d => fs.statSync(path.join(MONSHA, d)).isDirectory()).sort();

console.log('Analyzing code of each Nova agent:\n');

for (const agent of agents) {
  const solPath = path.join(MONSHA, agent, 'solution-patch.patch');
  if (!fs.existsSync(solPath)) {
    console.log(`[${agent}] No patch found`);
    continue;
  }
  const content = fs.readFileSync(solPath, 'utf8');
  
  const hasSpoolToDisk = content.includes('spoolFormDataToDisk') || content.includes('mkdtemp');
  const hasForcedArrayBuffer = content.includes('_forcedArrayBufferForSize');
  const hasEuroGbk = content.includes('0x20ac');
  const hasUnusedHelper = content.includes('isReplayableFormData');
  const hasStreamingDoubleCallbackGuard = content.includes('this.called') && content.includes('_retry');
  const hasUnbufferedResume = content.includes('res.resume()') && content.includes('unbuffered');
  
  console.log(`[${agent}]`);
  console.log(`  - Spool to disk (mkdtemp/streaming safety): ${hasSpoolToDisk}`);
  console.log(`  - Forced ArrayBuffer for CORS/BOM text mode: ${hasForcedArrayBuffer}`);
  console.log(`  - GBK 0x20ac Euro support: ${hasEuroGbk}`);
  console.log(`  - Unused isReplayableFormData: ${hasUnusedHelper}`);
  console.log(`  - Double callback on retry guard: ${hasStreamingDoubleCallbackGuard}`);
  console.log(`  - Exhausts unbuffered streams (res.resume bug): ${hasUnbufferedResume}`);
}
