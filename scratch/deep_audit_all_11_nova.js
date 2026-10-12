const fs = require('fs');
const path = require('path');
const AdmZip = require('../superagent/node_modules/adm-zip');

const ROOT = 'C:/Users/USER/OneDrive/Desktop/JAGAN';
const ZIP_PATH = path.join(ROOT, 'FIXED_agent-runs-KALI-MONSHA.zip');

const zip = new AdmZip(ZIP_PATH);
const agents = [
  'Nova_Nova_1',
  'Nova_Nova_2',
  'Nova_Nova_3',
  'Nova_Nova_4',
  'Nova_Nova_5',
  'Nova_Nova_6',
  'Nova_Nova_7',
  'Nova_Nova_8',
  'Nova_Nova_9',
  'Nova_Nova_10',
  'Orion_Nova'
];

console.log('='.repeat(80));
console.log('DEEP AUDIT OF ALL 11 NOVA AGENTS IN FIXED_agent-runs-KALI-MONSHA.zip');
console.log('='.repeat(80));

const auditReport = [];

for (const agent of agents) {
  const evalEntry = zip.getEntry(`${agent}/eval-result.json`);
  const patchEntry = zip.getEntry(`${agent}/solution-patch.patch`);
  const junitEntry = zip.getEntry(`${agent}/junit-new.xml`);
  const runEntry = zip.getEntry(`${agent}/run.txt`);
  const logEntry = zip.getEntry(`${agent}/test-log.txt`);
  const trajEntry = zip.getEntry(`${agent}/trajectory.json`);

  let evalData = {};
  if (evalEntry) {
    try {
      evalData = JSON.parse(evalEntry.getData().toString('utf8'));
    } catch (e) {
      evalData = { error: e.message };
    }
  }

  let patchContent = patchEntry ? patchEntry.getData().toString('utf8') : '';
  const modifiedFiles = [];
  const diffMatches = patchContent.match(/diff --git a\/(.*?) b\/(.*?)/g) || [];
  diffMatches.forEach(m => {
    const file = m.replace('diff --git a/', '').split(' ')[0];
    modifiedFiles.push(file);
  });

  // Feature analysis of the patch
  const hasMaxRequestSize = patchContent.includes('maxRequestSize');
  const hasMaxResponseSize = patchContent.includes('maxResponseSize');
  const hasHasSizeError = patchContent.includes('hasSizeError');
  const hasETOOLARGE = patchContent.includes('ETOOLARGE');
  const hasFormDataBlob = patchContent.includes('buildFormDataBlob') || patchContent.includes('_formDataBlob');
  const hasMultipartSpool = patchContent.includes('_formDataTmpPath') || patchContent.includes('_formDataSpoolPromise');
  const hasCharsetDecoded = patchContent.includes('getTextDecodedByteLength') || patchContent.includes('Shift_JIS') || patchContent.includes('GBK');
  const hasUnbufferedGuard = patchContent.includes('_pendingUnbufferedResponse');
  const hasBodylessStatus = patchContent.includes('1223') && patchContent.includes('304');

  auditReport.push({
    agent,
    verdict: evalData.verdict,
    summary: evalData.summary,
    passed: evalData.test_results ? evalData.test_results.passed : 0,
    failed: evalData.test_results ? evalData.test_results.failed : 0,
    total: evalData.test_results ? evalData.test_results.total : 0,
    failureCount: evalData.test_results && evalData.test_results.failures ? evalData.test_results.failures.length : 0,
    patchSize: patchContent.length,
    modifiedFiles,
    features: {
      hasMaxRequestSize,
      hasMaxResponseSize,
      hasHasSizeError,
      hasETOOLARGE,
      hasFormDataBlob,
      hasMultipartSpool,
      hasCharsetDecoded,
      hasUnbufferedGuard,
      hasBodylessStatus
    }
  });
}

console.log(JSON.stringify(auditReport, null, 2));

const passCount = auditReport.filter(a => a.verdict && a.verdict.startsWith('PASS')).length;
const failCount = auditReport.filter(a => a.verdict && a.verdict.startsWith('FAIL')).length;

console.log('\n' + '='.repeat(80));
console.log(`TOTAL AGENTS : ${auditReport.length}`);
console.log(`PASSING AGENTS: ${passCount} / ${auditReport.length} (${(passCount / auditReport.length * 100).toFixed(1)}%)`);
console.log(`FAILING AGENTS: ${failCount} / ${auditReport.length} (${(failCount / auditReport.length * 100).toFixed(1)}%)`);
console.log('='.repeat(80));
