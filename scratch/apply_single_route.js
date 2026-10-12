const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, '..', 'superagent', 'src', 'node', 'index.js');
let content = fs.readFileSync(file, 'utf8');

const target = `  if (type === 'response' && this.res) {
    if (this.response) {
      if (this.response.listeners('error').length > 0) {
        this.response.emit('error', error);
      } else {
        this.response.once('error', () => {});
      }
    }
    this.res.emit('error', error);
    if (typeof this.res.destroy === 'function') {
      this.res.destroy(error);
    }
  }`;

const replacement = `  if (type === 'response' && this.res) {
    if (!this.res._sizeErrorDestroyed) {
      this.res._sizeErrorDestroyed = true;
      if (this.response && this.response.listeners('error').length === 0) {
        this.response.once('error', () => {});
      }
      if (typeof this.res.destroy === 'function') {
        this.res.destroy(error);
      } else {
        this.res.emit('error', error);
      }
    }
  }`;

if (content.includes(target)) {
  content = content.replace(target, replacement);
  fs.writeFileSync(file, content, 'utf8');
  console.log('Replaced successfully.');
} else {
  console.log('Target not found!');
}
