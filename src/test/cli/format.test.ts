import {
  spawnSync,
  SpawnSyncOptions,
} from 'child_process';
import { compareSync } from 'dir-compare';
import fs from 'fs-extra';
import path, { sep } from 'path';
import tmp from 'tmp';

import { assertNonNull } from '../../lib/common';

const CMD = 'cmd.txt';
const STDIN = 'stdin.txt';
const IN_DIR = '__in';
const OUT_DIR = '__out';

describe('cli/format-imports', () => {
  const examples = path.resolve(__dirname, 'examples');
  // Run all test cases under examples.
  runTestSuite(examples);
});

function runTestSuite(resolved: string, relative?: string | string[]): void {
  const [name, ...rest] = relative
    ? typeof relative === 'string'
      ? relative.split(sep)
      : relative
    : [];
  if (name) return describe(name, () => runTestSuite(path.resolve(resolved, name), rest));
  const entries = fs.readdirSync(resolved, { withFileTypes: true });
  if (entries.some(e => e.name === CMD)) runTestCase(resolved);
  entries
    .filter(e => e.isDirectory() && e.name !== IN_DIR && e.name != OUT_DIR)
    .forEach(e => describe(e.name, () => runTestSuite(path.resolve(resolved, e.name))));
}

function runTestCase(resolved: string) {
  const cmds = getCmd(resolved);
  assertNonNull(cmds, 'Missing cmd.txt.');
  for (const cmd of cmds) test(cmd ? `[${cmd}]` : '[no-args]', () => runCmd(cmd, resolved));
}

function runCmd(options: string, resolved: string) {
  const stdin = getStdin(resolved);
  // create a tmp directory as the base directory to sandbox the child process.
  const tmpDir1 = tmp.dirSync();
  const baseDir = tmpDir1.name;
  // copy files needed to the child base directory.
  const { inDir, outDir } = getDirs(resolved);
  if (inDir) fs.copySync(inDir, baseDir);
  run(options, { stdin, baseDir });
  // setup the expected base directory
  const tmpDir2 = tmp.dirSync();
  const baseDirExpected = tmpDir2.name;
  if (inDir) fs.copySync(inDir, baseDirExpected);
  if (outDir) fs.copySync(outDir, baseDirExpected);
  // check base directory content.
  const r = compareSync(baseDirExpected, baseDir, { compareContent: true });
  expect(r.same).toBeTruthy();
}

function run(options: string, env?: { stdin?: string; baseDir: string }) {
  // setup args
  const script = path.resolve('src/bin/format-cli.ts');
  const args = ['-T', script, ...options.split(' ')].filter(a => !!a);
  // setup CWD and STDIN for child process if needed.
  const cwd = env?.baseDir;
  const stdio = env?.stdin ? [fs.openSync(env.stdin, 'r')] : undefined;
  const opt: SpawnSyncOptions = { cwd, stdio };
  const { stdout, stderr, status } = spawnSync('ts-node-script', args, opt);
  // check execution results
  expect({
    stdout: stdout.toString(),
    stderr: stderr.toString(),
    status,
  }).toMatchSnapshot();
}

function getCmd(dir: string) {
  return readFile(dir, CMD)?.split('\n');
}

function getStdin(dir: string) {
  const out = path.resolve(dir, STDIN);
  return fs.existsSync(out) && fs.statSync(out).isFile() ? out : undefined;
}

function getDirs(dir: string) {
  const inDir = checkDir(dir, IN_DIR);
  const outDir = checkDir(dir, OUT_DIR);
  return { inDir, outDir };
}

function checkDir(dir: string, name: string) {
  const r = path.resolve(dir, name);
  return fs.existsSync(r) && fs.statSync(r).isDirectory() ? r : undefined;
}

function readFile(dir: string, fn: string) {
  const file = path.resolve(dir, fn);
  if (!fs.existsSync(file)) return undefined;
  return fs.readFileSync(file).toString();
}
