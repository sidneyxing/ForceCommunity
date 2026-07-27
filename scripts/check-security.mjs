import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const read = (file) => readFileSync(join(root, file), 'utf8');
const api = read('pages/api/[...path].js');
const envExample = read('.env.example');
const app = read('components/ForceApp.jsx');
const duel = read('components/ForceDuelEnhancer.jsx');
const features = read('components/ForceFeaturePages.jsx');
const schema = read('supabase/schema.sql');
const migration = read('supabase/migrations/20260717_security_hardening.sql');
const nextConfig = read('next.config.js');

const failures = [];
const requireText = (label, source, value) => {
  if (!source.includes(value)) failures.push(`${label}: missing ${value}`);
};
const forbidText = (label, source, value) => {
  if (source.includes(value)) failures.push(`${label}: forbidden ${value}`);
};

forbidText('environment', envExample, 'SUPABASE_ANON_KEY');
forbidText('API', api, 'process.env.SUPABASE_ANON_KEY');
forbidText('ForceApp', app, 'localStorage');
forbidText('ForceApp', app, 'sessionToken');
forbidText('ForceDuelEnhancer', duel, 'localStorage');
forbidText('ForceFeaturePages', features, 'localStorage');
if (existsSync(join(root, 'public/legacy/app.legacy.js'))) failures.push('legacy browser Supabase client still exists');

requireText('API', api, 'const SESSION_DAYS = 30;');
requireText('API', api, 'const SESSION_ROTATION_DAYS = 7;');
requireText('cookie', api, 'HttpOnly; SameSite=Lax; Priority=High');
requireText('origin', api, 'assertTrustedOrigin(req, method, path)');
requireText('duel RPC', api, 'force_submit_duel_answer');
requireText('worker', api, 'req.headers["x-worker-secret"]');
requireText('worker method', api, 'path === "/worker/drain" && method !== "POST"');
requireText('schema privileges', schema, 'revoke all on schema public from PUBLIC, anon, authenticated;');
requireText('migration privileges', migration, 'revoke all privileges on all functions in schema public from PUBLIC, anon, authenticated;');
requireText('default privileges', migration, 'alter default privileges for role postgres in schema public');
requireText('CSP', nextConfig, 'Content-Security-Policy');
requireText('HSTS', nextConfig, 'Strict-Transport-Security');
requireText('clickjacking', nextConfig, "frame-ancestors 'none'");

if (failures.length) {
  console.error('Security check failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log('Security check passed.');
