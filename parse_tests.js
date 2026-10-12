const fs = require('fs');
const path = require('path');

const MONSHA = 'C:/Users/USER/OneDrive/Desktop/JAGAN/extracted_monsha';
const n1Xml = fs.readFileSync(path.join(MONSHA, 'Nova_Nova_1', 'junit-new.xml'), 'utf8');

const regex = /<testcase classname="([^"]+)" name="([^"]+)"/g;
const testList = [];
let m;
while ((m = regex.exec(n1Xml)) !== null) {
  testList.push({ classname: m[1], title: m[2] });
}

console.log('Total test cases found in Nova_Nova_1:', testList.length);
console.log('First 3:', testList.slice(0, 3));
console.log('Last 3:', testList.slice(-3));

fs.writeFileSync('C:/Users/USER/OneDrive/Desktop/JAGAN/all_81_tests.json', JSON.stringify(testList, null, 2), 'utf8');
