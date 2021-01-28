import assert from 'assert';
import fs from 'fs';
import path, { sep } from 'path';
import { CompilerOptions } from 'typescript';

import { endOfLine } from '@dozerg/end-of-line';

import { assertNonNull } from '../../lib/common';
import { Configuration, mergeConfig } from '../../lib/config';
import { ESLintConfig, loadESLintConfig } from '../../lib/config/eslint';
import { fileConfig } from '../../lib/config/importSorter';
import { loadTsConfig } from '../../lib/config/tsconfig';
import { formatSource } from '../../lib/format';

interface TestSuite {
  name: string;
  config?: Configuration;
  tsCompOpt?: CompilerOptions;
  cases: TestCase[];
  suites: TestSuite[];
}

interface TestCase {
  name?: string;
  origin?: string; // origin can be undefined in default case
  result?: string;
  eslintConfig?: ESLintConfig;
}

const CONF = 'import-sorter.json';
const TS_CONF = 'tsconfig.json';
const ESLINT_CONF = '.eslintrc.json';

/**
 * If set to true, the result file will be updated if test fails.
 *
 * ! Use it with cautions.
 */
const UPDATE_RESULT = false;

describe('lib/formatSource', () => {
  const dir = path.resolve(__dirname);
  const examples = getTestSuite(dir, 'examples');
  if (!examples) return;
  // Run all tests
  return runTestSuite(examples);
  // Or, run specific test case(s)
  // return runTestSuite(examples, 'eslint');
});

function getTestSuite(dir: string, name: string): TestSuite | undefined {
  const path = dir + sep + name;
  const entries = fs.readdirSync(path, { withFileTypes: true });
  // Search and load 'import-sorter.json' under path.
  const config = entries.find(({ name }) => name === CONF) && fileConfig(path + sep + CONF);
  // Search and load 'tsconfig.json' under path.
  const tsCompOpt =
    entries.find(({ name }) => name === TS_CONF) && loadTsConfig(path + sep + TS_CONF);
  const hasESLintConfig = entries.some(({ name }) => name === ESLINT_CONF);
  const suites = entries
    .filter(e => e.isDirectory())
    .map(({ name }) => getTestSuite(path, name))
    .filter((s): s is TestSuite => !!s);
  const map = new Map<string, TestCase>();
  entries
    .filter(e => e.isFile())
    .forEach(({ name }) => {
      const r = /^(.+\.)?(origin|result)\.[jt]sx?$/.exec(name);
      if (!r) return;
      const [, n, t] = r;
      const p = path + sep + name;
      const k = n ? n.slice(0, n.length - 1) : '';
      const v = map.get(k) ?? { origin: '', name: k ? k : undefined };
      if (t === 'origin') {
        v.origin = p;
        if (hasESLintConfig) v.eslintConfig = loadESLintConfig(p);
      } else v.result = p;
      map.set(k, v);
    });
  return { name, config, tsCompOpt, suites, cases: [...map.values()] };
}

function runTestSuite(ts: TestSuite, specific?: string, preConfig?: Configuration) {
  const { name, config: curConfig, tsCompOpt, cases, suites } = ts;
  const defResult = cases.find(c => !c.name && !c.origin)?.result;
  const config =
    curConfig && preConfig ? mergeConfig(preConfig, curConfig) : curConfig ?? preConfig;
  describe(name, () => {
    if (!specific) {
      cases.forEach(c => runTestCase(c, defResult, config, tsCompOpt));
      suites.forEach(s => runTestSuite(s, undefined, config));
    } else {
      const [n, ...rest] = specific.split('/').filter(s => !!s);
      if (!rest.length) {
        const c = cases.find(c => (c.name ?? 'default') === n);
        if (c) return runTestCase(c, defResult, config, tsCompOpt);
      }
      const s = suites.find(s => s.name === n);
      assertNonNull(s, `Test case/suite '${n}' not found in suite '${name}'`);
      runTestSuite(s, rest.join('/'), config);
    }
  });
}

function runTestCase(
  { name, origin, result, eslintConfig }: TestCase,
  defResult?: string,
  config?: Configuration,
  tsCompOpt?: CompilerOptions,
) {
  if (!name && !origin) return;
  it(name ?? 'default', async () => {
    assertNonNull(origin, `Missing origin in test case '${name ?? 'default'}'`);
    const res = result || defResult;
    const source = fs.readFileSync(origin).toString();
    const c = updateEol(config, endOfLine(source));
    const allConfig = { config: c, eslintConfig, tsCompilerOptions: tsCompOpt };
    const expected = res ? fs.readFileSync(res).toString() : source;
    const actual = formatSource(origin, source, allConfig) ?? source;
    if (UPDATE_RESULT && actual !== expected && result) fs.writeFileSync(result, actual);
    assert.strictEqual(actual, expected);
  });
}

function updateEol(config: Configuration | undefined, eol: string) {
  const c: Configuration = { eol: eol === '\r\n' ? 'CRLF' : 'LF' };
  return config ? mergeConfig(config, c) : c;
}