// Neutralized on 2026-11-18: this file was a self-extracting installer whose
// embedded package carried STALE pre-"concise-demo" copies of 24 files. Running
// it silently reverted salesScript.js / provider.js to the old
// 'anna-2026-11-17-service-first' script (while its hash guard happened to
// preserve newer files like the ana_test changes). That caused the production
// regression where "Apply latest" pushed the old script version to the live
// agent. Do NOT regenerate or re-run it. Restoring files is done exclusively by
// editing the source files directly and deploying the dental-dialer function.
throw new Error(
  'INSTALL.cjs is disabled: its embedded package is stale and previously ' +
    'rolled back salesScript.js / provider.js. Edit sources directly instead.'
);
