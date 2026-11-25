// What every packaged program owes the person who downloads it (GNU AGPL-3.0, section 6): the licence text and where its
// Corresponding Source is. package.mjs writes both into each version folder (LICENSE.txt, SOURCE.txt) and the loading
// screen (credit.js) links to them. One row per program; the facts mirror SOURCE.md, which says how to build each one.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const REPO = 'https://github.com/boolean3d/slicers.wasm';

// Every library built into a copy: what SOURCE.txt calls it, and its licence and copyright notice as published by its
// makers at that version (licences/notices/<key>.txt), which NOTICES.txt carries in full. Most of these licences (BSD,
// MIT, Zlib, Apache, Boost) ask that a binary copy carries the notice itself, not just the library's name.
const LIBS = {
  boost: ['Boost 1.84.0 (BSL-1.0)'], onetbb: ['oneTBB 2021.12.0 (Apache-2.0)'],
  cgal: ['CGAL 5.6.3 headers (GPL-3.0-or-later / LGPL-3.0-or-later)', 'GPL-3.0', 'LGPL-3.0'],
  eigen: ['Eigen 5.0.1 (MPL-2.0)', 'MPL-2.0', 'LGPL-2.1'], eigen337: ['Eigen 3.3.7 (MPL-2.0)', 'MPL-2.0', 'LGPL-2.1'],
  cereal: ['cereal 1.3.0 (BSD-3-Clause)'], nlopt: ['NLopt 2.5.0 (LGPL-2.1-or-later / MIT)', 'LGPL-2.1'],
  libnoise: ['libnoise 1.0 (LGPL-2.1-or-later)', 'LGPL-2.1'], qhull: ['Qhull 8.0.2 (Qhull licence)'],
  'libjpeg-turbo': ['libjpeg-turbo 3.0.1 (IJG / BSD-3-Clause / Zlib)'], openssl: ['OpenSSL 3.0.15 (Apache-2.0)'],
  curl: ['curl 8.10.1 (curl licence)'], opencv: ['OpenCV 4.6.0 core, imgproc, imgcodecs (Apache-2.0)'],
  occt: ['OCCT 7.6.0 (LGPL-2.1 with the Open CASCADE exception)'], occt761: ['OCCT 7.6.1 (LGPL-2.1 with the Open CASCADE exception)'],
  expat: ['Expat (MIT)'], zlib: ['zlib, libpng (Zlib / libpng)'], noto: ['Noto Sans fonts (SIL Open Font License 1.1)'],
  draco: ['Draco 1.5.7 (Apache-2.0)'], ffmpeg: ['FFmpeg n7.0.2 (GPL-2.0-or-later as configured)', 'GPL-2.0'], libharu: ['libharu (Zlib)'],
  libbgcode: ['libbgcode (AGPL-3.0)'], heatshrink: ['heatshrink 0.4.1 (ISC)'], nlohmann: ['nlohmann/json 3.12.0 (MIT)'],
  nanosvg: ['nanosvg (Zlib)'], z3: ['Z3 4.15.1 (MIT)'], blosc: ['c-blosc (BSD-3-Clause)'], openexr: ['OpenEXR 2.5.5 (BSD-3-Clause)'],
  openvdb: ['OpenVDB (MPL-2.0)', 'MPL-2.0'],
};
// The notice files of a key (occt761 and eigen337 carry the same texts as occt and eigen; zlib's row also covers libpng).
const NOTICE_FILES = { occt761: ['occt'], eigen337: ['eigen'], zlib: ['zlib', 'libpng'] };
export const noticeFiles = key => (NOTICE_FILES[key] || [key]).map(f => path.join(HERE, 'licences', 'notices', f + '.txt'));
// Libraries every Orca-family build (Bambu Studio, OrcaSlicer and the makers' forks) links in.
const ENGINE_LIBS = ['boost', 'onetbb', 'cgal', 'eigen', 'cereal', 'nlopt', 'libnoise', 'qhull', 'libjpeg-turbo', 'openssl', 'curl',
  'opencv', 'occt', 'expat', 'zlib', 'noto'];
