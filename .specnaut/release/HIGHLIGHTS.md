**A file you declared preserved survives its retirement.** When a release stopped shipping a path
listed in `.specnaut/preserve.yml`, `specnaut upgrade` warned that the declaration was ignored and
then deleted the file. It now keeps the file and keeps tracking it, and every upgrade reports that
upstream no longer ships it until you remove the declaration. A declared file that a release renamed
stays where it is, and the new document is added beside it.

**Removing a file never reaches the project itself.** `upgrade` judges each removal on the file it
actually removes. A path that lands on the project folder, whether through a symbolic link or as
`.`, is refused, and so is a name the filesystem could read as something else, such as one ending in
a dot or a space.
