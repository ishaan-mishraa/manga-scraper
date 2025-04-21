#!/usr/bin/env node
const ask         = require('inquirer').createPromptModule();
const puppeteer   = require('puppeteer');
const axios       = require('axios');
const sharp       = require('sharp');
const { PDFDocument } = require('pdf-lib');
const fs          = require('fs-extra');
const path        = require('path');
const ora         = require('ora').default;
const cliProgress = require('cli-progress');

// import adapters
const adapters = [
  require('./adapters/manhuaga'),
  require('./adapters/manhuafast')
];

const OUTPUT_DIR = path.join(__dirname, 'output');
const HEADLESS   = true;

async function findAdapter(url) {
  const a = adapters.find(a => a.supports(url));
  if (!a) throw new Error('No adapter found for this URL');
  return a;
}

(async () => {
  console.log('📚 Manga CLI Downloader\n');

  // 1) ask for a site or manga URL
  const { seriesUrl } = await ask([{
    name:    'seriesUrl',
    message: 'Enter a site or manga URL:',
    validate: v => v.startsWith('http') || 'Must be a valid URL'
  }]);
  let adapter;
  try { adapter = await findAdapter(seriesUrl) }
  catch (e) {
    console.error(`❌ ${e.message}`); process.exit(1);
  }

  // 2) launch one browser for listing if needed
  const browser = await puppeteer.launch({
    headless: HEADLESS,
    args: ['--no-sandbox','--disable-setuid-sandbox']
  });

  let mangaUrl = seriesUrl;

  // 3) if this adapter supports a site‑wide list, AND the URL looks like the index…
  if (adapter.fetchMangaList) {
    const isIndex = /^(https?:\/\/[^\/]+\/?(manga\/?)?)$/.test(seriesUrl);
    if (isIndex) {
      const listSpinner = ora('Fetching manga list…').start();
      const mangaList = await adapter.fetchMangaList(seriesUrl, browser);
      listSpinner.succeed(`Found ${mangaList.length} series`);

      const { chosen } = await ask([{
        type: 'list',
        name: 'chosen',
        message: 'Select a manga to download:',
        choices: mangaList.map(m => ({ name: m.title, value: m.url }))
      }]);
      mangaUrl = chosen;
    }
  }

  // 4) now fetch chapters for that mangaUrl
  const chapterSpinner = ora(`Fetching chapters for ${mangaUrl}…`).start();
  const chapters = await adapter.fetchChapterList(mangaUrl);
  chapterSpinner.succeed(`Found ${chapters.length} chapters`);

  // 5) pick all vs some, same as before
  const { which } = await ask([{
    type: 'list', name: 'which',
    message: 'Download:',
    choices: [
      { name: 'ALL chapters', value: 'all' },
      { name: 'Pick specific chapters', value: 'pick' },
      { name: 'Quit', value: 'quit' }
    ]
  }]);
  if (which === 'quit') process.exit(0);

  let toDownload = (which === 'all')
    ? chapters
    : (await ask([{
        type: 'checkbox',
        name: 'sel',
        message: 'Select chapters:',
        choices: chapters.map(c => ({ name: `${c.title} — ${c.date}`, value: c })),
        validate: arr => arr.length ? true : 'Pick at least one'
      }])).sel;

  // 6) prepare manga output dir
  const mangaSlug = new URL(mangaUrl).pathname.split('/').filter(Boolean).pop();
  const mangaName = mangaSlug.replace(/[-_]/g,' ').replace(/\b\w/g,c=>c.toUpperCase());
  const mangaDir  = path.join(OUTPUT_DIR, mangaName);
  await fs.ensureDir(mangaDir);

  // 7) download each chapter
  const results = [];
  for (const ch of toDownload) {
    try {
      // reuse the same browser instance for images
      const safe  = ch.title.replace(/[<>:"/\\|?*]/g,'_');
      const imgs  = await adapter.fetchPageImageUrls(ch.url, browser);

      // download images
      const bar = new cliProgress.SingleBar({
        format: `📷 ${ch.title} |{bar}| {value}/{total}`,
        hideCursor: true
      }, cliProgress.Presets.shades_classic);
      bar.start(imgs.length, 0);

      const jpgs = [];
      for (let i = 0; i < imgs.length; i++) {
        const out = path.join(mangaDir, `${safe}_${i+1}.jpg`);
        const { data } = await axios.get(imgs[i],{responseType:'arraybuffer'});
        await sharp(data).jpeg().toFile(out);
        jpgs.push(out);
        bar.increment();
      }
      bar.stop();

      // make PDF
      const pdfDoc = await PDFDocument.create();
      for (const imgPath of jpgs) {
        const buffer = await fs.readFile(imgPath);
        const jpg    = await pdfDoc.embedJpg(buffer);
        const page   = pdfDoc.addPage([jpg.width, jpg.height]);
        page.drawImage(jpg,{x:0,y:0});
        await fs.remove(imgPath);
      }
      const pdfPath = path.join(mangaDir, `${safe}.pdf`);
      await fs.writeFile(pdfPath, await pdfDoc.save());

      console.log(`✅ Saved ${ch.title}.pdf`);
      results.push({ title: ch.title, url: ch.url, date: ch.date, file: pdfPath });

    } catch (e) {
      console.error(`❌ ${ch.title}: ${e.message}`);
    }
  }

  await browser.close();

  // 8) metadata
  await fs.writeJSON(path.join(mangaDir,'metadata.json'), results, {spaces:2});
  const csv = ['title,url,date,file', ...results.map(o=>
    `"${o.title}","${o.url}","${o.date}","${o.file}"`
  )].join('\n');
  await fs.writeFile(path.join(mangaDir,'metadata.csv'), csv);

  console.log('\n🎉 Done! All files in', mangaDir);
  process.exit(0);

})();
