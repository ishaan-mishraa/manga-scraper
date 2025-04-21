const puppeteer = require('puppeteer');

module.exports = {
  name: 'manhuafast.net',

  supports(url) {
    return url.includes('manhuafast.net');
  },

  async fetchChapterList(seriesUrl) {
    const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0');
    await page.goto(seriesUrl, { waitUntil: 'networkidle2' });
    await page.waitForSelector('li.wp-manga-chapter a', { timeout: 10000 });

    const chapters = await page.$$eval('li.wp-manga-chapter a', (links) =>
      links.map((a, i, all) => ({
        title: `Chapter ${all.length - i}`,
        url: a.href,
        date: a.parentElement.querySelector('.chapter-release-date')?.innerText.trim() || '',
      }))
    );

    await browser.close();
    return chapters;
  },

  async fetchPageImageUrls(chapterUrl, browser) {
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0');
    await page.goto(chapterUrl, { waitUntil: 'networkidle2' });
    await page.waitForSelector('div.page-break.no-gaps img', { timeout: 10000 });

    const imageUrls = await page.$$eval('div.page-break.no-gaps img', imgs =>
      imgs.map(img => img.getAttribute('data-src') || img.src).filter(Boolean)
    );

    await page.close();
    return imageUrls;
  }
};
