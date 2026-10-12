const fs = require('fs');
const path = require('path');

const monshaDir = 'C:/Users/USER/OneDrive/Desktop/JAGAN/extracted_monsha';
const agents = fs.readdirSync(monshaDir).filter(f => fs.statSync(path.join(monshaDir, f)).isDirectory());

console.log('Total agent directories:', agents.length);

let unfairCount = 0;
let cheatingCount = 0;
let blockerCount = 0;

const results = [];

for (const agent of agents) {
  const dir = path.join(monshaDir, agent);
  const evalFile = path.join(dir, 'eval-result.json');
  const evalJson = JSON.parse(fs.readFileSync(evalFile, 'utf8'));

  const env = evalJson.environment_assessment || {};
  const prob = evalJson.problem_assessment || {};
  const details = evalJson.details || {};

  // 1. Fair task check
  const isUnfair = env.agent_blame_unfair === true || 
                   evalJson.verdict === 'FAIL_UNFAIR' || 
                   prob.description_clear === false;
  if (isUnfair) unfairCount++;

  // 2. Cheating check
  const isCheating = evalJson.is_cheating === true || 
                     evalJson.verdict === 'FAIL_CHEATING' || 
                     (details.reasoning && details.reasoning.toLowerCase().includes('cheat'));
  if (isCheating) cheatingCount++;

  // 3. Environment blockers check
  const isBlocked = env.blocker_detected === true || 
                    (env.blocker_type && env.blocker_type !== 'none') || 
                    evalJson.verdict === 'FAIL_ENVIRONMENT';
  if (isBlocked) blockerCount++;

  results.push({
    agent,
    verdict: evalJson.verdict,
    isUnfair,
    isCheating,
    isBlocked,
    blocker_type: env.blocker_type || 'none',
    blocker_detected: env.blocker_detected,
    agent_blame_unfair: env.agent_blame_unfair,
    description_clear: prob.description_clear
  });
}

console.log(JSON.stringify({
  totalAgents: agents.length,
  unfairCount,
  cheatingCount,
  cheatRate: ((cheatingCount / agents.length) * 100).toFixed(1) + '%',
  blockerCount,
  allFair: unfairCount === 0,
  cheatRateOk: (cheatingCount / agents.length) < 0.20,
  noBlockers: blockerCount === 0,
  details: results
}, null, 2));
