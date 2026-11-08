import { build } from 'esbuild';
import { writeFileSync } from 'node:fs';
const entries = process.argv.slice(2).length ? process.argv.slice(2) : ['main'];
for (const name of entries) {
  const r = await build({
    entryPoints: [`src/${name}.js`], bundle: true, minify: name === 'main', format: 'iife', target: 'es2020',
    write: false, loader: { '.glb': 'dataurl' }, logLevel: 'warning',
  });
  const js = r.outputFiles[0].text.replace(/<\/script/gi, '<\/script');
  const shell = name === 'main' ? (await import('node:fs')).readFileSync('src/shell.html', 'utf8')
    : '<!doctype html><meta charset=utf-8><title>sheet</title><style>html,body{margin:0;height:100%;background:#123}canvas{display:block}</style><body>__SCRIPT__';
  const html = shell.replace('__SCRIPT__', () => `<script>${js}</script>`);
  writeFileSync(`dist/${name === 'main' ? 'index' : name}.html`, html);
  console.log(name, (html.length / 1048576).toFixed(1) + ' MB');
}
