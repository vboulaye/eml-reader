/* eslint-disable no-bitwise */
const args = process.argv.slice(2);
const simpleParser = require('mailparser').simpleParser;
const walk = require('walk');
const path = require('path');
const moment = require('moment');
const Promise = require('bluebird');
const fs = Promise.promisifyAll(require('fs'));
const mkdirp = require('mkdirp');
const Utimes = Promise.promisifyAll(require('@ronomon/utimes'));
const rimraf = require('rimraf');
const waitOnAsync = Promise.promisify(require('wait-on'));
const CryptoJS = require('crypto-js');
const transliterate = require('transliteration').transliterate;


function buildMonthlyDirName(outputDirectory, creationDate) {
  const date = creationDate.toISOString().slice(0, 7);// .replace(/:/g, '').replace(/-/g, '');
  return path.resolve(outputDirectory, date);
}

function createDirAsync(parameters) {
  const outputDirectory = parameters.outputDirectory;
  return new Promise((resolve, reject) => {
    mkdirp(outputDirectory, 0o755, (err, made) => {
      if (err) {
        reject(err);
      } else {
        resolve(made);
      }
    });
  })
  // .catch((err) => {
  //     if (err.code === 'EEXIST') {
  //         console.log(targetDirDate + ' already exists');
  //         //  "ignored"
  //     }
  //     else {
  //         throw err;
  //     }
  // })
  ;
}


