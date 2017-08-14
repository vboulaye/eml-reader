const Promise = require('bluebird');
// const Imap = require('imap');
const fs = Promise.promisifyAll(require('fs'));
const mkdirp = require('mkdirp');
const path = require('path');


// const outputDir = path.resolve('./target/mail');
const outputDir = path.resolve('/media/uvba7442/mail/mail/imap/');
// const BOX = 'INBOX';
const BOX = 'Éléments envoyés';
//const BOX = 'Calendrier';
const START_DATE = Date.parse('2015-07-01');
const END_DATE = Date.parse('2016-12-31');


mkdirp(outputDir);


const imapConnection = require('./imap-secret.js');

const imap = Promise.promisifyAll(imapConnection);


function downloadMails(results) {
  return new Promise((resolve, reject) => {
    const messages = [];

    console.log(`##### ${new Date().toISOString()} fetching `, results[0]);
    const f = imap.fetch(results, {bodies: ''});// ,
    f.on('message', (msg, seqno) => {
      const message = { message: msg, seq: seqno };
      messages.push(message);
      // console.log('Message #%d', seqno);

      // const prefix = `(#${seqno}) `;
      msg.on('body', (stream, info) => {
        message.stream = stream;
        message.info = info;
        // console.log(`${prefix}`);
      });
      msg.once('attributes', (attrs) => {
        // console.log(`${prefix}Attributes: %s`, inspect(attrs, false, 8));
        message.attributes = attrs;
      });
      msg.once('error', (err) => {
        if (message.stream) {
          message.stream.close();
        }
        if (message.output) {
          message.output.close();
        }
        console.console(`Fetch message ${seqno} error: ${err} `, err);
        reject(err);
      });
      msg.once('end', () => {
        // console.log(`${prefix}Finished`);

        const monthlyDir = path.resolve(outputDir, message.attributes.date.toISOString().slice(0, 7));
        mkdirp.sync(monthlyDir);
        const outputFileName = path.resolve(monthlyDir, `${message.attributes.date.toISOString().slice(0, 10)}-${seqno}.eml`);

        message.output = fs.createWriteStream(outputFileName);
        message.stream.pipe(message.output);

        console.log(`Message #${message.seq} ${message.attributes.date} => ${outputFileName}`);
      });
    });
    f.once('error', (err) => {
      console.error(`Fetch error: ${err}`, err);
      reject(err);
    });
    f.once('end', () => {
      console.log('Done fetching all messages!', results[0]);

      resolve(messages);
    });
  });
}


imap.once('ready', () => {
  // imap.getBoxesAsync()
  //   .then((box) => {
  //     console.log('box ', box);
  //     return box;
  //   })


  imap.openBoxAsync(BOX, true)

    .then((box) => {
      console.log(`box ${box.name}`);
      return box;
    })
    .then(() => imap.searchAsync([['SINCE', START_DATE], ['BEFORE', END_DATE]]))
    .then((results) => {
      console.log(`## found ${results.length}`);
      const chunkSize = 100;
      const resultBlocs = [];
      for (let i = 0; i < results.length; i += chunkSize) {
        resultBlocs.push(results.slice(i, i + chunkSize));
      }
      return Promise.each(resultBlocs, (resultBloc) => {
        console.log(`### processing ${chunkSize} messages from ${resultBloc[0]}`);
        return downloadMails(resultBloc);
      });
    })

    .then(() => { imap.end(); });
});

imap.once('error', (err) => {
  console.error(err);
});

imap.once('end', () => {
  console.log('Connection ended');
});

imap.connect();
