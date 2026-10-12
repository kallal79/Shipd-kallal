const fs = require('fs');
const readline = require('readline');

const stream = fs.createReadStream('C:/Users/USER/.gemini/antigravity-ide/brain/18770d27-2f9e-4ed3-ada8-0641fdba1fb2/.system_generated/logs/transcript_full.jsonl');
const rl = readline.createInterface({ input: stream });

rl.on('line', (line) => {
  try {
    const obj = JSON.parse(line);
    if (obj.step_index === 19301) {
      fs.writeFileSync('c:/Users/USER/OneDrive/Desktop/JAGAN/scratch/issue_19301.txt', obj.content);
    }
  } catch(e) {}
});
rl.on('close', () => {
  console.log('Saved 19301');
});
