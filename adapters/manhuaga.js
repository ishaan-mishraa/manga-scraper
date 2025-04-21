// adapters/manhuaga.js
const puppeteer = require('puppeteer');

module.exports = {
  name: 'manhuaga.com',

  supports(url) {
    return url.includes('manhuaga.com');
  },

  /**
   * List all manga on the site.
   * Called when the user gives a base/manhuaga URL.
   */
  async fetchMangaList(baseUrl, browser) {
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0');
    await page.goto(baseUrl, { waitUntil: 'networkidle2' });
    // wait for the manga‐tiles to render
    await page.waitForSelector('.bsx .bigor .tt a', { timeout: 10000 });

    const mangaList = await page.$$eval(
      '.bsx .bigor .tt a',
      links => links.map(a => ({
        title: a.textContent.trim(),
        url:   a.href
      }))
    );

    await page.close();
    return mangaList;
  },

  /**
   * Given a specific manga URL, list its chapters.
   */
  async fetchChapterList(seriesUrl) {
    const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
    const page    = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0');
    await page.goto(seriesUrl, { waitUntil: 'networkidle2' });
    await page.waitForSelector('#chapterlist li', { timeout: 10000 });

    const chapters = await page.$$eval('#chapterlist li', items =>
      items.map(li => {
        const aTag     = li.querySelector('a');
        const dateTag  = li.querySelector('.chapterdate');
        return {
          title: aTag?.innerText.trim().replace(/\s+/g,' ') || 'Untitled',
          url:   aTag?.href,
          date:  dateTag?.innerText.trim() || ''
        };
      })
    );

    await browser.close();
    return chapters.reverse().map((ch, i) => ({
      ...ch,
      title: `Chapter ${i + 1}`  // your manual numbering
    }));
  },

  /**
   * Given a chapter URL & a Puppeteer instance, return its image URLs.
   */
  async fetchPageImageUrls(chapterUrl, browser) {
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0');
    await page.goto(chapterUrl, { waitUntil: 'networkidle2' });
    await page.waitForSelector('#readerarea img.ts-main-image', { timeout: 10000 });

    const urls = await page.$$eval(
      '#readerarea img.ts-main-image',
      imgs => imgs.map(img => img.src)
    );

    await page.close();
    return urls;
  }
};
