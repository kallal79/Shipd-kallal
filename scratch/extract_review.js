const fs = require('fs');
const readline = require('readline');

const rl = readline.createInterface({
  input: fs.createReadStream('C:/Users/USER/.gemini/antigravity-ide/brain/18770d27-2f9e-4ed3-ada8-0641fdba1fb2/.system_generated/logs/transcript_full.jsonl')
});

rl.on('line', line => {
  if (line.includes('Browser size errors on a retry')) {
    const obj = JSON.parse(line);
    // Find the text content
    let text = obj.content;
    if (typeof text !== 'string') {
      text = JSON.stringify(obj, null, 2);
    }
    fs.writeFileSync('scratch/last_review.txt', text);
    console.log('Saved to scratch/last_review.txt, length:', text.length);
    process.exit(0);
  }
});
