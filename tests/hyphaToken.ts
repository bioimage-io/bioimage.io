import fs from 'fs';

/**
 * The HYPHA_TOKEN these specs sign in with.
 *
 * Taken from the environment first. Failing that, from the file named by
 * BIOENGINE_ENV_FILE: no path is hardcoded, because this repository is public
 * and a contributor's filesystem layout does not belong in it.
 *
 * Both absences fail with the remedy named. Reading an unset variable used to
 * produce `ENOENT: ''`, which says nothing about what to export.
 */
export function hyphaToken(): string {
  const direct = (process.env.HYPHA_TOKEN || '').trim();
  if (direct) return direct;

  const envFile = (process.env.BIOENGINE_ENV_FILE || '').trim();
  if (!envFile) {
    throw new Error(
      'HYPHA_TOKEN is not set and BIOENGINE_ENV_FILE names no file. ' +
        'Export HYPHA_TOKEN, or point BIOENGINE_ENV_FILE at a file containing it.',
    );
  }
  if (!fs.existsSync(envFile)) {
    throw new Error(`BIOENGINE_ENV_FILE points at ${envFile}, which does not exist.`);
  }
  const match = fs.readFileSync(envFile, 'utf8').match(/HYPHA_TOKEN=(\S+)/);
  if (!match) {
    throw new Error(`No HYPHA_TOKEN= line in ${envFile}.`);
  }
  return match[1];
}

/**
 * The raw text of the file named by BIOENGINE_ENV_FILE.
 *
 * Call sites parse it themselves; this exists so that none of them hardcodes a
 * path and so that an unset variable fails with the remedy named instead of
 * `ENOENT: ''`.
 */
export function envFileText(): string {
  const envFile = (process.env.BIOENGINE_ENV_FILE || '').trim();
  if (!envFile) {
    throw new Error(
      'BIOENGINE_ENV_FILE names no file. Point it at a file holding the credentials ' +
        'these specs read, or export the value the spec needs directly.',
    );
  }
  if (!fs.existsSync(envFile)) {
    throw new Error(`BIOENGINE_ENV_FILE points at ${envFile}, which does not exist.`);
  }
  return fs.readFileSync(envFile, 'utf8');
}
