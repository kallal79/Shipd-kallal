const fs = require('fs');
const readline = require('readline');
const rl = readline.createInterface({
  input: fs.createReadStream('C:/Users/USER/.gemini/antigravity-ide/brain/18770d27-2f9e-4ed3-ada8-0641fdba1fb2/.system_generated/logs/transcript.jsonl'),
  crlfDelay: Infinity
});

rl.on('line', (line) => {
  if (line.includes('"step_index":16249')) {
    const obj = JSON.parse(line);
    console.log('Length of user input:', obj.content.length);
    console.log('--- LAST 4000 CHARS ---');
    console.log(obj.content.slice(-4000));
  }
});
