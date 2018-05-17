const Promise = require('bluebird');

const BOX = 'INBOX';
// const BOX = 'Éléments envoyés';
// const BOX = 'Calendrier';
const START_DATE = Date.parse('2017-01-01');
const END_DATE = Date.parse('2017-12-31');


const imapConnection = require('./imap-secret.js');

const imap = Promise.promisifyAll(imapConnection);


imap.once('ready', () => {
  // open the box in update mode
  imap.openBoxAsync(BOX, /* readOnly: */false)

    .then((box) => {
      console.log(`box ${box.name}`);
      return box;
    })
    .then(() => imap.searchAsync([['SINCE', START_DATE], ['BEFORE', END_DATE]]))
    .then((messages) => {
      console.log(`## found ${messages.length}`);

      return Promise.each(messages, message => imap.addFlagsAsync(message, '\\Deleted')
        .then((x) => {
          console.log(`### message ${message} deleted`);
        }));
    })
    .then(() => imap.closeBoxAsync(/* autoExpunge: */true))
    .then(() => {

      console.log(`### inbox closed`);
      imap.end();
    });
});

imap.once('error', (err) => {
  console.error(err);
});

imap.once('end', () => {
  console.log('Connection ended');
});

imap.connect();
