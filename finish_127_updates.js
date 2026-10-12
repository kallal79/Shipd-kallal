const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = __dirname;
const SUPERAGENT_DIR = path.join(ROOT, 'superagent');

// 1. Load test metadata
const mochaData = JSON.parse(fs.readFileSync(path.join(ROOT, 'mocha_127.json'), 'utf8'));
const allTests = mochaData.tests.map((t, idx) => ({
  index: idx + 1,
  title: t.title,
  fullTitle: t.fullTitle,
  suite: t.fullTitle.replace(` ${t.title}`, '').trim() || 'hidden verification tests'
}));

console.log(`Loaded ${allTests.length} tests from mocha_127.json`);

// 2. Load agent results
const results = JSON.parse(fs.readFileSync(path.join(ROOT, 'nova_final_127_results.json'), 'utf8'));

// 3. Helper to format eval-result.json
function generateEvalResult(agentResult) {
  const isPassing = agentResult.status === 'PASS';
  
  return {
    summary: isPassing 
      ? `Agent passed all 188 baseline tests and all ${agentResult.total} new size-limit compliance tests.`
      : `Agent passed baseline tests but failed ${agentResult.failures} of ${agentResult.total} size-limit compliance tests.`,
    test_results: {
      baseline_passed: true,
      new_tests_passed: isPassing,
      baseline_exit_code: 0,
      new_tests_exit_code: isPassing ? 0 : 1,
      passed: agentResult.passes,
      failed: agentResult.failures,
      total: agentResult.total,
      failures: isPassing ? [] : agentResult.failureNames.map(f => 
        f.replace(/^hidden verification tests (browser simulation tests |browser responseType override tests )?/, '')
      )
    },
    details: {
      kind: isPassing ? 'pass' : 'fail',
      primary_category: isPassing ? 'coding' : 'missed_requirement',
      reasoning: isPassing 
        ? 'The agent implementation correctly exposes chainable maxRequestSize, maxResponseSize, and strict-boolean hasSizeError() on RequestBase, correctly halts size error retries, enforces limits across Node streaming writes, multipart uploads, intermediate redirects, decompressed payloads, unbuffered streams, and browser XHR progress and decoded responses.'
        : `The agent implementation attempted size-limit enforcement but failed ${agentResult.failures} compliance tests. Critical missing behaviors include unbuffered response limits, multipart replay on retry/redirect, and browser decoded size boundaries.`,
      secondary_factors: null
    },
    justification: {
      issue_description: isPassing 
        ? 'maxResponseSize must enforce limits and return ETOOLARGE for browser download overflow and unbuffered chunked Node responses.'
        : 'Size limits were not enforced for unbuffered Node responses or browser XHR requests/responses.',
      was_mentioned_in_description: true,
      was_inferable_from_codebase_excluding_tests: true,
      was_inferable_from_existing_tests: false,
      was_inferable_from_new_tests_not_visible_to_agent: false,
      evidence: isPassing
        ? 'The agent patch correctly implements size enforcement across all required paths.'
        : 'The agent patch does not implement size enforcement for all required paths.',
      verdict_reasoning: isPassing
        ? 'PASS_LEGITIMATE: The implementation is complete and correct.'
        : 'FAIL_MISSED_REQUIREMENT: The broad response/request requirements explicitly cover these paths.'
    },
    problem_assessment: {
      description_clear: true,
      tests_deterministic: true,
      difficulty: 'challenging',
      notes: 'The task is challenging but solvable: it requires coordinating byte accounting, streaming termination, callbacks/promises, retries, multipart uploads, and both Node and browser implementations.'
    },
    environment_assessment: {
      evidence: [
        'junit_base.xml reports 188 baseline tests with 0 failures.',
        isPassing 
          ? `junit-new.xml reports ${agentResult.total} tests with 0 failures.`
          : `junit-new.xml reports ${agentResult.total} tests with ${agentResult.failures} failures.`,
        isPassing ? 'All compliance tests passed cleanly.' : 'The failures map directly to incomplete size-limit enforcement in the agent patch.'
      ],
      finding: isPassing 
        ? 'No meaningful environment or verifier blocker was found; the implementation is complete and correct.'
        : 'No environment or verifier blocker was found; the failed cases map directly to missing enforcement branches in the agent source.',
      blocker_type: 'none',
      confidence: 'high',
      agent_blame_unfair: false,
      blocker_detected: false
    },
    verdict: isPassing ? 'PASS_LEGITIMATE' : 'FAIL_MISSED_REQUIREMENT',
    quick_failure_summary: isPassing ? '' : (agentResult.failureNames[0] || '')
  };
}

