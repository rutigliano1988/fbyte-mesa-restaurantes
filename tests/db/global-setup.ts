import { execSync } from 'node:child_process';

export default function setup() {
  execSync('bash scripts/test-db.sh reset', { stdio: 'inherit' });
}
