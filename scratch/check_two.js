const fs = require('fs');
function check(p) {
  const buf = fs.readFileSync(p);
  console.log(p, buf.length, 'bytes, UTF-16 BOM:', buf[0]===0xff && buf[1]===0xfe);
}
check('c:/Users/USER/OneDrive/Desktop/JAGAN/VERIFIED_solution.patch');
check('c:/Users/USER/OneDrive/Desktop/JAGAN/FINAL_CLEAN_TEST.patch');
