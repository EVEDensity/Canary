import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, platform } from 'node:os';
import { join, resolve } from 'node:path';

const isWin = platform() === 'win32';
const home = homedir();
const metaDir = resolve(process.env.CANARY_INSTALL_HOME ?? join(home, '.canary'));
const homeFile = join(metaDir, 'home.json');
const defaultBinDir = isWin
  ? join(process.env.LOCALAPPDATA ?? join(home, 'AppData', 'Local'), 'canary', 'bin')
  : join(home, '.local', 'bin');

function usage() {
  console.log(`Canary uninstaller\n\nUsage:\n  node scripts/uninstall-global.mjs             Remove launcher and registration\n  node scripts/uninstall-global.mjs --remove-root  Also remove the registered installation checkout\n  node scripts/uninstall-global.mjs --help       Show this help\n\nProject roots, evidence, and user exports are preserved by default.`);
}
function readMetadata() {
  if (!existsSync(homeFile)) return null;
  try {
    const value = JSON.parse(readFileSync(homeFile, 'utf8'));
    if (!value || typeof value !== 'object' || typeof value.root !== 'string') throw new Error('metadata must contain a string root');
    return value;
  } catch (error) {
    throw new Error(`Cannot read Canary installation metadata at ${homeFile}: ${error instanceof Error ? error.message : String(error)}`);
  }
}
function removeIfExists(path, label) {
  if (!existsSync(path)) return;
  rmSync(path, { recursive: true, force: true });
  console.log(`Removed ${label}: ${path}`);
}
function removeWindowsPathEntry(binDir) {
  const escaped = binDir.replace(/'/g, "''");
  const script = `$p=[Environment]::GetEnvironmentVariable('Path','User'); if ($null -eq $p) { $p='' }; $e=$p -split ';' | Where-Object { $_ -and $_ -ne '${escaped}' }; [Environment]::SetEnvironmentVariable('Path', ($e -join ';'), 'User')`;
  const result = spawnSync('powershell', ['-NoProfile', '-Command', script], { stdio: 'inherit' });
  if (result.status !== 0) throw new Error('failed to remove Canary from user PATH');
}
function removeUnixPathEntries(binDir) {
  for (const rc of [join(home, '.profile'), join(home, '.bash_profile'), join(home, '.zprofile')]) {
    if (!existsSync(rc)) continue;
    const original = readFileSync(rc, 'utf8');
    const filtered = original.split(/\r?\n/).filter((line) => !(line.includes(binDir) && line.includes('PATH='))).join('\n');
    if (filtered !== original) writeFileSync(rc, filtered, 'utf8');
  }
}

if (process.argv.includes('--help') || process.argv.includes('-h')) { usage(); process.exit(0); }
const unsupported = process.argv.slice(2).find((arg) => !['--remove-root'].includes(arg));
if (unsupported) { console.error(`Unknown option: ${unsupported}`); usage(); process.exit(2); }
const metadata = readMetadata();
const root = metadata?.root ? resolve(metadata.root) : null;
const binDir = metadata?.binDir ? resolve(metadata.binDir) : defaultBinDir;
if (process.argv.includes('--remove-root')) {
  if (!root) throw new Error('No registered Canary installation root was found');
  if (!existsSync(join(root, 'scripts', 'install-global.mjs')) || !existsSync(join(root, 'packages', 'cli'))) throw new Error(`Refusing to remove unverified installation root: ${root}`);
  removeIfExists(root, 'installation root');
}
removeIfExists(join(binDir, 'canary.cmd'), 'launcher');
removeIfExists(join(binDir, 'canary'), 'launcher');
removeIfExists(join(binDir, 'canary-run.mjs'), 'launcher runtime');
if (isWin) removeWindowsPathEntry(binDir); else removeUnixPathEntries(binDir);
removeIfExists(homeFile, 'installation metadata');
try { if (readdirSync(metaDir).length === 0) rmSync(metaDir, { recursive: true, force: true }); } catch { /* absent or user-owned registry directory */ }
console.log('Canary global installation removed. Project files and evidence are preserved by default.');