function cleanupName(name) {
  return transliterate(name)
    .replace(/_+/g, '_')
    .replace(/_+$/, '')
    .replace(/^_+/, '')
    .replace(/:/g, '\uFF1A') // another kind of colon
    .replace(/\//g, '\u2044') // another kind of slash
    .replace(/\\/g, '\u29F9') // another kind of backslash
  ;
}


function writeFileAsync(outputDirectory, targetFileName, extension, buffer, creationDate, sha1) {
  const fileNameEscaped = cleanupName(targetFileName);

  const saneName = fileNameEscaped
    .replace(/^Conversation avec (.{1,70})$/, `Chat with $1 on ${creationDate.toISOString()}`)
    .replace(/^(RE\s*\uFF1A\s*)+(.*)$/i, '$2 (RE)')
    .replace(/^(TR\s*\uFF1A\s*)+(.*)$/i, '$2 (TR)')
    ;

  const saneNameSha1 = `${saneName} [${sha1}]${extension}`;

  const targetBasePath = path.resolve(outputDirectory, saneNameSha1);

  console.log(`writing ${targetBasePath}`);
  return fs.openAsync(targetBasePath,
    fs.constants.O_WRONLY
        | fs.constants.O_CREAT
        | fs.constants.O_TRUNC
        | fs.constants.O_SYNC
    , 0o444)
    .catch((err) => {
      console.log(err.stack);
      throw err;
    })
    .then(fd => fs.writeFileAsync(fd, buffer, {})
      .then(() => fd))
    .catch((err) => {
      console.log(err);
      throw err;
    })
    .then(fd => fs.closeAsync(fd))
    .catch((err) => {
      console.log(err);
      throw err;
    })
    .then(() => {
      const creationDateEpoc = creationDate.valueOf();
      const btime = creationDateEpoc;
      const mtime = creationDateEpoc;
      const atime = creationDateEpoc;
      return Utimes.utimesAsync(targetBasePath, btime, mtime, atime);
    })
    .catch((err) => {
      console.log(err);
      throw err;
    })
  ;
}

//
function fileHandler(root, fileStat, next) {
  fs.readFile(path.resolve(root, fileStat.name), (err, buffer) => {
    const fileContents = buffer.toString();
    const sha1 = CryptoJS.SHA1(fileContents).toString().substr(0, 4);
    //  console.log(fileStat.name, buffer.byteLength, ' sha1 ', sha1);
    //        const subdir = path.relative(path.normalize(sourceDir), root);
    const sourceExtension = path.extname(fileStat.name);


    if (sourceExtension.endsWith('.ics')) {
      simpleParser(buffer)
        .then((calendar) => {
          //   const headers = [...calendar.headers];

          const creationDate = moment(calendar.headers.get('created'), 'YYYYMMDDTHHmmssZ');
          const subject = calendar.headers.get('summary');

          const targetFileName = `${subject}`;

          const bakOutputDir = buildMonthlyDirName(path.resolve(targetDir, 'bak'), creationDate);
          const mainOutputDir = buildMonthlyDirName(path.resolve(targetDir, 'archive'), creationDate);

          // cannotmake it work asynchronously
          mkdirp.sync(bakOutputDir, 0o755);
          mkdirp.sync(mainOutputDir, 0o755);

          let writePromise = writeFileAsync(bakOutputDir, targetFileName, '.ics', buffer, creationDate, sha1);

          const description = moment(calendar.headers.get('description'), 'YYYYMMDDTHHmmssZ');
          if (description) {
            writePromise = writePromise
              .then(writeFileAsync(mainOutputDir, targetFileName, '.txt', description, creationDate, sha1));
          }

          return writePromise;
        })
        .then(next);
    } else if (fileStat.name.endsWith('.eml')) {
      simpleParser(buffer)
        .then((email) => {
          // console.log(fileStat.name);
          //   const headers = [...email.headers];
          const creationDate = email.date;


          const subject = email.subject
                        || (email.text // no subject => tries the first line
                          .replace(/^\s+/, '') // remove the first blanks and line feeds
                          .split('\n')[0]); // take the first line

          const targetFileName = `${subject}`;

          const bakOutputDir = buildMonthlyDirName(path.resolve(targetDir, 'bak'), creationDate);
          const mainOutputDir = buildMonthlyDirName(path.resolve(targetDir, 'archive'), creationDate);


          mkdirp.sync(bakOutputDir, 0o755);
          mkdirp.sync(mainOutputDir, 0o755);
          let writePromise =
                        writeFileAsync(bakOutputDir, targetFileName, '.eml', buffer, creationDate, sha1)
                    ;

          if (email.text) {
            writePromise = writePromise
              .then(writeFileAsync(mainOutputDir, targetFileName, '.txt', email.text, creationDate, sha1));
          }

          // we do not want a separate file in all cases
          const shouldOutputHtml = !subject
            // ignore communicator chats
            .startsWith('Conversation avec ');

          if (shouldOutputHtml) {
            if (email.html) {
              writePromise = writePromise
                .then(writeFileAsync(mainOutputDir, targetFileName, '.html', email.html, creationDate, sha1));
            } else if (email.textAsHtml) {
              writePromise = writePromise
                .then(writeFileAsync(mainOutputDir, targetFileName, '.html', email.textAsHtml, creationDate, sha1));
            }
          }

          const attachmentDedups = {};
          email.attachments.forEach((attachment) => {
            if (attachmentDedups[attachment.checksum]) {
              if (!attachmentDedups[attachment.checksum].filename) {
                attachmentDedups[attachment.checksum] = attachment;
              } else {
                //  console.log('duplicate attachment', attachmentDedups[attachment.checksum].filename , attachment.filename)
              }
            } else {
              attachmentDedups[attachment.checksum] = attachment;
            }
          });

          const attachmentFilenameDedups = {};
          Object.keys(attachmentDedups).forEach((checksum) => {
            const attachment = attachmentDedups[checksum];
            if (!attachment.filename) {
              attachment.filename = checksum;
            }
            if (attachmentFilenameDedups[attachment.filename]) {
              // console.log('duplicate filename attachment ',
              // attachment.filename, attachmentFilenameDedups[attachment.filename].checksum
              // , attachment.checksum)
              attachment.filename = `${attachment.checksum.substr(0, 4)} - ${attachment.filename}`;
              attachmentFilenameDedups[attachment.filename] = attachment;
            } else {
              attachmentFilenameDedups[attachment.filename] = attachment;
            }
          });
          Object.keys(attachmentFilenameDedups).forEach((key) => {
            const attachment = attachmentFilenameDedups[key];
            writePromise = writePromise
              .then(writeFileAsync(mainOutputDir, targetFileName,
                ` - ${attachment.filename}`, attachment.content, creationDate, sha1));
          });

          return writePromise;
        })
        .then(next);
    } else {
      throw new Error(`unknown file type ${fileStat.name}`);
    }
  });
}

function errorsHandler(root, nodeStatsArray, next) {
  nodeStatsArray.forEach((n) => {
    console.error(`[ERROR] ${n.name}`);
    console.error(n.error.message || (`${n.error.code}: ${n.error.path}`));
  });
  next();
}

function endHandler() {
  console.log('all done');
}

const sourceDir = args[0] || '/media/uvba7442/mail/mail/test/eb/';
const targetDir = args[1] || '/media/uvba7442/mail/mail/test/transform/';


rimraf.sync(targetDir);
fs.mkdirSync(targetDir);

const walker = walk.walk(sourceDir, { followLinks: false });
walker.on('file', fileHandler);
walker.on('errors', errorsHandler); // plural
walker.on('end', endHandler);

process.on('unhandledRejection', (reason) => {
  console.log('Reason: ', reason);
});
