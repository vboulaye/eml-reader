/* eslint-disable no-bitwise,no-param-reassign */
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
// const waitOnAsync = Promise.promisify(require('wait-on'));
const CryptoJS = require('crypto-js');
const transliterate = require('transliteration').transliterate;

const iconv = require('iconv-lite');

const FIX_WRONG_ENCODING = true; // transform utf-16 back to utf-8 (wrong encoding declared)
const LOG = true; // console log

// set a default user when nobody is defined
const DEFAULT_USER = 'vincent boulaye';
// how to identify ourselves
const DEFAULT_USER_PATTERN = /boulaye/i;

function buildMonthlyDirName(outputDirectory, creationDate) {
  const date = creationDate.toISOString().slice(0, 7);// .replace(/:/g, '').replace(/-/g, '');
  return path.resolve(outputDirectory, date);
}

// function createDirAsync(parameters) {
//   const outputDirectory = parameters.outputDirectory;
//   return new Promise((resolve, reject) => {
//     mkdirp(outputDirectory, 0o755, (err, made) => {
//       if (err) {
//         reject(err);
//       } else {
//         resolve(made);
//       }
//     });
//   });
// }


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


  const saneNameSha1 = `${fileNameEscaped} [${sha1}]${extension}`;

  const targetBasePath = path.resolve(outputDirectory, saneNameSha1);

  if (LOG) console.log(`writing ${targetBasePath}`);
  return fs.openAsync(targetBasePath,
    fs.constants.O_WRONLY
    | fs.constants.O_CREAT
    | fs.constants.O_TRUNC
    | fs.constants.O_SYNC
    , 0o444)
    .catch((err) => {
      console.error(err.stack);
      throw err;
    })
    .then(fd => fs.writeFileAsync(fd, buffer, {})
      .then(() => fd))
    .catch((err) => {
      console.error(err);
      throw err;
    })
    .then(fd => fs.closeAsync(fd))
    .catch((err) => {
      console.error(err);
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
      console.error(err);
      throw err;
    })
  ;
}