const WX = 'wxWidgets with a browser port by Adam Hilss (LGPL-2.0) and our additions (wxWindows Library Licence 3.1)';
const ORCA_FORK = { wx: 'SoftFever/Orca-deps-wxWidgets commit 139e4f2', engine: 'Muon3D slicer engine commit cdd8195' };

export const PROGRAMS = {
  bambu: { name: 'Bambu Studio', maker: 'Bambu Lab', folder: 'bambu-studio',
    upstream: ['Bambu Studio, tag v02.09.02.62 (commit 23a3375): https://github.com/bambulab/BambuStudio',
      'Muon3D slicer engine, tag v0.6.1: https://github.com/Muon-3D/muon3d-slicer-engine', ORCA_FORK.wx],
    libs: [...ENGINE_LIBS, 'draco', 'ffmpeg', 'libharu'] },
  orca: { name: 'OrcaSlicer', maker: 'SoftFever and the OrcaSlicer contributors', folder: 'orcaslicer',
    upstream: ['OrcaSlicer, tag v2.3.2 (commit c724a3f5): https://github.com/OrcaSlicer/OrcaSlicer', ORCA_FORK.engine, ORCA_FORK.wx],
    libs: [...ENGINE_LIBS, 'draco'] },
  prusa: { name: 'PrusaSlicer', maker: 'Prusa Research', folder: 'prusaslicer',
    upstream: ['PrusaSlicer, tag version_2.9.6: https://github.com/prusa3d/PrusaSlicer', 'prusa3d/wxWidgets commit 5462e7d7cf'],
    libs: ['boost', 'onetbb', 'cgal', 'eigen337', 'cereal', 'nlopt', 'qhull', 'libjpeg-turbo', 'openssl', 'curl', 'occt761', 'libbgcode',
      'heatshrink', 'nlohmann', 'nanosvg', 'z3', 'blosc', 'openexr', 'openvdb', 'expat', 'zlib', 'noto'] },
  snapmaker: { name: 'Snapmaker Orca', maker: 'Snapmaker', folder: 'snapmaker-orca',
    upstream: ['Snapmaker Orca, tag v2.4.0: https://github.com/Snapmaker/OrcaSlicer', ORCA_FORK.engine, ORCA_FORK.wx],
    libs: [...ENGINE_LIBS, 'draco'] },
  elegoo: { name: 'ElegooSlicer', maker: 'Elegoo', folder: 'elegooslicer',
    upstream: ['ElegooSlicer, tag v1.5.3.5: https://github.com/elegooofficial/ElegooSlicer', ORCA_FORK.engine,
      'SoftFever/Orca-deps-wxWidgets branch v3.3.2, commit 5b7e8c0cde'],
    notes: ['Left out: Elegoo\'s elegoo-link printer and cloud library.'],
    libs: [...ENGINE_LIBS, 'draco'] },
  anycubic: { name: 'Anycubic Slicer Next', maker: 'Anycubic', folder: 'anycubic-slicer-next',
    upstream: ['Anycubic Slicer Next, commit 987a3c2bf9ed13934137326bfd522896c70e5101: https://github.com/ANYCUBIC-3D/AnycubicSlicerNext',
      'Anycubic open-plugins, commit e3bdacc1a11bf925760abcc8b022005780363db6 (Mulan PSL v2): https://github.com/ANYCUBIC-3D/open-plugins',
      ORCA_FORK.engine, ORCA_FORK.wx],
    libs: [...ENGINE_LIBS, 'draco'], extraLicences: [['Anycubic open-plugins: Mulan Permissive Software License, Version 2', 'MulanPSL-2.0.txt']] },
  creality: { name: 'Creality Print', maker: 'Creality', folder: 'crealityprint',
    upstream: ['Creality Print, tag v7.3.0: https://github.com/CrealityOfficial/CrealityPrint', ORCA_FORK.engine,
      'SoftFever/Orca-deps-wxWidgets branch v3.3.2, commit 5b7e8c0cde'],
    notes: ['Left out: Creality\'s closed add-ons (TPMS infills, colour mixing); stand-ins say they are not in the browser version.'],
    libs: [...ENGINE_LIBS, 'draco'] },
};

