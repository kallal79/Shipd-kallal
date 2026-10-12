const fs = require('fs');
const path = require('path');
const cp = require('child_process');

const monshaDir = 'C:/Users/USER/OneDrive/Desktop/JAGAN/extracted_monsha';
const callbackDir = 'C:/Users/USER/OneDrive/Desktop/JAGAN/extracted_callback';

console.log('=== INSPECTING MONSHA AGENTS ===');
for (const agent of fs.readdirSync(monshaDir)) {
  const p = path.join(monshaDir, agent);
  if (!fs.statSync(p).isDirectory()) continue;
  const patchFile = fs.existsSync(path.join(p, 'solution-patch.patch'))
    ? path.join(p, 'solution-patch.patch')
    : path.join(p, 'solution.patch');
  if (fs.existsSync(patchFile)) {
    const content = fs.readFileSync(patchFile, 'utf8');
    const hasCallbackOverride = content.includes('if (this._sizeError) error = this._sizeError') || content.includes('this._sizeError');
    const hasHasSizeError = content.includes('hasSizeError');
    const lines = content.split('\n').length;
    console.log(`${agent.padEnd(16)}: patch size=${content.length}b, lines=${lines}, hasSizeError=${hasHasSizeError}, sizeErrorInCallback=${hasCallbackOverride}`);
  } else {
    console.log(`${agent.padEnd(16)}: NO PATCH`);
  }
}

console.log('\n=== INSPECTING CALLBACK AGENTS ===');
for (const agent of fs.readdirSync(callbackDir)) {
  const p = path.join(callbackDir, agent);
  if (!fs.statSync(p).isDirectory()) continue;
  const patchFile = fs.existsSync(path.join(p, 'solution-patch.patch'))
    ? path.join(p, 'solution-patch.patch')
    : path.join(p, 'solution.patch');
  if (fs.existsSync(patchFile)) {
    const content = fs.readFileSync(patchFile, 'utf8');
    const hasCallbackOverride = content.includes('if (this._sizeError) error = this._sizeError') || content.includes('this._sizeError');
    const hasHasSizeError = content.includes('hasSizeError');
    const lines = content.split('\n').length;
    console.log(`${agent.padEnd(16)}: patch size=${content.length}b, lines=${lines}, hasSizeError=${hasHasSizeError}, sizeErrorInCallback=${hasCallbackOverride}`);
  } else {
    console.log(`${agent.padEnd(16)}: NO PATCH`);
  }
}
