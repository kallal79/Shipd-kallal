const fs = require('fs');
const buf = fs.readFileSync('c:/Users/USER/OneDrive/Desktop/JAGAN/FINAL_CLEAN_SOLUTION.patch');
let text = buf[0] === 0xff && buf[1] === 0xfe ? buf.toString('utf16le') : buf.toString('utf8');
const lines = text.split('\n');
for (let i = 2840; i <= 2890 && i < lines.length; i++) {
  console.log(i + ': ' + lines[i]);
}
