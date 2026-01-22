import fs from 'fs';
import path from 'path';

const abiPath = path.resolve(__dirname, '../../frontend/onchain/ExchangeABI.ts');
const abiSource = fs.readFileSync(abiPath, 'utf8');
const match = abiSource.match(/EXCHANGE_ABI\s*=\s*(\[[\s\S]*?\])\s*as const;/);
if (!match) {
    throw new Error(`Failed to load EXCHANGE_ABI from ${abiPath}`);
}

// Avoid ESM/CJS interop issues by parsing the generated ABI directly.
export const EXCHANGE_ABI = JSON.parse(match[1]) as unknown[];
