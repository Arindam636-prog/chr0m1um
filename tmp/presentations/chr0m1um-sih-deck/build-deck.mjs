import fs from 'node:fs/promises';
import { Presentation, PresentationFile } from '/Users/arindam/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/@oai/artifact-tool/dist/artifact_tool.mjs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import * as Phosphor from '@phosphor-icons/react';

const ROOT = '/Users/arindam/Documents/SIH 2026/contextshield';
const TMP = `${ROOT}/tmp/presentations/chr0m1um-sih-deck`;
const ASSETS = `${TMP}/assets`;
const PREVIEW = `${TMP}/final-render`;
const LAYOUT = `${TMP}/final-layout`;
const OUTPUT = `${ROOT}/output/Chr0m1um_ContextShield_SIH_2026.pptx`;
const assetBytes = {};

const W = 1280;
const H = 720;
const FOOTER_H = 53;

const C = {
  blue: '#087ABD',
  navy: '#123B5D',
  cyan: '#2EAAD0',
  green: '#17964B',
  lime: '#B7FF3C',
  ink: '#111827',
  body: '#334155',
  muted: '#64748B',
  border: '#B8C8D2',
  paleBlue: '#EAF5FB',
  paleGreen: '#EAF7EF',
  paleAmber: '#FFF6E5',
  amber: '#F59E0B',
  red: '#E4574F',
  paleRed: '#FFF0EE',
  white: '#FFFFFF',
  light: '#F8FAFC',
};

function iconSvg(name, color = C.navy, weight = 'duotone') {
  const Icon = Phosphor[name];
  if (!Icon) throw new Error(`Unknown icon ${name}`);
  return renderToStaticMarkup(React.createElement(Icon, { size: 64, color, weight }));
}

function addShape(slide, geometry, x, y, w, h, fill = 'none', lineFill = 'none', lineWidth = 0, radius = 0) {
  return slide.shapes.add({
    geometry,
    position: { left: x, top: y, width: w, height: h },
    fill,
    line: { style: 'solid', fill: lineFill, width: lineWidth },
    ...(radius ? { borderRadius: radius } : {}),
  });
}

function addText(slide, text, x, y, w, h, opts = {}) {
  const shape = addShape(slide, 'textbox', x, y, w, h, opts.fill ?? 'none', opts.lineFill ?? 'none', opts.lineWidth ?? 0, opts.radius ?? 0);
  shape.text = text;
  shape.text.style = {
    fontSize: opts.fontSize ?? 18,
    typeface: opts.typeface ?? 'Arial',
    bold: opts.bold ?? false,
    italic: opts.italic ?? false,
    color: opts.color ?? C.ink,
    alignment: opts.align ?? 'left',
    verticalAlignment: opts.valign ?? 'top',
    lineSpacing: opts.lineSpacing ?? 1.02,
    insets: opts.insets ?? { top: 2, right: 4, bottom: 2, left: 4 },
    autoFit: opts.autoFit ?? 'none',
    wrap: 'square',
  };
  return shape;
}

function addRichText(slide, paragraphs, x, y, w, h, opts = {}) {
  const shape = addShape(slide, 'textbox', x, y, w, h, opts.fill ?? 'none', opts.lineFill ?? 'none', opts.lineWidth ?? 0, opts.radius ?? 0);
  shape.text.set(paragraphs);
  shape.text.style = {
    fontSize: opts.fontSize ?? 17,
    typeface: opts.typeface ?? 'Arial',
    color: opts.color ?? C.body,
    alignment: opts.align ?? 'left',
    verticalAlignment: opts.valign ?? 'top',
    lineSpacing: opts.lineSpacing ?? 1.04,
    insets: opts.insets ?? { top: 4, right: 6, bottom: 4, left: 6 },
    autoFit: opts.autoFit ?? 'none',
    wrap: 'square',
  };
  return shape;
}

function bullet(lead, body, color = C.body, size = '12.5pt') {
  return {
    bulletCharacter: '•',
    marginLeft: 18,
    indent: -10,
    spaceAfter: 5,
    runs: [
      { run: `${lead}: `, textStyle: { bold: true, color, fontSize: size } },
      { run: body, textStyle: { color, fontSize: size } },
    ],
  };
}

function addIcon(slide, name, x, y, size = 28, color = C.navy, bg = null) {
  if (bg) addShape(slide, 'ellipse', x - 6, y - 6, size + 12, size + 12, bg, 'none', 0);
  slide.images.add({
    svg: iconSvg(name, color),
    alt: `${name} icon`,
    position: { left: x, top: y, width: size, height: size },
    fit: 'contain',
  });
}

function addSectionLabel(slide, label, x, y, w, color = C.blue) {
  const pill = addShape(slide, 'roundRect', x, y, w, 24, color, color, 1, 11);
  pill.text = label.toUpperCase();
  pill.text.style = {
    fontSize: 12,
    typeface: 'Arial Narrow',
    bold: true,
    color: C.white,
    alignment: 'center',
    verticalAlignment: 'middle',
    insets: { top: 1, right: 4, bottom: 1, left: 4 },
  };
  return pill;
}

function addCard(slide, x, y, w, h, fill = C.light, stroke = C.border, radius = 14) {
  return addShape(slide, 'roundRect', x, y, w, h, fill, stroke, 1.2, radius);
}