function processFile(sourceFile, outputDir, next) {
  if (LOG) console.log('reading', sourceFile);
  fs.readFile(sourceFile, (err, buffer) => {
    if (!buffer) {
      return;
    }

    const fileContents = buffer.toString();
    const sha1 = CryptoJS.SHA1(fileContents).toString().substr(0, 6);
    //  console.log(fileStat.name, buffer.byteLength, ' sha1 ', sha1);
    //        const subdir = path.relative(path.normalize(sourceDir), root);
    // const sourceExtension = path.extname(fileStat.name);
    const sourceExtension = path.extname(sourceFile);


    if (sourceExtension.endsWith('.ics')) {
      simpleParser(buffer)
        .then((calendar) => {
          //   const headers = [...calendar.headers];

          const creationDate = moment(calendar.headers.get('created'), 'YYYYMMDDTHHmmssZ');
          const subject = calendar.headers.get('summary');

          const targetFileName = `${subject}`;

          const bakOutputDir = buildMonthlyDirName(path.resolve(outputDir, 'eml'), creationDate);
          const mainOutputDir = buildMonthlyDirName(path.resolve(outputDir, 'out'), creationDate);

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
    } else if (sourceFile.endsWith('.eml')) {
      simpleParser(buffer)
        .then((email) => {
          const creationDate = email.date;
          // console.log(fileStat.name);
          //   const headers = [...email.headers];
          let from;
          let fromText;
          if (email.from) {
            fromText = email.from.text || DEFAULT_USER;
            from = (email.from.value[0] || {}).name || DEFAULT_USER;
          }

          let toText;
          let to;
          if (email.to) {
            toText = email.to.text;
            to = email.to.value[0].name;
          } else if (email.cc) {
            toText = email.cc.text;
            to = email.cc.value[0].name;
          } else if (email.bcc) {
            toText = email.bcc.text;
            to = email.bcc.value[0].name;
          }

          function cleanMail(mail) {
            return mail
              .replace(/\s+DTSI\/DSI/, '')
              .replace(/\s+OF\/DSIF/, '')
              .replace(/\s+OF\/DRCGP/, '')
              .replace(/\s+DTF\/DESI/, '')
              .replace(/\s+DTSI\/DESI/, '')
              .replace(/\s+IMT\/OLPS/, '')
              .replace(/\s+IST\/ISAD/, '')
              .replace(/\s+SCE/, '')
            ;
          }

          fromText = cleanMail(fromText || DEFAULT_USER);
          from = cleanMail(from || fromText);

          toText = cleanMail(toText || DEFAULT_USER);
          to = cleanMail(to || toText);

          const author = (to && (!from || from.match(DEFAULT_USER_PATTERN))) ? `to ${to.slice(0, 40)}: ` : `from ${from}: `;

          const subjectLine = email.subject
            || email.text // no subject => tries the first line
            || 'no-subject';


          const subject = subjectLine
            .replace(/^\s+/, '') // remove the first blanks and line feeds
            .split('\n')[0]; // take the first line

          const saneName = subject.slice(0, 120)
            .replace(/^Conversation avec (.{1,70})$/, `Chat with $1 on ${creationDate.toISOString()}`)
            .replace(/^(RE\s*:\s*)+(.*)$/i, '$2 (RE)')
            .replace(/^(TR\s*:\s*)+(.*)$/i, '$2 (TR)')
          ;
          const targetFileName = author + saneName;

          const bakOutputDir = buildMonthlyDirName(path.resolve(outputDir, 'eml'), creationDate);
          const mainOutputDir = buildMonthlyDirName(path.resolve(outputDir, 'out'), creationDate);


          mkdirp.sync(bakOutputDir, 0o755);
          mkdirp.sync(mainOutputDir, 0o755);
          let writePromise =
            writeFileAsync(bakOutputDir, targetFileName, '.eml', buffer, creationDate, sha1)
          ;

          if (email.text) {
            const text = `subject: ${email.subject}\nfrom: ${fromText}\nto: ${toText}\n\n${email.text}`;
            writePromise = writePromise
              .then(writeFileAsync(mainOutputDir, targetFileName, '.txt', text, creationDate, sha1));
          } else {

          }

          // we do not want a separate file in all cases
          const shouldOutputHtml = !subject
          // ignore communicator chats
            .startsWith('Conversation avec ');

          if (shouldOutputHtml) {
            let html = email.html; // || email.textAsHtml;


            if (html) {
              // encoding is wronlgy set for som mails
              if (FIX_WRONG_ENCODING && html && buffer.toString().indexOf('utf-16') > 0) {
                // console.error(`######### file${sourceFile}`);
                // console.error(`######### targetFileName${targetFileName}`);
                // console.error(`######### default ${email.html.slice(0, 30)}`);
                // console.error(`######### default ${iconv.decode(
                // iconv.encode(email.html, 'utf-16'),
                // 'utf-8').slice(2, 30)}`);
                html = iconv.decode(iconv.encode(html, 'utf-16'), 'utf-8');
              }

              writePromise = writePromise
                .then(writeFileAsync(mainOutputDir, targetFileName, '.html', html, creationDate, sha1));
            }
          }

          const attachmentDedups = {};

          email.attachments.forEach((attachment) => {
            if (attachment.filename) {
              const ext = path.extname(attachment.filename);
              attachment.filename = path.basename(attachment.filename, ext).slice(0, 40) + ext;
            }
          });

          email.attachments.forEach((attachment) => {
            if (attachmentDedups[attachment.checksum]) {
              if (!attachmentDedups[attachment.checksum].filename) {
                attachmentDedups[attachment.checksum] = attachment;
              } else {
                //  console.log('duplicate attachment', attachmentDedups[attachment.checksum]
                // .filename , attachment.filename)
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
      throw new Error(`unknown file type ${sourceFile}`);
    }
  });
}


function processDirectory(sourceDir, targetDir) {
//
  function fileHandler(root, fileStat, next) {
    const sourceFile = path.resolve(root, fileStat.name);
    processFile(sourceFile, targetDir, next);
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


  rimraf.sync(targetDir);
  fs.mkdirSync(targetDir);

  const walker = walk.walk(sourceDir, { followLinks: false });
  walker.on('file', fileHandler);
  walker.on('errors', errorsHandler); // plural
  walker.on('end', endHandler);
}


const sourceDirParam = args[0] || './target/mail/';
const targetDirParam = args[1] || './target/extract/';
processDirectory(sourceDirParam, targetDirParam);


// rimraf.sync('./target');
// fs.mkdirSync('./target');
// processFile('msg-1-body.eml', './target', console.log);

process.on('unhandledRejection', (reason) => {
  console.log('Reason: ', reason);
});
