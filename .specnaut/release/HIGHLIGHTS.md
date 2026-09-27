**Organization date fields on a GitHub Project now actually write.** v4.5.0 taught `set-field.sh` to
write a `Start date` or `Target date` that a Project shows from the organization — but it recognised
one by the shape of its id, and on real boards those dates come back with an ordinary project-field
id. The write went to the project, GitHub refused it, and the script exited 1. The board now answers
the question itself: each field says whether it is an organization issue field and which one, and
`set-field.sh` routes on that. A project that owns a date of the same name keeps writing through the
project.

The same misreading could send a Priority or Size field with no options of its own to a same-named
organization field the board does not show — a write that succeeded somewhere nobody was looking.
That is fixed with it. Boards without dates, and single-selects with their own options, make no
extra request.
