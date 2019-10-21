const cheerio = require('cheerio');
const cli = require('cli');
const fs = require('fs');
const path = require('path');

const xml2js = require('xml2js');
const moment = require('moment');
const uuid5 = require('uuid/v5');
const phantom = require('phantom');
const htmlEntities = require('html-entities').AllHtmlEntities;

const xmlParser = new xml2js.Parser({ cdata: true });
const xmlBuilder = new xml2js.Builder({ cdata: true });

const urlCacheDir = 'downloadedUrls/';

const cliArgs = cli.parse({
    mediumPublicationHtmlFile: ['h', 'HTML source of https://medium.com/<your-publication>/latest, https://medium.com/<your-publication>/stories/published or https://medium.com/me/stories/public', 'file'],
    mediumPublicationUrl: ['p', 'https://medium.com/<your-publication>/latest', 'string'],
    mediumPublicationUrlsFile: ['u', 'File containing all urls of https://medium.com/<your-publication>', 'file'],
    mediumPublicationUrls: ['U', 'Comma separated urls of https://medium.com/<your-publication>', 'String'],
    refetchPublicationUrl: ['r', 'Should refetch PublicationUrl', 'boolean', false],
    outWPXMLFileName: ['o', 'Generated Wordpress XML file name', 'string', 'wp-posts.xml']
});

if (!cliArgs.mediumPublicationUrl &&
    !cliArgs.mediumPublicationHtmlFile &&
    !cliArgs.mediumPublicationUrlsFile &&
    !cliArgs.mediumPublicationUrls
) {
    cli.getUsage();
}

async function wait(timeInMills) {
    return new Promise((resolve) => {
        setTimeout(() => {
            resolve();
        }, timeInMills);
    });
}

// Scrolls the page till new content is available
async function scrollPage(page) {
    const currentContentLength = (await page.property('content')).length;
    await page.evaluate(function () {
        window.document.body.scrollTop = document.body.scrollHeight;
    });
    await wait(Math.max(5000, 10000 * Math.random()));
    const nextContentLength = (await page.property('content')).length;
    if (currentContentLength != nextContentLength) {
        console.log("Scrolling page:", await page.property('url'), "for more content");
        await scrollPage(page);
    }
}

// Scrolls the page and gets the page content using PhantomJS
async function getPageData(pageUrl, shouldScrollPage) {
    const instance = await phantom.create();
    const page = await instance.createPage();
    await page.open(pageUrl);
    if (shouldScrollPage) {
        await scrollPage(page);
    }
    const pageContent = await page.property('content');
    await page.close();
    await instance.exit();
    return pageContent;
};

function makeMediumUrl(url) {
    url = url.split('?')[0];
    if (!url.startsWith('https://medium.com')) {
        url = 'https://medium.com/' + url;
        url = url.replace("medium.com//", "medium.com/");
    }
    return url;
}

function getPostUrlsFromHtml(htmlContent) {
    const $ = cheerio.load(htmlContent);
    const postUrls = new Set();
    // For https://medium.com/me/stories/public
    // (Make sure to scroll till the end)
    $('h3 a[href*="your_stories_page"]').each((index, elm) => {
        postUrls.add(makeMediumUrl($(elm).attr('href')));
    });

    // For https://medium.com/<your-publication>/stories/published 
    // (Make sure to scroll till the end)
    $('h3 a[href*="collection_detail"]').each((index, elm) => {
        postUrls.add(makeMediumUrl($(elm).attr('href')));
    });

    // For https://medium.com/<your-publication>/latest
    // (Make sure to scroll till the end)
    $('div.postArticle-content a[data-post-id]').each((index, elm) => {
        postUrls.add(makeMediumUrl($(elm).attr('href')));
    });
    return Array.from(postUrls);
}

function getPostsUrlsFromHtmlFile(htmlFile) {
    const mediumHtml = fs.readFileSync(htmlFile);
    return getPostUrlsFromHtml(mediumHtml);
}

async function getPostsUrlsFromPublicationUrl(publicationUrl) {
    const pageData = await fetchUrl(publicationUrl, { scrollPage: true, refetch: cliArgs.refetchPublicationUrl });
    return getPostUrlsFromHtml(pageData);
}

function getPostsUrlsFromUrlsFile(urlsFile) {
    const mediumUrls = fs.readFileSync(urlsFile, { encoding: 'utf-8' }).trim();
    if (!mediumUrls) {
        return [];
    }
    const postUrls = mediumUrls.split(/\s+/);
    return postUrls;
}

function getPostsUrlsFromUrlsString(urlsString) {
    if (!urlsString.trim()) {
        return [];
    }
    const postUrls = urlsString.split(/[\s,]+/);
    return postUrls;
}

