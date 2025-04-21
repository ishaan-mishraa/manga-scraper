module.exports = {
    supports(url) {
      throw new Error('supports() not implemented');
    },
    fetchChapterList(url) {
      throw new Error('fetchChapterList() not implemented');
    },
    fetchPageImageUrls(chapterUrl, browser) {
      throw new Error('fetchPageImageUrls() not implemented');
    }
  };
  