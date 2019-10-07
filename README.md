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

**Extract using Publication URL (https://medium.com/your-publication/latest)**
* `node . -p https://medium.com/your-publication/latest`
* 
**Extract using HTML of (https://medium.com/your-publication/latest, https://medium.com/your-publication/stories/published or https://medium.com/me/stories/public)**
* Keep scroll till the end and then follow the below instructions
![Open Inspector in the browser](https://user-images.githubusercontent.com/33080863/65932401-2bbc5400-e42b-11e9-9589-82ca21e4aae0.png) (This is for Chrome and might vary for your browser)

![Select root HTML tag](https://user-images.githubusercontent.com/33080863/65932555-cddc3c00-e42b-11e9-92ed-3b5b61998189.png)

![Copy HTML content](https://user-images.githubusercontent.com/33080863/65932614-0a0f9c80-e42c-11e9-98e3-9c79d3d261c7.png)

* Use any text editor to save as <your-medium-listing.html> file.
* `node . -h <your-medium-listing.html>`

## Features
* Github Gist using [oembed-gist](https://wordpress.org/plugins/oembed-gist/) plugin
* Figures
* Caching 
  * Caches the URL output in **downloadedUrls** folder to avoid downloading the same URL again and again.
  
