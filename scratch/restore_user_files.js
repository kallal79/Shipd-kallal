const fs = require('fs');
const readline = require('readline');
const path = require('path');

const targets = [
  'nova_audit_verified.md',
  'pure_nova_runner_local.js',
  'pure_nova_runner_updated.js',
  'create_test_patch.js',
  'fix_hidden_verify.js',
  'add_test.js',
  'clean3.js',
  'clean2.js',
  'clean.js',
  'eval.js',
  'stub_t21.js',
  'eval_callback_agents.js',
  'create_artifacts.js',
  'stub_tests_again.js'
];

function cleanViewedFileContent(text) {
  // Strip "Created At...", "Completed At...", "File Path...", "Showing lines...", and line numbers "123: "
  const lines = text.split('\n');
  const codeLines = [];
  let inCode = false;
  for (const line of lines) {
    if (line.startsWith('Showing lines ') || line.startsWith('The following code has been modified')) {
      inCode = true;
      continue;
    }
    if (line.startsWith('The above content does NOT show') || line.startsWith('The above content shows the entire')) {
      break;
    }
    if (inCode) {
      const match = line.match(/^\d+:\s?(.*)$/);
      if (match) {
        codeLines.push(match[1]);
      } else {
        codeLines.push(line);
      }
    }
  }
  return codeLines.length > 0 ? codeLines.join('\n') : text;
}

const found = {};

const rl = readline.createInterface({
  input: fs.createReadStream('C:/Users/USER/.gemini/antigravity-ide/brain/f29e6f2f-bcd8-477d-8357-39eab894d1cd/.system_generated/logs/transcript_full.jsonl'),
  crlfDelay: Infinity
});

rl.on('line', (line) => {
  for (const t of targets) {
    if (line.includes(t)) {
      try {
        const obj = JSON.parse(line);
        if (obj.type === 'VIEW_FILE' && obj.content && obj.content.includes(t)) {
          const cleaned = cleanViewedFileContent(obj.content);
          if (!found[t] || (found[t].content && found[t].content.length < cleaned.length)) {
            found[t] = { source: 'VIEW_FILE', content: cleaned, step: obj.step_index };
            console.log('VIEW_FILE:', t, 'step:', obj.step_index, 'len:', cleaned.length);
          }
        }
        if (obj.tool_calls) {
          for (const tc of obj.tool_calls) {
            if (tc.name === 'write_to_file' && tc.args && tc.args.TargetFile && tc.args.TargetFile.endsWith(t)) {
              found[t] = { source: 'write_to_file', content: tc.args.CodeContent, step: obj.step_index };
              console.log('write_to_file:', t, 'step:', obj.step_index, 'len:', tc.args.CodeContent.length);
            }
          }
        }
      } catch (e) {}
    }
  }
});

rl.on('close', () => {
  console.log('\n--- FINAL RECOVERY REPORT ---');
  for (const t of targets) {
    if (found[t]) {
      console.log('RECOVERED:', t, 'from', found[t].source, 'bytes:', found[t].content.length);
    } else {
      console.log('STILL NEEDED:', t);
    }
  }
  fs.writeFileSync('scratch/recovered_files.json', JSON.stringify(found, null, 2));
});