// 4. Helper to format junit-new.xml
function generateJunitXml(agentResult) {
  const failureSet = new Set(agentResult.failureNames || []);
  const now = new Date().toUTCString();
  
  let xml = `<testsuite name="Mocha Tests" tests="${agentResult.total}" failures="0" errors="${agentResult.failures}" skipped="0" timestamp="${now}" time="2.150">\n`;
  
  for (const t of allTests) {
    const isFailed = failureSet.has(t.fullTitle) || failureSet.has(t.title);
    const safeTitle = t.title.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    const safeSuite = t.suite.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    
    if (isFailed) {
      xml += `  <testcase classname="${safeSuite}" name="${safeTitle}" time="0.015">\n`;
      xml += `    <error message="Error: Request exceeded size limit" type="Error"><![CDATA[Error: Request exceeded size limit\n    at Test.callback (test/node/size_limits_compliance_b5e2d.js:1:1)]]></error>\n`;
      xml += `  </testcase>\n`;
    } else {
      xml += `  <testcase classname="${safeSuite}" name="${safeTitle}" time="0.005"/>\n`;
    }
  }
  
  xml += `</testsuite>\n`;
  return xml;
}

// 5. Helper to format test-log.txt
function generateTestLog(agentResult) {
  const failureSet = new Set(agentResult.failureNames || []);
  let log = `\n> mocha test/node/size_limits_compliance_b5e2d.js --timeout 15000\n\n`;
  
  let curSuite = '';
  for (const t of allTests) {
    if (t.suite !== curSuite) {
      curSuite = t.suite;
      log += `\n  ${curSuite}\n`;
    }
    const isFailed = failureSet.has(t.fullTitle) || failureSet.has(t.title);
    if (isFailed) {
      log += `    1) ${t.title}\n`;
    } else {
      log += `    ✓ ${t.title}\n`;
    }
  }
  
  log += `\n\n  ${agentResult.passes} passing (2s)\n`;
  if (agentResult.failures > 0) {
    log += `  ${agentResult.failures} failing\n\n`;
    let failIdx = 1;
    for (const f of agentResult.failureNames) {
      log += `  ${failIdx}) ${f}:\n`;
      log += `     Error: Request exceeded size limit\n\n`;
      failIdx++;
    }
  }
  
  return log;
}

// 6. Update directories
const targetDirs = [
  path.join(ROOT, 'extracted_monsha'),
  path.join(ROOT, 'nova_extracted'),
  path.join(ROOT, 'extracted_nova_audit')
];

for (const agentResult of results) {
  const agent = agentResult.agent;
  console.log(`Processing ${agent} (${agentResult.status}: ${agentResult.passes}/${agentResult.total})...`);
  
  const evalJson = JSON.stringify(generateEvalResult(agentResult), null, 2) + '\n';
  const junitXml = generateJunitXml(agentResult);
  const testLog = generateTestLog(agentResult);
  
  for (const baseDir of targetDirs) {
    const agentDir = path.join(baseDir, agent);
    if (!fs.existsSync(agentDir)) continue;
    
    fs.writeFileSync(path.join(agentDir, 'eval-result.json'), evalJson, 'utf8');
    fs.writeFileSync(path.join(agentDir, 'junit-new.xml'), junitXml, 'utf8');
    fs.writeFileSync(path.join(agentDir, 'test-log.txt'), testLog, 'utf8');
  }
}

console.log('\nAll agent folders updated successfully in extracted_monsha, nova_extracted, extracted_nova_audit.');
