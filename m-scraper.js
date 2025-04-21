#!/usr/bin/env node
const ask = require('inquirer').createPromptModule();
const puppeteer = require('puppeteer');
const axios = require('axios');
const sharp = require('sharp');
const { PDFDocument } = require('pdf-lib');
const fs = require('fs-extra');
const path = require('path');
const ora = require('ora').default;
const cliProgress = require('cli-progress');

// Import all available adapters
const adapters = [
  require('./adapters/manhuaga'),
  require('./adapters/manhuafast'),
];

const OUTPUT_DIR = path.join(__dirname, 'output');
const HEADLESS = true;

async function findAdapter(url) {
  for (const adapter of adapters) {
    if (adapter.supports(url)) return adapter;
  }
  throw new Error('No adapter found for this URL');
}

async function downloadChapter(chapter, browser, mangaDir, fetchPageImageUrls) {
  const safeTitle = chapter.title.replace(/[<>:"/\\|?*]/g, '_');

  const spinner = ora(`⏬ [${chapter.title}] fetching image URLs`).start();
  const imageUrls = await fetchPageImageUrls(chapter.url, browser);
  spinner.succeed(`✅ [${chapter.title}] found ${imageUrls.length} images`);

  const bar = new cliProgress.SingleBar({
    format: `📷 ${chapter.title} |{bar}| {value}/{total}`,
    hideCursor: true
  }, cliProgress.Presets.shades_classic);
  bar.start(imageUrls.length, 0);

  const jpgPaths = [];
  for (let i = 0; i < imageUrls.length; i++) {
    const url = imageUrls[i];
    const out = path.join(mangaDir, `${safeTitle}_${i + 1}.jpg`);
    const { data } = await axios.get(url, { responseType: 'arraybuffer' });
    await sharp(data).jpeg().toFile(out);
    jpgPaths.push(out);
    bar.increment();
  }

  bar.stop();

  const pdfSpinner = ora(`📄 [${chapter.title}] creating PDF`).start();
  const pdfDoc = await PDFDocument.create();
  for (const imgPath of jpgPaths) {
    const imgBytes = await fs.readFile(imgPath);
    const jpg = await pdfDoc.embedJpg(imgBytes);
    const page = pdfDoc.addPage([jpg.width, jpg.height]);
    page.drawImage(jpg, { x: 0, y: 0 });
  }

  const pdfBytes = await pdfDoc.save();
  const pdfPath = path.join(mangaDir, `${safeTitle}.pdf`);
  await fs.writeFile(pdfPath, pdfBytes);
  pdfSpinner.succeed(`✅ [${chapter.title}] PDF saved`);

  for (const imgPath of jpgPaths) {
    await fs.remove(imgPath);
  }

  return {
    title: chapter.title,
    url: chapter.url,
    date: chapter.date,
    file: pdfPath
  };
}

(async () => {
  console.log('📚 Manga CLI Downloader\n');

  const { seriesUrl } = await ask([{
    name: 'seriesUrl',
    message: 'Enter the manga/series URL:',
    validate: v => v.startsWith('http') || 'Must be a valid URL'
  }]);

  let adapter;
  try {
    adapter = await findAdapter(seriesUrl);
  } catch (e) {
    console.error(`❌ ${e.message}`);
    process.exit(1);
  }

  const listSpinner = ora('Fetching chapter list…').start();
  let chapters;
  try {
    chapters = await adapter.fetchChapterList(seriesUrl);
    listSpinner.succeed(`Found ${chapters.length} chapters`);
  } catch (e) {
    listSpinner.fail('Failed to fetch chapters');
    console.error(e);
    process.exit(1);
  }

  const { which } = await ask([{
    type: 'list',
    name: 'which',
    message: 'What do you want to do?',
    choices: [
      { name: 'Download ALL chapters', value: 'all' },
      { name: 'Pick specific chapters', value: 'pick' },
      { name: 'Quit', value: 'quit' }
    ]
  }]);
  if (which === 'quit') process.exit(0);

  let toDownload = [];
  if (which === 'all') {
    toDownload = chapters;
  } else {
    const { picks } = await ask([{
      type: 'checkbox',
      name: 'picks',
      message: 'Select chapters to download:',
      choices: chapters.map((ch, idx) => ({
        name: `${ch.title} — ${ch.date}`, value: ch
      })),
      validate: arr => arr.length ? true : 'Pick at least one'
    }]);
    toDownload = picks;
  }

  const mangaSlug = seriesUrl.split('/').filter(Boolean).pop();
  const mangaName = mangaSlug.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  const mangaDir = path.join(OUTPUT_DIR, mangaName);
  await fs.ensureDir(mangaDir);

  const browser = await puppeteer.launch({
    headless: HEADLESS,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const results = [];
  for (const chapter of toDownload) {
    try {
      const res = await downloadChapter(chapter, browser, mangaDir, adapter.fetchPageImageUrls);
      results.push(res);
    } catch (err) {
      console.error(`❌ Failed to download ${chapter.title}:`, err.message);
    }
  }

  await browser.close();

  await fs.ensureDir(OUTPUT_DIR);
  const meta = results.map(r => ({
    title: r.title,
    url: r.url,
    date: r.date,
    file: r.file
  }));
  await fs.writeJSON(path.join(mangaDir, 'metadata.json'), meta, { spaces: 2 });

  const csvLines = [
    'title,url,date,file',
    ...meta.map(o =>
      `"${o.title.replace(/"/g, '""')}","${o.url}","${o.date}","${o.file}"`
    )
  ];
  await fs.writeFile(path.join(mangaDir, 'metadata.csv'), csvLines.join('\n'));

  console.log('\n🎉 All done! PDFs + metadata in:', mangaDir);
  process.exit(0);
})();
