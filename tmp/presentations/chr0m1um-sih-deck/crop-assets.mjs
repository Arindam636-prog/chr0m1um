import sharp from 'sharp';

const base = '/Users/arindam/Documents/SIH 2026/contextshield/tmp/presentations/chr0m1um-sih-deck/assets';

await sharp(`${base}/template-slide.png`)
  .extract({ left: 1605, top: 0, width: 395, height: 185 })
  .png()
  .toFile(`${base}/sih-2026-logo.png`);
