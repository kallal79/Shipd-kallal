const assert = require('assert');
const http = require('http');
const request = require('C:/Users/USER/OneDrive/Desktop/JAGAN/superagent');

process.on('uncaughtException', (err) => {
  console.error('*** CAUGHT UNCAUGHT EXCEPTION ***:', err.stack || err);
});

// Let's test all routes in size_limits_compliance_b5e2d.js on unpatched superagent
console.log('Testing unpatched superagent for unhandled socket errors...');