// LICENSE.txt: the program's licence, then any other licence a part of it carries.
export function licenceText(app) {
  const p = PROGRAMS[app];
  let t = fs.readFileSync(path.join(HERE, 'licences', 'AGPL-3.0.txt'), 'utf8');
  for (const [what, file] of p.extraLicences || [])
    t += '\n\n' + '='.repeat(78) + '\n' + what + '\n' + '='.repeat(78) + '\n\n' + fs.readFileSync(path.join(HERE, 'licences', file), 'utf8');
  return t;
}

// SOURCE.txt: where the Corresponding Source of this exact copy is. rev = the commit of this repository the package was made from.
export function sourceText(app, version, rev) {
  const p = PROGRAMS[app];
  const at = rev ? REPO + '/tree/' + rev + '/' + p.folder : REPO + '/tree/main/' + p.folder;
  return [`${p.name} in a browser tab: where its source is`, '',
    `This copy: ${p.name}, browser build ${version}. Made by ${p.maker}, changed by Boolean3d to run in a browser tab`,
    `(our changes are listed below). This browser copy is not made or endorsed by ${p.maker}.`,
    'Licence: GNU Affero General Public License 3.0 (LICENSE.txt beside this file).',
    'Whoever receives this copy is owed its Corresponding Source (AGPL-3.0 section 6). It is made of:', '',
    'The program, as published by its makers:', ...p.upstream.map(s => '- ' + s), '',
    'Our changes and the browser build (patches, build scripts, the browser layer, the page scripts):',
    `- ${at}`, `- How to build it: ${REPO}/blob/${rev || 'main'}/SOURCE.md and build.sh`,
    ...(rev ? [`- Repository commit: ${rev}`] : []), '',
    ...(p.notes ? [...p.notes, ''] : []),
    `Built in with it: ${WX}; ${p.libs.map(k => LIBS[k][0]).join('; ')}.`,
    'Their licences and copyright notices, as their makers publish them: NOTICES.txt beside this file.', '',
    'The toolchain (Emscripten 6.0.10) is used unmodified.',
    `"${p.name}" is ${p.maker}'s name, used only to say which program this is.`, ''].join('\n');
}

// NOTICES.txt: the licence and copyright notice of wxWidgets and of every library built into this copy, as published by
// their makers, then each full licence text those notices point to, once.
export function noticesText(app) {
  const p = PROGRAMS[app], bar = '='.repeat(78), texts = new Set(['LGPL-2.0', 'wxWindows-3.1']);
  const part = (title, body) => `${bar}\n${title}\n${bar}\n\n${body.trim()}\n\n`;
  let t = `${p.name} in a browser tab: licences and copyright notices of the libraries built into it\n\n`
    + `The program's own licence is in LICENSE.txt and where its source is, in SOURCE.txt (both beside this file).\n\n`;
  t += part(WX, fs.readFileSync(path.join(HERE, 'licences', 'notices', 'wxwidgets.txt'), 'utf8'));
  for (const k of p.libs) {
    const [label, ...full] = LIBS[k];
    full.forEach(f => texts.add(f));
    t += part(label, noticeFiles(k).map(f => fs.readFileSync(f, 'utf8').trim()).join('\n\n'));
  }
  for (const f of texts) t += part(`Full text: ${f}`, fs.readFileSync(path.join(HERE, 'licences', f + '.txt'), 'utf8'));
  return t;
}
