import fs from 'node:fs';
const required = ['app/page.jsx', 'app/globals.css', 'components/ForceApp.jsx', 'pages/api/[...path].js'];
const missing = required.filter((file) => !fs.existsSync(file));
if (missing.length) {
  console.error('Missing files:', missing.join(', '));
  process.exit(1);
}
console.log('Static check passed.');