async function getPostUrls() {
    let postUrls = [];
    if (cliArgs.mediumPublicationUrl) {
        postUrls = await getPostsUrlsFromPublicationUrl(cliArgs.mediumPublicationUrl);
    }
    else if (cliArgs.mediumPublicationUrls) {
        postUrls = getPostsUrlsFromUrlsString(cliArgs.mediumPublicationUrls);
    }
    else if (cliArgs.mediumPublicationHtmlFile) {
        postUrls = getPostsUrlsFromHtmlFile(cliArgs.mediumPublicationHtmlFile);
    }
    else if (cliArgs.mediumPublicationUrlsFile) {
        postUrls = getPostsUrlsFromUrlsFile(cliArgs.mediumPublicationUrlsFile);
    }
    if (postUrls && postUrls.length) {
        return postUrls;
    } else {
        console.warn("No medium urls to export");
        return [];
    }
}

async function getSampleWPJSON() {
    const wpSampleXML = fs.readFileSync('wp-skeleton.xml');
    const sampleWPJSON = await xmlParser.parseStringPromise(wpSampleXML);
    return sampleWPJSON;
}

function makeArray(objects) {
    if (Array.isArray(objects)) {
        return objects;
    } else {
        return [objects];
    }
}

async function fetchUrl(url, options) {
    options = options || {};
    if (!url) {
        return "";
    }
    const urlFileId = uuid5(url, uuid5.URL) + ".html";
    fs.mkdirSync(urlCacheDir, { recursive: true });
    let urlContent = '';
    const urlFileName = path.join(urlCacheDir, urlFileId);
    if (!options.refetch && fs.existsSync(urlFileName)) {
        console.log("Fetching url from cache", url, "with cacheKey", urlFileName);
        urlContent = fs.readFileSync(urlFileName, { encoding: 'utf-8' });
    } else {
        console.log("Fetching url", url);
        urlContent = await getPageData(url, options.scrollPage);
        fs.writeFileSync(urlFileName, urlContent);
    }
    return urlContent;
}

async function fetchUrls(links, options) {
    const urls = makeArray(links);
    const urlContents = [];
    for (let url of urls) {
        urlContents.push(await fetchUrl(url, options));
    }
    return urlContents;
}


function writeWPXML(wpJSON, fileName) {
    const wpXML = xmlBuilder.buildObject(wpJSON);
    fs.writeFileSync(fileName, wpXML);
}

function getDateInFormat(pubDate, format) {
    return moment(pubDate).utc().format(format);
}

function removeClassForAllElements(cheerioContainer, element) {
    if (!element || element.children().length < 1) {
        return;
    }
    element.children().each((index, elm) => {
        cheerioContainer(elm).removeAttr('class').removeAttr('id');
        removeClassForAllElements(cheerioContainer, cheerioContainer(elm));
    });
}

function stringReplaceAt(text, index, replacement) {
    return text.substr(0, index) + replacement + text.substr(index + replacement.length);
}

function replaceHTags(content) {
    const hTagRegExp = new RegExp(/h(\d)\>/g);
    let newContent = content;
    let hTagRegExpResult = hTagRegExp.exec(content);
    while (hTagRegExpResult && hTagRegExpResult.index < content.length) {
        newContent = stringReplaceAt(newContent, hTagRegExpResult.index + 1, parseInt(hTagRegExpResult[1]) + 2);
        hTagRegExpResult = hTagRegExp.exec(content);
    }
    return newContent;
}

function prepareCategory(postContainer) {
    const $ = postContainer;
    const category = [
        {
            "_": "Technology",
            "$": {
                "domain": "category",
                "nicename": "technology"
            }
        }
    ];

    $('li a[href*="/tag/"]').each((index, elm) => {
        tagVal = $(elm).text();
        category.push({
            "_": tagVal,
            "$": {
                "domain": "post_tag",
                "nicename": tagVal.toLowerCase()
            }
        });
    });
    return category;
}

function handleUrls(contentObj, urlsMapping) {
    contentObj('a').each((index, elm) => {
        const href = contentObj(elm).attr("href");
        const urlRelative = href.split("?")[0];
        if (urlsMapping[urlRelative]) {
            contentObj(elm).attr("href", urlsMapping[urlRelative]);
        }
    });
}

function handleImages(contentObj) {
    contentObj('figure noscript').each((index, elm) => {
        let imgHtml = contentObj(elm).html();
        if (imgHtml.match('&lt;')) {
            imgHtml = htmlEntities.decode(imgHtml);
        }
        const figObj = contentObj(elm).closest("figure");
        const figCaption = contentObj(figObj).children('figcaption');
        figObj.html(imgHtml);
        contentObj(figObj).children('img').removeAttr('class');
        figObj.append(figCaption);
    });
}

