const fs = require('fs');
const path = require('path');

const base = 'extracted_monsha';
const failingAgents = ['Nova_Nova_2', 'Nova_Nova_3', 'Nova_Nova_4', 'Nova_Nova_5', 'Nova_Nova_6', 'Nova_Nova_7', 'Nova_Nova_9'];

for (const name of failingAgents) {
  const patchFile = path.join(base, name, 'solution-patch.patch');
  if (fs.existsSync(patchFile)) {
    const content = fs.readFileSync(patchFile, 'utf8');
    console.log(`========================================`);
    console.log(`Agent: ${name} (Patch size: ${content.length} bytes)`);
    
    // Check key features in the patch
    const hasMaxRequestSize = content.includes('maxRequestSize');
    const hasMaxResponseSize = content.includes('maxResponseSize');
    const hasSizeError = content.includes('hasSizeError');
    const hasETOOLARGE = content.includes('ETOOLARGE');
    const hasFormData = content.includes('FormData') || content.includes('_formData');
    const hasRedirect = content.includes('redirect') || content.includes('_redirect');
    const hasDecompress = content.includes('decompress') || content.includes('unzip');
    const hasRetry = content.includes('retry') || content.includes('_shouldRetry');
    const hasUnbuffered = content.includes('buffer(false)') || content.includes('_resBuffered');

    console.log({
      hasMaxRequestSize,
      hasMaxResponseSize,
      hasSizeError,
      hasETOOLARGE,
      hasFormData,
      hasRedirect,
      hasDecompress,
      hasRetry,
      hasUnbuffered
    });

    // Check files modified in the patch
    const modifiedFiles = [];
    const lines = content.split('\n');
    for (const l of lines) {
      if (l.startsWith('diff --git')) {
        modifiedFiles.push(l.trim());
      }
    }
    console.log('Modified files:', modifiedFiles);
  } else {
    console.log(`Agent: ${name} - NO PATCH FOUND!`);
  }
}
