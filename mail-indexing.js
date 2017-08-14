/* eslint-disable comma-dangle */
const Promise = require('bluebird');

const path = require('path');
const fs = Promise.promisifyAll(require('fs'));
const walk = require('walk');
const mkdirp = require('mkdirp');

const lunr = require('lunr');
require('lunr-languages/lunr.stemmer.support')(lunr);
require('lunr-languages/lunr.fr')(lunr);

let i = 0;

function processFile(fileStat, sourceDir, index, next) {
  const sourceFile = path.resolve(sourceDir, fileStat.name);
  fs.readFileAsync(sourceFile, {})
    .then((contents) => {
      if (contents.length < 50000) {
        const ext = path.extname(sourceFile);
        const filename = path.basename(sourceFile, ext);
        const filePath = sourceFile.substr(sourceDir.length + 1);

        i++;
        console.log(i, path.basename(sourceDir), filePath);

        index.add({
          href: filePath,
          title: filename,
          date: fileStat.mtime.toUTCString(),
          // hacky way to strip html, you should do better than that ;)
          content: contents.toString().replace(/<[^>]*>/g, ' '),
          // cheerio.load(entry.content.replace(/<[^>]*>/g, ' ')).root().text(),
        });
      }
      //  store[filePath] = {title: filename};
    })
    .then(next)
    .catch((err) => {
      console.log(err);
      throw new Error(err);
    });
}

function processDirectory(sourceDir, index) {
//
  function fileHandler(root, fileStat, next) {
    if (!fileStat.name.endsWith('.txt')) {
      next();
    } else {
      processFile(fileStat, root, index, next);
    }
  }


  function errorsHandler(root, nodeStatsArray, next) {
    nodeStatsArray.forEach((n) => {
      console.error(`[ERROR] ${n.name}`);
      console.error(n.error.message || (`${n.error.code}: ${n.error.path}`));
    });
    next();
  }

  function endHandler(root, nodeStatsArray, next) {
    const indexPath = `target/searchIndex-${path.basename(sourceDir)}.json`;
    console.log(`all done for ${indexPath}`);
    fs.writeFileAsync(indexPath, JSON.stringify(index), {});
  }


  const walker = walk.walk(sourceDir, { followLinks: false });

  walker.on('file', fileHandler);
  walker.on('errors', errorsHandler); // plural
  walker.on('end', endHandler);
}


mkdirp('./target');


const sourceDir = path.resolve('/media/uvba7442/mail/mail/test/out');

fs.readdirAsync(sourceDir)
  .then(files =>
    Promise.all(
      files.map(
        file => fs
          .statAsync(path.resolve(sourceDir, file))
          .then((fileStats) => {
            if (fileStats.isDirectory()) {
              // create the index
              const index = lunr(function () {
                // boost increases the importance of words found in this field
                this.field('title', { boost: 10 });
                this.field('content');
                this.field('date');
                // the id
                this.ref('href');

                processDirectory(path.resolve(sourceDir, file), this);
              });
            }
          })
      )
    )
  );

// // create the index
// const index = lunr(function () {
//   // boost increases the importance of words found in this field
//   this.field('title', { boost: 10 });
//   this.field('content');
//   this.field('date');
//   // the id
//   this.ref('href');
//
//   processDirectory(sourceDir, this);
// });

// this is a store with some document meta data to display
// in the search results.
// const store = {};

