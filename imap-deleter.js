#!/usr/bin/env node

const Promise = require('bluebird');

const BOXES = ['INBOX', 'Éléments envoyés', 'Calendrier'];
const START_DATE = Date.parse('2018-01-01');
//const END_DATE = Date.parse('2018-07-31');
const END_DATE = Date.parse('2019-12-31');


const imapConnection = require('./imap-secret.js');

const imap = Promise.promisifyAll(imapConnection);


imap.once('ready', () => {
  // open the box in update mode

  Promise.each(BOXES, boxName => imap.openBoxAsync(boxName, /* readOnly: */false)

    .then((box) => {
      console.log(`opened box ${box.name}`);
      return box;
    })
    .then(() => imap.searchAsync([['SINCE', START_DATE], ['BEFORE', END_DATE]]))
    .then((messages) => {
      console.log(`## found ${messages.length}`);

      return Promise.each(messages, message => imap.addFlagsAsync(message, '\\Deleted')
        .then(() => {
          console.log(`### message ${message} deleted`);
        }));
    })
    .then(() => imap.closeBoxAsync(/* autoExpunge: */true)))
    .then(() => {
      console.log('### all inbox closed');
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
