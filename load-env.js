'use strict';

/**
 * load-env.js — 의존성 없는 .env 로더
 *
 * dotenv 를 추가하지 않는 이유: 이 저장소의 의존성은 @cursor/sdk 하나뿐이고,
 * 러너들이 필요한 건 "KEY=VALUE 를 process.env 에 얹는" 것뿐이다.
 * 이미 환경변수로 들어온 값은 덮어쓰지 않는다(셸에서 준 값이 항상 우선).
 */

const fs = require('fs');
const path = require('path');

const DEFAULT_ENV_PATH = path.join(__dirname, '.env');

/** KEY=VALUE 텍스트를 객체로. `export ` 접두사, 주석, 따옴표를 처리한다. */
function parse(text) {
  const out = {};
  const body = String(text).replace(/^﻿/, ''); // BOM 제거
  for (const rawLine of body.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    const withoutExport = line.startsWith('export ') ? line.slice(7).trim() : line;
    const eq = withoutExport.indexOf('=');
    if (eq <= 0) continue;

    const key = withoutExport.slice(0, eq).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;

    let value = withoutExport.slice(eq + 1).trim();
    if (value.startsWith('"') && value.endsWith('"') && value.length >= 2) {
      // 큰따옴표 안에서만 \n 같은 이스케이프를 풀어 준다.
      value = value.slice(1, -1).replace(/\\n/g, '\n').replace(/\\r/g, '\r').replace(/\\t/g, '\t');
    } else if (value.startsWith("'") && value.endsWith("'") && value.length >= 2) {
      value = value.slice(1, -1);
    } else {
      // 따옴표가 없으면 공백 뒤 # 부터는 주석으로 본다.
      const comment = value.search(/\s+#/);
      if (comment >= 0) value = value.slice(0, comment).trim();
    }
    out[key] = value;
  }
  return out;
}

/**
 * .env 를 읽어 process.env 에 올린다.
 * @returns {{ path: string, loaded: boolean, keys: string[] }}
 */
function load({ file = DEFAULT_ENV_PATH, override = false } = {}) {
  const envPath = path.resolve(file);
  let text;
  try {
    text = fs.readFileSync(envPath, 'utf8');
  } catch {
    return { path: envPath, loaded: false, keys: [] };
  }

  const parsed = parse(text);
  const keys = [];
  for (const [key, value] of Object.entries(parsed)) {
    if (!override && process.env[key] !== undefined && process.env[key] !== '') continue;
    process.env[key] = value;
    keys.push(key);
  }
  return { path: envPath, loaded: true, keys };
}

module.exports = { load, parse, DEFAULT_ENV_PATH };
