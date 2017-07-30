# eml reader

just a little parser/cleaner of eml files to archive old mails in a simple searchable format.

starting from outlook pst archives, extract all eml files

```
for a in $(ls ../bak);do echo $a; readpst -e -b -o eb -j 10 -teaj ../bak/$a; done
```

then prune empty directories

```
find . -empty -type d -delete
```
 
then we can run the cleaning script

```
eml-reader <source> <target>
```
