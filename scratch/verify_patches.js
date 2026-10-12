const fs = require('fs');

function checkFile(p) {
  const buf = fs.readFileSync(p);
  console.log(p);
  console.log('Bytes:', buf.length);
  console.log('First 4 bytes:', buf[0], buf[1], buf[2], buf[3]);
  const isUtf16 = (buf[0] === 0xff && buf[1] === 0xfe);
  console.log('Is UTF-16:', isUtf16);
  const text = buf.toString('utf8');
  const files = new Set();
  text.split('\n').forEach(line => {
    if (line.startsWith('diff --git')) {
      files.add(line);
    }
  });
  console.log('Touched files:');
  files.forEach(f => console.log('  ' + f));
}

checkFile('c:/Users/USER/OneDrive/Desktop/JAGAN/FINAL_CLEAN_SOLUTION.patch');
checkFile('c:/Users/USER/OneDrive/Desktop/JAGAN/FINAL_TEST_PATCH_READY_TO_SUBMIT.patch');
