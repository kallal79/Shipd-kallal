const fs = require('fs');
const path = require('path');

const monshaDir = 'C:/Users/USER/OneDrive/Desktop/JAGAN/extracted_monsha';
const cleanSol = fs.readFileSync('C:/Users/USER/OneDrive/Desktop/JAGAN/FINAL_CLEAN_SOLUTION.patch', 'utf8').replace(/\r\n/g, '\n');

const passing = ['Nova_Nova_1', 'Nova_Nova_8', 'Nova_Nova_10', 'Orion_Nova'];

for (const p of passing) {
  const patchPath = path.join(monshaDir, p, 'solution-patch.patch');
  const agentPatch = fs.readFileSync(patchPath, 'utf8').replace(/\r\n/g, '\n');
  const isIdentical = agentPatch === cleanSol;
  const hasProto = agentPatch.includes('Response.prototype');
  const hasQueued = agentPatch.includes('queuedChunks');
  const hasReplay = agentPatch.includes('needsMultipartReplay');
  console.log(`${p}: isIdentical=${isIdentical} hasResponseProto=${hasProto} hasQueuedChunks=${hasQueued} hasNeedsMultipartReplay=${hasReplay} patchLength=${agentPatch.length}`);
}