function addTemplate(slide, title, pageNo) {
  slide.background.fill = C.white;
  slide.images.add({
    blob: assetBytes.favicon,
    contentType: 'image/svg+xml',
    alt: 'ContextShield mark',
    position: { left: 24, top: 14, width: 44, height: 44 },
    fit: 'contain',
  });
  addText(slide, 'CONTEXT\nSHIELD', 73, 13, 95, 43, {
    fontSize: 13,
    typeface: 'Arial Narrow',
    bold: true,
    color: C.ink,
    lineSpacing: 0.88,
    valign: 'middle',
    insets: { top: 0, right: 0, bottom: 0, left: 0 },
  });
  slide.images.add({
    blob: assetBytes.sih,
    contentType: 'image/png',
    alt: 'Smart India Hackathon 2026 mark from the supplied template',
    position: { left: 1042, top: 5, width: 214, height: 88 },
    fit: 'contain',
  });
  addText(slide, title.toUpperCase(), 205, 17, 830, 54, {
    fontSize: 39,
    typeface: 'Arial Narrow',
    bold: true,
    color: '#050505',
    align: 'center',
    valign: 'middle',
    insets: { top: 0, right: 2, bottom: 0, left: 2 },
  });
  addShape(slide, 'rect', 0, H - FOOTER_H, W, FOOTER_H, C.blue, C.blue, 0);
  addText(slide, '@chr0m1um', 442, H - FOOTER_H + 3, 396, 44, {
    fontSize: 31,
    typeface: 'Arial Narrow',
    bold: true,
    color: C.white,
    align: 'center',
    valign: 'middle',
    insets: { top: 0, right: 0, bottom: 0, left: 0 },
  });
  addText(slide, String(pageNo), 1219, H - FOOTER_H + 2, 42, 45, {
    fontSize: 27,
    typeface: 'Arial Narrow',
    bold: true,
    color: C.white,
    align: 'center',
    valign: 'middle',
    insets: { top: 0, right: 0, bottom: 0, left: 0 },
  });
}

function addNotes(slide, lines, sources) {
  const note = [
    ...lines,
    '',
    '[Sources]',
    ...sources.map((source) => `- ${source}`),
    '[/Sources]',
  ].join('\n');
  slide.speakerNotes.textFrame.setText(note);
  slide.speakerNotes.setVisible(true);
}

function addLinkButton(slide, label, url, x, y, w, h, fill = C.blue, textColor = C.white) {
  const button = addShape(slide, 'roundRect', x, y, w, h, fill, fill, 1, 8);
  button.text.set([[{
    run: label,
    textStyle: { bold: true, color: textColor, fontSize: '11pt', underline: 'none' },
    link: { uri: url, isExternal: true },
  }]]);
  button.text.style = {
    typeface: 'Arial',
    alignment: 'center',
    verticalAlignment: 'middle',
    insets: { top: 2, right: 5, bottom: 2, left: 5 },
  };
  return button;
}

function addMiniStat(slide, x, y, w, value, label, color) {
  addCard(slide, x, y, w, 63, C.white, color, 10);
  addText(slide, value, x + 8, y + 7, w - 16, 27, {
    fontSize: 22,
    bold: true,
    color,
    align: 'center',
    valign: 'middle',
    insets: { top: 0, right: 0, bottom: 0, left: 0 },
  });
  addText(slide, label, x + 7, y + 35, w - 14, 22, {
    fontSize: 11.5,
    color: C.muted,
    align: 'center',
    valign: 'middle',
    insets: { top: 0, right: 0, bottom: 0, left: 0 },
  });
}

