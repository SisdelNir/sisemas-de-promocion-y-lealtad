const fs = require('fs');
let localStorageData = {};
global.localStorage = {
  getItem: (k) => localStorageData[k] || null,
  setItem: (k, v) => localStorageData[k] = v,
  removeItem: (k) => delete localStorageData[k]
};
const code = fs.readFileSync('dashboard.js', 'utf-8');
// Mock DOM
global.document = {
  getElementById: () => ({value: ''}),
  addEventListener: () => {},
  querySelector: () => ({style: {}}),
  querySelectorAll: () => []
};
global.window = {};

// Eval the parts we care about or just check the logic 
