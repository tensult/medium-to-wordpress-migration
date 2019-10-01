const cheerio = require('cheerio');
const superagent = require('superagent');
const cli = require('cli');
const fs = require('fs');
const path = require('path');

const xml2js = require('xml2js');
const moment = require('moment');
const uuid5 = require('uuid/v5');

const xmlParser = new xml2js.Parser({ cdata: true });
const xmlBuilder = new xml2js.Builder({ cdata: true });

const urlCacheDir = 'downloadedUrls/';

const cliArgs = cli.parse({
    mediumPublicationHtmlFile: ['h', 'HTML source of https://medium.com/<your-publication>/latest, https://medium.com/<your-publication>/stories/published or https://medium.com/me/stories/public', 'file'],
    mediumPublicationUrlsFile: ['u', 'File containing all urls of https://medium.com/<your-publication>', 'file'],
    mediumPublicationUrls: ['U', 'Comma separated urls of https://medium.com/<your-publication>', 'String'],
    outWPXMLFileName: ['o', 'Generated Wordpress XML file name', 'string', 'wp-posts.xml']
});

if (!cliArgs.mediumPublicationHtmlFile &&
    !cliArgs.mediumPublicationUrlsFile &&
    !cliArgs.mediumPublicationUrls
) {
    cli.getUsage();
}

function makeMediumUrl(url) {
    url = url.split('?')[0];
    if (!url.startsWith('https://medium.com')) {
        url = 'https://medium.com/' + url;
        url = url.replace("medium.com//", "medium.com/");
    }
    return url;
}

function getPostsUrlsFromHtmlFile(htmlFile) {
    const mediumHtml = fs.readFileSync(htmlFile);
    const $ = cheerio.load(mediumHtml);
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

function getPostUrls() {
    let postUrls = [];
    if (cliArgs.mediumPublicationUrls) {
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

async function fetchUrl(url, shouldRefetch) {
    if (!url) {
        return "";
    }
    const urlFileId = uuid5(url, uuid5.URL) + ".html";
    fs.mkdirSync(urlCacheDir, { recursive: true });
    let urlContent = '';
    const urlFileName = path.join(urlCacheDir, urlFileId);
    if (!shouldRefetch && fs.existsSync(urlFileName)) {
        console.log("Fetching url from cache", url, "with cacheKey", urlFileName);
        urlContent = fs.readFileSync(urlFileName, { encoding: 'utf-8' });
    } else {
        console.log("Fetching url", url);
        urlContent = (await superagent.get(url)).text;
        fs.writeFileSync(urlFileName, urlContent);
    }
    return urlContent;
}

async function fetchUrls(links, shouldRefetch) {
    const urls = makeArray(links);
    const urlContents = [];
    for (let url of urls) {
        urlContents.push(await fetchUrl(url, shouldRefetch));
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

function replaceHTags(content) {
    return content.replace(/<h1/g, '<h3')
        .replace(/h1>/g, 'h3>')
        .replace(/h2>/g, 'h4>')
        .replace(/<h2/g, '<h4');
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

function handleImages(contentObj) {
    contentObj('figure noscript').each((index, elm) => {
        const imgHtml = contentObj(elm).html();
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

async function preparePostContent(postContainer) {
    const $ = postContainer;
    const firstPara = $("article p").first()
    if (firstPara.prev().length && firstPara.prev()[0].name == 'figure') {
        $("article figure").first().prevAll().remove();
    } else {
        firstPara.prevAll().remove();
    }
    const contentObj = cheerio.load($("article p").first().parent().html());
    removeClassForAllElements(contentObj, contentObj('body'));
    await handleFigures(contentObj);
    return replaceHTags(contentObj('body').html());
}

async function prepareWPPostJson(postDataHtml) {
    const postJson = {};
    const $ = cheerio.load(postDataHtml);
    postJson.title = [$("title").text().replace('- Tensult Blogs - Medium', '')];
    const pubDateStr = $('meta[property="article:published_time"]').attr('content');
    postJson.pubDate = [getDateInFormat(pubDateStr, "ddd, DD MMM YYYY HH:mm:ss ZZ")]
    postJson['dc:creator'] = [$('meta[name="author"]').attr('content')];
    postJson['content:encoded'] = [await preparePostContent($)];
    postJson['excerpt:encoded'] = [''];
    postJson['wp:post_date_gmt'] = [getDateInFormat(pubDateStr, "YYYY-MM-DD HH:mm:ss")];
    postJson['wp:status'] = ['publish'];
    postJson['wp:post_type'] = ['post'];
    postJson.category = prepareCategory($);
    return postJson;
}

async function prepareWPPostsJson(postUrls) {
    const posts = [];
    for (let postUrl of postUrls) {
        const postDataHtml = await fetchUrl(postUrl);
        posts.push(await prepareWPPostJson(postDataHtml));
    }
    return posts;
}

async function generateWPXML() {
    const wpJson = await getSampleWPJSON();
    const items = await prepareWPPostsJson(getPostUrls());
    wpJson.rss.channel[0].item = items;
    writeWPXML(wpJson, cliArgs.outWPXMLFileName);
}

generateWPXML();