async function build() {
  await fs.mkdir(PREVIEW, { recursive: true });
  await fs.mkdir(LAYOUT, { recursive: true });
  await fs.mkdir(`${ROOT}/output`, { recursive: true });
  assetBytes.favicon = await fs.readFile(`${ROOT}/judge-site/public/favicon.svg`);
  assetBytes.template = await fs.readFile(`${ASSETS}/template-slide.png`);
  assetBytes.sih = await fs.readFile(`${ASSETS}/sih-2026-logo.png`);
  assetBytes.title = await fs.readFile(`${ASSETS}/title-slide.png`);
  assetBytes.privacy = await fs.readFile(`${ASSETS}/privacy-proof.png`);
  assetBytes.home = await fs.readFile(`${ASSETS}/judge-home.png`);
  assetBytes.checkout = await fs.readFile(`${ASSETS}/checkout-demo.png`);

  const presentation = Presentation.create({ slideSize: { width: W, height: H } });

  // Slide 1 — exact supplied title slide.
  {
    const slide = presentation.slides.add();
    slide.images.add({
      blob: assetBytes.title,
      contentType: 'image/png',
      alt: 'ContextShield SIH 2026 title slide supplied by team Chr0m1um',
      position: { left: 0, top: 0, width: W, height: H },
      fit: 'cover',
    });
    addNotes(slide, [
      'Opening: Browser agents are useful only when users can trust what leaves their device.',
      'Introduce ContextShield as a privacy-preserving browser agent boundary built by Chr0m1um.',
      'Verify Team ID 12345 before final submission if the SIH portal assigns a different ID.',
    ], ['/Users/arindam/Downloads/demo SIH.pdf']);
  }

  // Slide 2 — problem, solution, innovation.
  {
    const slide = presentation.slides.add();
    addTemplate(slide, 'Context Shield', 2);
    addText(slide, '(Privacy-Preserving Context Firewall)', 410, 68, 460, 22, {
      fontSize: 15,
      bold: true,
      color: C.muted,
      align: 'center',
      valign: 'middle',
      insets: { top: 0, right: 0, bottom: 0, left: 0 },
    });
    addIcon(slide, 'StarFourIcon', 959, 75, 20, C.amber);
    addText(slide, 'Innovation', 981, 74, 90, 22, { fontSize: 14, bold: true, color: C.body, valign: 'middle' });

    addSectionLabel(slide, 'Problem', 38, 102, 88, C.red);
    addCard(slide, 38, 121, 690, 126, C.paleRed, '#F2A7A1', 12);
    addRichText(slide, [
      bullet('Too much context', 'Cloud agents may receive raw pixels, DOM text, cookies and identity the task never needs.'),
      bullet('Blanket redaction', 'Safer, but it strips labels and structure required to act correctly.'),
      bullet('Ungated actions', 'Plausible server commands can still target stale or wrong controls.'),
    ], 50, 131, 667, 108, { fontSize: 15.8, color: C.body, lineSpacing: 0.98 });

    addSectionLabel(slide, 'Proposed solution', 38, 258, 145, C.blue);
    addCard(slide, 38, 277, 690, 157, C.paleBlue, '#9CC9E3', 12);
    addRichText(slide, [
      bullet('Read locally', 'DOM, ARIA and visible pixels are interpreted inside the browser.'),
      bullet('Detect and redact', 'YOLOX, PP-OCR and Rampart find faces, visual text and contextual PII before any request.'),
      bullet('Reason safely', 'Only SanitizedContext and LOCAL_* handles reach Qwen3-VL.'),
      bullet('Act locally', 'Typed actions are grounded, gated, executed and verified on-device.'),
    ], 50, 286, 667, 140, { fontSize: 15.8, color: C.body, lineSpacing: 0.98 });

    addSectionLabel(slide, 'Unique value proposition', 38, 447, 190, C.green);
    addCard(slide, 38, 466, 690, 161, C.paleGreen, '#9FD3B4', 12);
    addRichText(slide, [
      bullet('Privacy before AI access', 'Sensitive context is removed at the source—not after it reaches the cloud.'),
      bullet('Minimum necessary context', 'Useful structure crosses the boundary; raw identity stays in a memory-only vault.'),
      bullet('Two-sided safety', 'Context is protected outbound; actions are validated inbound.'),
      bullet('Browser-native', 'The same privacy contract supports Chrome and Firefox builds.'),
    ], 50, 477, 667, 142, { fontSize: 15.8, color: C.body, lineSpacing: 0.98 });

    addCard(slide, 752, 111, 488, 495, '#F7FBF8', '#98BCAA', 18);
    addText(slide, 'WHAT THE JUDGE CAN SEE', 774, 126, 315, 28, { fontSize: 15, bold: true, color: C.green });
    addShape(slide, 'roundRect', 772, 157, 448, 276, C.ink, C.ink, 1, 12);
    slide.images.add({
      blob: assetBytes.privacy,
      contentType: 'image/png',
      alt: 'ContextShield privacy proof page',
      position: { left: 779, top: 164, width: 434, height: 262 },
      fit: 'cover',
      crop: { left: 0, top: 0.08, right: 0, bottom: 0.10 },
      geometry: 'roundRect',
      borderRadius: 8,
    });
    addIcon(slide, 'EyeSlashIcon', 787, 456, 24, C.green, C.paleGreen);
    addText(slide, 'Raw page state stays local', 824, 452, 360, 28, { fontSize: 17, bold: true, color: C.ink, valign: 'middle' });
    addIcon(slide, 'ShieldCheckIcon', 787, 499, 24, C.blue, C.paleBlue);
    addText(slide, 'Server receives sanitized structure', 824, 495, 360, 28, { fontSize: 17, bold: true, color: C.ink, valign: 'middle' });
    addIcon(slide, 'CursorClickIcon', 787, 542, 24, C.amber, C.paleAmber);
    addText(slide, 'Browser keeps the final say', 824, 538, 360, 28, { fontSize: 17, bold: true, color: C.ink, valign: 'middle' });
    addLinkButton(slide, 'OPEN PRIVACY PROOF', 'http://127.0.0.1:4173/privacy-proof.html', 893, 574, 205, 26, C.green);

    addNotes(slide, [
      'Lead with the privacy boundary, not the model list.',
      'The novelty is the combination of task-aware disclosure, local secret handles and a local action gate.',
      'Click OPEN PRIVACY PROOF for the controlled visual redaction demo.',
    ], [
      'User-provided SIH 2026 problem statement',
      `${ROOT}/README.md`,
      `${ROOT}/docs/api-contract.md`,
      'http://127.0.0.1:4173/privacy-proof.html',
    ]);
  }

  // Slide 3 — architecture.
  {
    const slide = presentation.slides.add();
    addTemplate(slide, 'Technical Approach', 3);

    addSectionLabel(slide, 'On-device trust zone', 38, 96, 165, C.green);
    addSectionLabel(slide, 'Sanitized server zone', 948, 96, 174, C.blue);
    addShape(slide, 'line', 891, 101, 0, 430, 'none', '#88A2B2', 2);

    const capture = addCard(slide, 42, 137, 230, 140, C.paleGreen, '#8BC9A4', 15);
    const perceive = addCard(slide, 307, 137, 250, 140, C.paleGreen, '#8BC9A4', 15);
    const protect = addCard(slide, 592, 137, 260, 140, C.paleGreen, '#8BC9A4', 15);
    const plan = addCard(slide, 932, 137, 292, 140, C.paleBlue, '#8CBFDC', 15);
    addIcon(slide, 'BrowserIcon', 58, 154, 30, C.green);
    addText(slide, '1  CAPTURE', 98, 151, 150, 28, { fontSize: 18, bold: true, color: C.green, valign: 'middle' });
    addText(slide, 'DOM + ARIA + screenshot\nVisible controls, labels & state', 58, 187, 196, 70, { fontSize: 15.5, color: C.body, lineSpacing: 1.04 });
    addIcon(slide, 'ScanIcon', 323, 154, 30, C.green);
    addText(slide, '2  PERCEIVE', 363, 151, 170, 28, { fontSize: 18, bold: true, color: C.green, valign: 'middle' });
    addText(slide, 'YOLOX → faces\nPP-OCR → visual text\nRampart ONNX → contextual PII', 323, 186, 216, 78, { fontSize: 15, color: C.body, lineSpacing: 1.0 });
    addIcon(slide, 'FingerprintIcon', 608, 154, 30, C.green);
    addText(slide, '3  PROTECT', 648, 151, 180, 28, { fontSize: 18, bold: true, color: C.green, valign: 'middle' });
    addText(slide, 'Mask sensitive pixels\nReplace values with LOCAL_* handles\nSecrets remain in memory-only vault', 608, 186, 225, 78, { fontSize: 15, color: C.body, lineSpacing: 1.0 });
    addIcon(slide, 'CloudIcon', 948, 154, 30, C.blue);
    addText(slide, '4  REASON', 988, 151, 190, 28, { fontSize: 18, bold: true, color: C.blue, valign: 'middle' });
    addText(slide, 'Qwen3-VL receives strict SanitizedContext and returns one typed action—never raw DOM, cookies or credentials.', 948, 186, 257, 78, { fontSize: 15, color: C.body, lineSpacing: 1.0 });

    slide.shapes.connect(capture, perceive, { kind: 'straight', fromSide: 'right', toSide: 'left', line: { style: 'solid', fill: C.green, width: 2 }, tail: { type: 'arrow', width: 'sm', length: 'sm' } });
    slide.shapes.connect(perceive, protect, { kind: 'straight', fromSide: 'right', toSide: 'left', line: { style: 'solid', fill: C.green, width: 2 }, tail: { type: 'arrow', width: 'sm', length: 'sm' } });
    slide.shapes.connect(protect, plan, { kind: 'straight', fromSide: 'right', toSide: 'left', line: { style: 'solid', fill: C.blue, width: 2 }, tail: { type: 'arrow', width: 'sm', length: 'sm' } });

    const schema = addCard(slide, 585, 288, 312, 52, C.navy, C.navy, 12);
    addIcon(slide, 'LockKeyIcon', 599, 300, 27, C.lime);
    addText(slide, 'ONLY SanitizedContext crosses', 636, 299, 245, 28, { fontSize: 17, bold: true, color: C.white, valign: 'middle' });
    addText(slide, 'origin · task · safe elements · handles · redaction metadata', 579, 344, 332, 30, { fontSize: 12.5, color: C.muted, align: 'center' });

    const gate = addCard(slide, 932, 386, 292, 92, C.paleAmber, '#E8BA5F', 15);
    const execute = addCard(slide, 592, 386, 260, 92, C.paleGreen, '#8BC9A4', 15);
    const verify = addCard(slide, 307, 386, 250, 92, C.paleGreen, '#8BC9A4', 15);
    const outcome = addCard(slide, 42, 386, 230, 92, C.paleGreen, '#8BC9A4', 15);
    addIcon(slide, 'ShieldWarningIcon', 949, 404, 28, C.amber);
    addText(slide, '5  LOCAL ACTION GATE', 987, 400, 214, 28, { fontSize: 17, bold: true, color: '#9A6200', valign: 'middle' });
    addText(slide, 'Ground target · enforce policy · request confirmation', 949, 437, 250, 28, { fontSize: 14.5, color: C.body, valign: 'middle' });
    addIcon(slide, 'CursorClickIcon', 609, 404, 28, C.green);
    addText(slide, '6  EXECUTE', 647, 400, 170, 28, { fontSize: 17, bold: true, color: C.green, valign: 'middle' });
    addText(slide, 'Interact with the browser locally', 609, 437, 225, 28, { fontSize: 14.5, color: C.body, valign: 'middle' });
    addIcon(slide, 'CheckCircleIcon', 324, 404, 28, C.green);
    addText(slide, '7  VERIFY', 362, 400, 165, 28, { fontSize: 17, bold: true, color: C.green, valign: 'middle' });
    addText(slide, 'Fresh observation proves the page changed', 324, 437, 215, 28, { fontSize: 14.5, color: C.body, valign: 'middle' });
    addIcon(slide, 'ArrowCounterClockwiseIcon', 59, 404, 28, C.green);
    addText(slide, '8  CONTINUE / STOP', 97, 400, 154, 28, { fontSize: 17, bold: true, color: C.green, valign: 'middle' });
    addText(slide, 'Next safe step—or fail closed', 59, 437, 194, 28, { fontSize: 14.5, color: C.body, valign: 'middle' });

    slide.shapes.connect(plan, gate, { kind: 'elbow', fromSide: 'bottom', toSide: 'top', line: { style: 'solid', fill: C.blue, width: 2 }, tail: { type: 'arrow', width: 'sm', length: 'sm' } });
    slide.shapes.connect(gate, execute, { kind: 'straight', fromSide: 'left', toSide: 'right', line: { style: 'solid', fill: C.green, width: 2 }, tail: { type: 'arrow', width: 'sm', length: 'sm' } });
    slide.shapes.connect(execute, verify, { kind: 'straight', fromSide: 'left', toSide: 'right', line: { style: 'solid', fill: C.green, width: 2 }, tail: { type: 'arrow', width: 'sm', length: 'sm' } });
    slide.shapes.connect(verify, outcome, { kind: 'straight', fromSide: 'left', toSide: 'right', line: { style: 'solid', fill: C.green, width: 2 }, tail: { type: 'arrow', width: 'sm', length: 'sm' } });

    addSectionLabel(slide, 'Tech stack', 38, 509, 96, C.navy);
    addCard(slide, 38, 528, 1202, 111, C.white, C.border, 12);
    const stack = [
      ['GoogleChromeLogoIcon', 'Chrome + Firefox', 'Browser extension'],
      ['CodeIcon', 'WXT + TypeScript', 'UI & content scripts'],
      ['CpuIcon', 'ONNX Runtime Web', 'Local inference'],
      ['ScanIcon', 'YOLOX + PP-OCR', 'Vision & OCR'],
      ['FingerprintIcon', 'Rampart', 'Contextual PII'],
      ['LightningIcon', 'FastAPI', 'Strict gateway API'],
      ['BrainIcon', 'Qwen3-VL', 'Open-weights planner'],
    ];
    stack.forEach(([icon, title, sub], i) => {
      const x = 54 + i * 169;
      addIcon(slide, icon, x, 551, 27, i < 5 ? C.green : C.blue);
      addText(slide, title, x + 37, 545, 121, 24, { fontSize: 14.5, bold: true, color: C.ink, valign: 'middle' });
      addText(slide, sub, x + 37, 569, 121, 39, { fontSize: 11.5, color: C.muted, lineSpacing: 0.95 });
    });

    addNotes(slide, [
      'Explain the boundary left to right, then the typed action loop right to left.',
      'The central claim is simple: pixels and identity are processed locally; only SanitizedContext crosses.',
      'If the action cannot be grounded or verified, the controller stops safely instead of improvising.',
    ], [
      `${ROOT}/README.md`,
      `${ROOT}/docs/api-contract.md`,
      `${ROOT}/docs/full-setup.md`,
    ]);
  }

  // Slide 4 — feasibility and viability.
  {
    const slide = presentation.slides.add();
    addTemplate(slide, 'Feasibility and Viability', 4);

    addSectionLabel(slide, 'Feasibility', 40, 101, 104, C.blue);
    addCard(slide, 40, 121, 582, 257, C.paleBlue, '#9CC9E3', 14);
    addRichText(slide, [
      bullet('Proven browser stack', 'WXT, TypeScript and Manifest V3 produce loadable Chrome and Firefox builds.'),
      bullet('Local AI is practical', 'Quantized ONNX models run through ONNX Runtime Web; visual work is targeted to visible regions.'),
      bullet('Server is replaceable', 'FastAPI speaks a strict schema and the planner uses an OpenAI-compatible endpoint for Qwen3-VL.'),
      bullet('One-command operation', 'START.sh launches the model, API and judge site; STATUS.sh and VERIFY.sh expose failures early.'),
      bullet('Current proof', 'Controlled privacy, action and fail-closed demos run end to end on the team laptop.'),
    ], 54, 137, 553, 228, { fontSize: 16.1, color: C.body, lineSpacing: 1.0 });

    addSectionLabel(slide, 'Viability', 658, 101, 88, C.green);
    addCard(slide, 658, 121, 582, 257, C.paleGreen, '#9FD3B4', 14);
    addRichText(slide, [
      bullet('Adoption path', 'Ship as a browser privacy layer that sits between existing users and cloud agent planners.'),
      bullet('Deployment model', 'Free local extension + self-hosted/community server; managed enterprise policy and audit controls.'),
      bullet('Cost control', 'Small on-device models reduce server-side vision load; only sanitized structured context is transmitted.'),
      bullet('Scalability', 'Add domain adapters, policy packs and independently versioned models without changing the privacy contract.'),
      bullet('Trust and retention', 'Visible redaction, confirmation gates and safe logs make delegated browser work understandable.'),
    ], 672, 137, 553, 228, { fontSize: 16.1, color: C.body, lineSpacing: 1.0 });

    addSectionLabel(slide, 'Technical challenges', 40, 395, 160, C.red);
    addCard(slide, 40, 414, 582, 167, C.paleRed, '#F2A7A1', 14);
    addRichText(slide, [
      bullet('Dynamic pages / stale targets', 'Re-observe after every action, bind actions to fingerprints and fail closed when state changes.'),
      bullet('Cross-site variability', 'Use semantic DOM + ARIA first, OCR as fallback, then add measured domain adapters.'),
      bullet('Resource pressure', 'Load models lazily, crop visual regions, quantize weights and keep a deterministic no-vision fallback.'),
    ], 54, 429, 553, 140, { fontSize: 15.5, color: C.body, lineSpacing: 1.0 });

    addSectionLabel(slide, 'Business / user challenges', 658, 395, 190, C.amber);
    addCard(slide, 658, 414, 582, 167, C.paleAmber, '#E8BA5F', 14);
    addRichText(slide, [
      bullet('User confidence', 'Show exactly what was redacted, what the server saw and why confirmation is requested.'),
      bullet('False privacy claims', 'Publish benchmark scope and caveats; never equate controlled recall with universal website coverage.'),
      bullet('Maintenance', 'Version models, schemas and policy packs separately; regression-test real controls before release.'),
    ], 672, 429, 553, 140, { fontSize: 15.5, color: C.body, lineSpacing: 1.0 });

    addText(slide, 'BUILD → MEASURE → DISCLOSE LIMITS → EXPAND COVERAGE', 300, 602, 680, 30, {
      fontSize: 17,
      typeface: 'Arial Narrow',
      bold: true,
      color: C.navy,
      align: 'center',
      valign: 'middle',
      fill: '#F1F7FB',
      lineFill: '#B7D5E6',
      lineWidth: 1,
      radius: 10,
    });

    addNotes(slide, [
      'This slide answers both feasibility and honesty: the architecture is buildable, and the claims are explicitly scoped.',
      'The enterprise path is policy and audit capability; the privacy contract stays the same.',
      'Mention that independent production-scale evaluation is the next milestone, not a completed claim.',
    ], [
      `${ROOT}/README.md`,
      `${ROOT}/docs/SIH-RELEASE-v1.3.0.md`,
      `${ROOT}/demo/evidence.json`,
    ]);
  }

  // Slide 5 — impact and measured proof.
  {
    const slide = presentation.slides.add();
    addTemplate(slide, 'Impacts & Benefits', 5);

    addCard(slide, 40, 100, 735, 197, C.white, C.border, 14);
    addRichText(slide, [
      bullet('Privacy & trust impact', 'Users can delegate browser work without sending their full screen, raw DOM or secret values to a planner.'),
      bullet('Security & responsible automation', 'Local validation, confirmation and post-action verification constrain what server-generated commands can do.'),
      bullet('Adoption & ecosystem impact', 'A reusable privacy boundary helps browsers, enterprises and public services adopt agentic assistance with visible safeguards.'),
    ], 54, 114, 707, 169, { fontSize: 17.1, color: C.body, lineSpacing: 1.03 });

    addSectionLabel(slide, 'Measured prototype evidence', 798, 100, 196, C.navy);
    addCard(slide, 798, 119, 442, 178, '#111827', '#111827', 14);
    const metrics = [
      ['Visual context', '167 / 167', '60 controlled screens'],
      ['PII precision / recall', '100% / 100%', '295 synthetic cases'],
      ['Redaction precision', '100 / 100', 'supplied-box masks'],
      ['Client resource', '99.6 MB', 'packaged Chrome release'],
      ['End-to-end latency', '3.67 s', 'median, 3 / 3 tasks'],
    ];
    metrics.forEach(([label, value, scope], i) => {
      const y = 132 + i * 31;
      addText(slide, label, 811, y, 160, 23, { fontSize: 13.5, bold: true, color: '#D5E4ED', valign: 'middle' });
      addText(slide, value, 976, y, 104, 23, { fontSize: 15, bold: true, color: C.lime, align: 'center', valign: 'middle' });
      addText(slide, scope, 1083, y, 143, 23, { fontSize: 11.5, color: '#94A3B8', align: 'right', valign: 'middle' });
    });

    addText(slide, 'HOW CONTEXTSHIELD WORKS', 44, 315, 1192, 31, {
      fontSize: 24,
      typeface: 'Arial Narrow',
      bold: true,
      color: C.ink,
      align: 'center',
      valign: 'middle',
    });
    addShape(slide, 'line', 40, 344, 1200, 0, 'none', C.border, 1.2);

    const modes = [
      ['01', 'PRIVATE CONTEXT MODE', 'Everyday pages containing identity, credentials or personal details.', 'Read locally → detect → redact → send safe structure.', 'The planner receives useful context without raw identity.', 'EyeSlashIcon'],
      ['02', 'TASK-AWARE CONTEXT MODE', 'Tasks where a private value is genuinely required to complete the workflow.', 'Bind a LOCAL_* handle → plan on the handle → resolve only at execution.', 'Balances privacy with task completion; server never sees the secret.', 'FingerprintIcon'],
      ['03', 'CONTROLLED EXECUTION', 'Navigation, forms and multi-step workflows proposed by a remote planner.', 'Typed action → local grounding → policy gate → verify or fail closed.', 'Prevents stale, ambiguous or high-risk actions from silently executing.', 'ShieldCheckIcon'],
    ];
    modes.forEach(([num, title, use, process, benefit, icon], i) => {
      const x = 40 + i * 405;
      addCard(slide, x, 363, 390, 231, i === 1 ? C.paleGreen : C.paleBlue, i === 1 ? '#9FD3B4' : '#9CC9E3', 14);
      addShape(slide, 'ellipse', x + 17, 378, 40, 40, i === 1 ? C.green : C.blue, 'none', 0);
      addText(slide, num, x + 17, 383, 40, 30, { fontSize: 18, bold: true, color: C.white, align: 'center', valign: 'middle', insets: { top: 0, right: 0, bottom: 0, left: 0 } });
      addIcon(slide, icon, x + 335, 379, 27, i === 1 ? C.green : C.blue);
      addText(slide, title, x + 68, 377, 255, 40, { fontSize: 17, typeface: 'Arial Narrow', bold: true, color: C.ink, valign: 'middle' });
      addRichText(slide, [
        [{ run: 'For: ', textStyle: { bold: true, color: C.ink, fontSize: '11.5pt' } }, { run: use, textStyle: { color: C.body, fontSize: '11.5pt' } }],
        [{ run: 'Process: ', textStyle: { bold: true, color: C.ink, fontSize: '11.5pt' } }, { run: process, textStyle: { color: C.body, fontSize: '11.5pt' } }],
        [{ run: 'Benefit: ', textStyle: { bold: true, color: C.ink, fontSize: '11.5pt' } }, { run: benefit, textStyle: { color: C.body, fontSize: '11.5pt' } }],
      ], x + 18, 428, 354, 145, { fontSize: 15.3, color: C.body, lineSpacing: 1.05, insets: { top: 0, right: 0, bottom: 0, left: 0 } });
    });

    addText(slide, 'Evidence is controlled prototype proof—not a claim of universal website coverage.', 310, 608, 660, 27, {
      fontSize: 14,
      italic: true,
      color: C.muted,
      align: 'center',
      valign: 'middle',
    });

    addNotes(slide, [
      'Map the five dark-panel rows directly to the official evaluation metrics.',
      'State the scope aloud: controlled screens and synthetic PII cases validate the prototype, not every website.',
      'Then use the three modes to explain end-to-end user value in simple language.',
    ], [
      'User-provided official SIH evaluation metrics',
      `${ROOT}/demo/evidence.json`,
    ]);
  }

  // Slide 6 — references, differentiation and clickable resources.
  {
    const slide = presentation.slides.add();
    addTemplate(slide, 'Research and References', 6);

    addCard(slide, 38, 99, 1204, 150, C.paleBlue, '#A8CFE5', 14);
    addText(slide, 'FOUNDATIONAL REFERENCES', 53, 111, 250, 24, { fontSize: 15, bold: true, color: C.navy });
    addRichText(slide, [
      {
        bulletCharacter: '•', marginLeft: 18, indent: -10, spaceAfter: 4,
        runs: [
          { run: 'Browser inference: ', textStyle: { bold: true, color: C.ink, fontSize: '11.5pt' } },
          { run: 'WebGPU', textStyle: { underline: 'sng', color: C.blue, fontSize: '11.5pt' }, link: { uri: 'https://www.w3.org/TR/webgpu/', isExternal: true } },
          ' · ',
          { run: 'ONNX Runtime Web', textStyle: { underline: 'sng', color: C.blue, fontSize: '11.5pt' }, link: { uri: 'https://onnxruntime.ai/docs/tutorials/web/', isExternal: true } },
          ' · ',
          { run: 'Transformers.js', textStyle: { underline: 'sng', color: C.blue, fontSize: '11.5pt' }, link: { uri: 'https://huggingface.co/docs/transformers.js/', isExternal: true } },
        ],
      },
      {
        bulletCharacter: '•', marginLeft: 18, indent: -10, spaceAfter: 4,
        runs: [
          { run: 'Local vision and privacy: ', textStyle: { bold: true, color: C.ink, fontSize: '11.5pt' } },
          { run: 'YOLOX', textStyle: { underline: 'sng', color: C.blue, fontSize: '11.5pt' }, link: { uri: 'https://arxiv.org/abs/2107.08430', isExternal: true } },
          ' · ',
          { run: 'PP-OCR', textStyle: { underline: 'sng', color: C.blue, fontSize: '11.5pt' }, link: { uri: 'https://arxiv.org/abs/2009.09941', isExternal: true } },
          ' · ',
          { run: 'Rampart', textStyle: { underline: 'sng', color: C.blue, fontSize: '11.5pt' }, link: { uri: 'https://huggingface.co/nationaldesignstudio/rampart', isExternal: true } },
        ],
      },
      {
        bulletCharacter: '•', marginLeft: 18, indent: -10,
        runs: [
          { run: 'Server reasoning: ', textStyle: { bold: true, color: C.ink, fontSize: '11.5pt' } },
          { run: 'Qwen3-VL open-weights VLM', textStyle: { underline: 'sng', color: C.blue, fontSize: '11.5pt' }, link: { uri: 'https://github.com/QwenLM/Qwen3-VL', isExternal: true } },
          { run: ' behind a strict SanitizedContext API.', textStyle: { color: C.body, fontSize: '11.5pt' } },
        ],
      },
    ], 51, 139, 1168, 95, { fontSize: 15.3, color: C.body, lineSpacing: 1.02 });

    addSectionLabel(slide, 'Existing agent pattern', 38, 266, 158, C.red);
    addCard(slide, 38, 285, 574, 128, C.paleRed, '#F2A7A1', 14);
    addRichText(slide, [
      bullet('Cloud-first perception', 'Screenshots or raw DOM can leave the device before privacy classification.'),
      bullet('Opaque data exposure', 'Users cannot easily see which sensitive values were shared.'),
      bullet('Planner-led execution', 'A remote model may propose actions without a local policy and verification gate.'),
    ], 52, 298, 545, 103, { fontSize: 15.5, color: C.body, lineSpacing: 1.0 });

    addSectionLabel(slide, 'Why ContextShield stands out', 630, 266, 205, C.green);
    addCard(slide, 630, 285, 612, 128, C.paleGreen, '#9FD3B4', 14);
    addRichText(slide, [
      bullet('Minimum disclosure', 'Local models create a safe representation before the planner sees anything.'),
      bullet('Local secret handles', 'LOCAL_* tokens let the plan refer to private data without revealing its value.'),
      bullet('Verifiable control loop', 'Every action is grounded, gated, executed and checked against a fresh page state.'),
    ], 644, 298, 583, 103, { fontSize: 15.5, color: C.body, lineSpacing: 1.0 });

    addSectionLabel(slide, 'Project resources — click to open', 38, 431, 230, C.blue);
    addCard(slide, 38, 450, 1204, 180, C.white, C.border, 14);

    addLinkButton(slide, 'LIVE PROTOTYPE', 'http://127.0.0.1:4173', 54, 462, 158, 26, C.green);
    addLinkButton(slide, 'SOURCE CODE', 'https://github.com/Arindam636-prog/chr0m1um', 54, 492, 158, 26, C.navy);
    addLinkButton(slide, 'SETUP GUIDE', 'https://github.com/Arindam636-prog/chr0m1um/blob/main/README.md', 54, 522, 158, 26, C.blue);
    addLinkButton(slide, 'JUDGE RUNBOOK', 'https://github.com/Arindam636-prog/chr0m1um/blob/main/docs/judge-demo.md', 54, 552, 158, 26, C.amber, C.ink);
    addLinkButton(slide, 'BENCHMARK EVIDENCE', 'https://github.com/Arindam636-prog/chr0m1um/blob/main/demo/evidence.json', 54, 582, 158, 26, C.red);

    const shots = [
      [assetBytes.home, 'Judge control room', 'http://127.0.0.1:4173'],
      [assetBytes.privacy, 'Privacy proof', 'http://127.0.0.1:4173/privacy-proof.html'],
      [assetBytes.checkout, 'End-to-end task', 'http://127.0.0.1:4173/checkout.html'],
    ];
    shots.forEach(([blob, label, url], i) => {
      const x = 238 + i * 326;
      addShape(slide, 'roundRect', x, 466, 306, 115, C.ink, C.ink, 1, 9);
      slide.images.add({
        blob,
        contentType: 'image/png',
        alt: label,
        position: { left: x + 5, top: 471, width: 296, height: 105 },
        fit: 'cover',
        geometry: 'roundRect',
        borderRadius: 7,
      });
      addLinkButton(slide, `${label.toUpperCase()}  ↗`, url, x + 54, 589, 198, 26, i === 1 ? C.green : C.blue);
    });
    addText(slide, 'Public proofs:', 841, 429, 86, 20, { fontSize: 11.5, bold: true, color: C.muted, valign: 'middle' });
    const publicLinks = addRichText(slide, [[
      { run: 'Selenium', textStyle: { underline: 'sng', color: C.blue, bold: true, fontSize: '9.5pt' }, link: { uri: 'https://www.selenium.dev/selenium/web/web-form.html', isExternal: true } },
      ' · ',
      { run: 'Checkboxes', textStyle: { underline: 'sng', color: C.blue, bold: true, fontSize: '9.5pt' }, link: { uri: 'https://the-internet.herokuapp.com/checkboxes', isExternal: true } },
      ' · ',
      { run: 'Dropdown', textStyle: { underline: 'sng', color: C.blue, bold: true, fontSize: '9.5pt' }, link: { uri: 'https://the-internet.herokuapp.com/dropdown', isExternal: true } },
    ]], 925, 426, 310, 24, { fontSize: 12.5, color: C.body, valign: 'middle', insets: { top: 0, right: 0, bottom: 0, left: 0 } });
    void publicLinks;

    addNotes(slide, [
      'Every blue/green resource label is a real PowerPoint hyperlink.',
      'The local prototype link assumes START.sh has been run on the presentation laptop.',
      'Use the public proof links only after the controlled demo; site changes are outside the prototype benchmark scope.',
    ], [
      'https://www.w3.org/TR/webgpu/',
      'https://onnxruntime.ai/docs/tutorials/web/',
      'https://huggingface.co/docs/transformers.js/',
      'https://arxiv.org/abs/2107.08430',
      'https://arxiv.org/abs/2009.09941',
      'https://huggingface.co/nationaldesignstudio/rampart',
      'https://github.com/QwenLM/Qwen3-VL',
      'https://github.com/Arindam636-prog/chr0m1um',
      'http://127.0.0.1:4173',
    ]);
  }

  for (const [index, slide] of presentation.slides.items.entries()) {
    const stem = `slide-${String(index + 1).padStart(2, '0')}`;
    const png = await presentation.export({ slide, format: 'png', scale: 1.5 });
    await fs.writeFile(`${PREVIEW}/${stem}.png`, new Uint8Array(await png.arrayBuffer()));
    const layout = await slide.export({ format: 'layout' });
    await fs.writeFile(`${LAYOUT}/${stem}.layout.json`, await layout.text());
  }

  const montage = await presentation.export({ format: 'webp', montage: true, scale: 1 });
  await fs.writeFile(`${TMP}/final-montage.webp`, new Uint8Array(await montage.arrayBuffer()));
  const snapshot = await presentation.inspect({ kind: 'slide,textbox,shape,image,notes', maxChars: 50000 });
  await fs.writeFile(`${TMP}/final-inspect.ndjson`, snapshot.ndjson);

  const pptx = await PresentationFile.exportPptx(presentation);
  await pptx.save(OUTPUT);
  console.log(OUTPUT);
}

build().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
