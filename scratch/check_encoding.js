const fs = require('fs');

function check(file) {
  const buf = fs.readFileSync(file);
  console.log(file);
  console.log('  Length:', buf.length);
  console.log('  First 10 bytes:', Array.from(buf.slice(0, 10)).map(b => b.toString(16).padStart(2, '0')).join(' '));
  if (buf[0] === 0xff && buf[1] === 0xfe) {
    console.log('  Detected: UTF-16 LE with BOM!');
  } else if (buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) {
    console.log('  Detected: UTF-8 with BOM');
  } else {
    console.log('  Detected: UTF-8 or ASCII');
  }
}

check('c:/Users/USER/OneDrive/Desktop/JAGAN/FINAL_CLEAN_SOLUTION.patch');
check('c:/Users/USER/OneDrive/Desktop/JAGAN/FINAL_CLEAN_TEST.patch');
check('c:/Users/USER/OneDrive/Desktop/JAGAN/FINAL_SUBMISSION_solution.patch');
check('c:/Users/USER/OneDrive/Desktop/JAGAN/solution.patch');
check('c:/Users/USER/OneDrive/Desktop/JAGAN/test.patch');
