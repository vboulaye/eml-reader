# eml reader

just a little parser/cleaner of eml files to archive old mails in a simple searchable format.

starting from outlook pst archives, extract all eml files

```
for a in $(ls ../bak);do echo $a; readpst -e -b -o eb -j 10 -teaj ../bak/$a; done
```

otherwise extract mails from the imap server using the imap-archiver.
the connection must be defined in th imap-secret.js file:

```javascript

const Imap = require('imap');

const imap =  new Imap({
   user: 'email',
   password: 'password',
   host: 'imap.gmail.com',
   port: 993,
  tls: true,
  tlsOptions: {
    rejectUnauthorized: false,
  },
 });
 

module.exports = imap;

```

the constants at the beginning of the imap-archiver control the box  to eas, the dates and the output:
```javascript
const outputDir = path.resolve('./target/mail');
// const BOX = 'INBOX';
const BOX = 'Éléments envoyés';
//const BOX = 'Calendrier';
const START_DATE = Date.parse('2015-07-01');
const END_DATE = Date.parse('2016-12-31');
```

warning: for some reason calendar items cannot be exported


then prune empty directories and duplicates

```
find . -empty -type d -delete
fdupes -r -d -N .
```
 
then we can run the cleaning script:

warning : it can fail because of the stack size for mails with lots of recipients. the node command line parameter  `--stack-size=16000` can help.

```
eml-reader <source> <target>
```

some options at the top of the file:
const FIX_WRONG_ENCODING = true; // transform utf-16 back to utf-8 (wrong encoding declared)
const LOG = true; // console log


then we can delete everything wth the imap-deleter