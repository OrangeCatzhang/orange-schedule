// Optional offline preparation using the official Electron release zip.
// The archive must match the checksum shipped in the pinned npm package.
const fs=require('node:fs');const path=require('node:path');const crypto=require('node:crypto');const {execFileSync}=require('node:child_process');
const root=path.resolve(__dirname,'..');const pkg=require('../node_modules/electron/package.json');
const filename='electron-v'+pkg.version+'-win32-x64.zip';const zip=path.join(root,'_work','electron-cache',filename);
const expected=require('../node_modules/electron/checksums.json')[filename];
const actual=crypto.createHash('sha256').update(fs.readFileSync(zip)).digest('hex');
if(!expected||actual!==expected)throw new Error('Electron checksum mismatch');
const target=path.join(root,'node_modules','electron','dist');
execFileSync('python',['-m','zipfile','-e',zip,target],{stdio:'inherit'});
fs.writeFileSync(path.join(root,'node_modules','electron','path.txt'),'electron.exe');
console.log('Electron '+pkg.version+' verified: '+actual);
