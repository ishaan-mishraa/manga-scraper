const adapter = require('./adapters.interface');

module.exports = {
  supports(url) {
    return url.includes('manhuaga.com');
  },

  async fetchChapterList(seriesUrl) {
    const puppeteer = require('puppeteer');
    const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0');
    await page.goto(seriesUrl, { waitUntil: 'networkidle2' });
    await page.waitForSelector('#chapterlist li', { timeout: 10000 });

    const chapters = await page.$$eval('#chapterlist li', items =>
      items.map((li) => {
        const aTag = li.querySelector('a');
        const dateTag = li.querySelector('.chapterdate');
        return {
          title: aTag?.innerText.trim().replace(/\s+/g, ' ') || 'Untitled',
          url: aTag?.href,
          date: dateTag?.innerText.trim() || '',
        };
      })
    );

    await browser.close();
    return chapters.reverse().map((ch, i) => ({
      ...ch,
      title: `Chapter ${i + 1}`
    }));
  },

  async fetchPageImageUrls(chapterUrl, browser) {
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0');
    await page.goto(chapterUrl, { waitUntil: 'networkidle2' });
    await page.waitForSelector('#readerarea img.ts-main-image', { timeout: 10000 });

    const urls = await page.$$eval('#readerarea img.ts-main-image', imgs =>
      imgs.map(img => img.src)
    );

    await page.close();
    return urls;
  }
};
