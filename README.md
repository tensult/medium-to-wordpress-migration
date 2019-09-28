# medium-to-wordpress-migration
Script to export [Medium](https://www.medium.com) blogs to wordpress rss xml format

There are many methods for exporting individual user blogs from [Medium](https://www.medium.com) to wordpress but we didn't find an easy way to move entire medium publication to wordpress so this script can help you to migrate both personal or publication medium blogs to wordpress. 

## Usage
**Download the package**
```sh
git clone https://github.com/tensult/medium-to-wordpress-migration.git
cd medium-to-wordpress-migration
npm install
```

**Extract using URLs files**
* `node . -u <your-medium.urls.txt>`
* Keep one URL per line in **your-medium.urls.txt** 

**Extract using URLs as command line argument**
* `node . -U "url1,url2"`

Extract using HTML of (https://medium.com/your-publication/stories/published or https://medium.com/me/stories/public)
* `node . -h <your-medium-listing.html>`

## Features
* Github Gist using [oembed-gist](https://wordpress.org/plugins/oembed-gist/) plugin
* Figures
* Caching 
  * Caches the URL output in **downloadedUrls** folder to avoid downloading the same URL again and again.
  