async function handleIframes(contentObj) {
    const iframeUrls = []
    contentObj('figure div iframe').each((index, elm) => {
        iframeUrls.push(contentObj(elm).attr('src'));
    });

    const iframeHtmls = await fetchUrls(iframeUrls);
    const gistUrls = [];
    for (let iframeHtml of iframeHtmls) {
        const iframeObj = cheerio.load(iframeHtml);
        const gistUrl = iframeObj('script[src*="gist.github"]').attr('src');
        gistUrls.push(gistUrl);
    }
    const gistHtmls = await fetchUrls(gistUrls);
    contentObj('figure div iframe').each((index, elm) => {
        const matchedUrl = gistHtmls[index].match(/https:\/\/gist\.github\.com\/[^"]+\/raw\/[^\\]+/g);
        if (matchedUrl) {
            const gistUrl = matchedUrl[0].replace(/\/raw\/[^\/]+\//, ".js?file=");
            const figureObj = contentObj(elm).closest('figure');
            figureObj.html(
                `<div class="oembed-gist">
                    <script src="${gistUrl}">
                    </script>
                    <noscript>
                    View the code on <a href="${gistUrl.split('.js?')[0]}">Gist</a>.
                    </noscript></div>`);
        }
    });
}

async function handleFigures(contentObj) {
    if (contentObj('figure div').length > 0) {
        handleImages(contentObj);
        await handleIframes(contentObj);
    }
}
function handleLineBreaks(contentObj) {
    contentObj('p').each((index, elm) => {
        const pHtml = contentObj(elm).html();
        contentObj(elm).html(pHtml.replace(/\<\/?br\>/g, " "));
    });
}

function handleEmbeddedLinks(contentObj) {
    if (contentObj('a section').length > 0) {
        contentObj('a section').each((index, elm) => {
            contentObj(elm).find("h4").remove();
            contentObj(elm).closest("div").addClass("embedded-link");
        });
    }
}
async function prepareSectionContent(sectionContainer, urlsMapping) {
    const $ = sectionContainer;
    const firstParaIndex = $.find("p").index();
    const firstFigureIndex = $.find("figure").index();
    if (firstFigureIndex !== -1 && firstParaIndex > firstFigureIndex) {
        $.find("figure").first().prevAll().remove();
    } else {
        $.find("p").first().prevAll().remove();
    }

    const contentObj = cheerio.load($.find("p").first().parent().html());
    removeClassForAllElements(contentObj, contentObj('body'));
    handleUrls(contentObj, urlsMapping);
    handleEmbeddedLinks(contentObj);
    handleLineBreaks(contentObj);
    await handleFigures(contentObj);
    return replaceHTags(contentObj('body').html());
}

async function preparePostContent(postContainer, urlsMapping) {
    const $ = postContainer;
    const sections = $('article div').children('section');
    const sectionContents = [];
    for (let i = 0; i < sections.length; i++) {
        const elm = sections.get(i);
        sectionContents.push(await prepareSectionContent($(elm), urlsMapping));
    }
    const htmlContent = sectionContents
        .join('<hr class="wp-block-separator"/>')
        .replace(/\s+/g, " ");
    return htmlContent;
}

async function prepareWPPostJson(postDataHtml, urlsMapping) {
    const postJson = {};
    const $ = cheerio.load(postDataHtml);
    postJson.title = [$("title").text().replace('- Tensult Blogs - Medium', '')];
    const pubDateStr = $('meta[property="article:published_time"]').attr('content');
    postJson.pubDate = [getDateInFormat(pubDateStr, "ddd, DD MMM YYYY HH:mm:ss ZZ")]
    postJson['dc:creator'] = [$('meta[name="author"]').attr('content')];
    postJson['content:encoded'] = [await preparePostContent($, urlsMapping)];
    postJson['excerpt:encoded'] = [''];
    postJson['wp:post_date_gmt'] = [getDateInFormat(pubDateStr, "YYYY-MM-DD HH:mm:ss")];
    postJson['wp:status'] = ['publish'];
    postJson['wp:post_type'] = ['post'];
    postJson.category = prepareCategory($);
    return postJson;
}

async function prepareWPPostsJson(postUrls) {
    const urlsMapping = {};
    const posts = [];
    for (let postUrl of postUrls) {
        const postDataHtml = await fetchUrl(postUrl);
        const $ = cheerio.load(postDataHtml);
        const title = $("title").text().replace('- Tensult Blogs - Medium', '');
        const newUrl = "/" + title.trim().toLowerCase()
            .replace(/\s+/g, '-')
            .replace(/[^-0-9a-z]/g, '');
        const postUrlRelative = postUrl.replace("https://medium.com", '')
            .replace("https://www.medium.com", '');
        urlsMapping[postUrlRelative] = newUrl;
    }

    for (let postUrl of postUrls) {
        const postDataHtml = await fetchUrl(postUrl);
        posts.push(await prepareWPPostJson(postDataHtml, urlsMapping));
    }
    return posts;
}

async function generateWPXML() {
    try {
        const wpJson = await getSampleWPJSON();
        const items = await prepareWPPostsJson(await getPostUrls());
        wpJson.rss.channel[0].item = items;
        writeWPXML(wpJson, cliArgs.outWPXMLFileName);
    } catch (err) {
        console.error(err);
    }
}

generateWPXML();