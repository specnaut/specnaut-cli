# Constitution

The principles this project's code is held to. Every plan and every review checks a change
against them. Amend it deliberately, as a team, and say why in the commit.

## Domain isolation

Business rules live in a domain core that knows nothing of frameworks, databases, the network
or the file system. The outside world reaches it through ports (interfaces the core owns) and
adapters (the code that implements them).

Check: no file in the domain core imports a framework, a database driver, an SDK or an I/O module.

Override: name the folder that holds your domain core and the imports your stack forbids there.

## Dependencies point inward

Presentation depends on application, application on domain. Infrastructure implements the ports
the inner layers declare. Nothing inner knows anything outer.

Check: no import goes from the domain to any other layer, or from application to infrastructure or presentation.

Override: list your layers, outermost first, when they differ from these four.

## Bounded contexts

Each part of the business keeps its own model and its own words. One context never reaches into
another's internals: it goes through that context's published interface, or translates at the
border.

Check: no module imports another context's internal types; data crosses a context only through its public interface.

Override: name your contexts and the folder each one lives in.

## SOLID

Each module has one reason to change, grows by extension rather than by edit, honours the
contracts it implements, depends on narrow interfaces, and is handed its collaborators rather
than building them.

Check: a new behaviour adds a module or an implementation, not another branch in an existing one.

Check: a module that needs a collaborator receives it as a parameter, never constructs it inside.

Override: record any letter your stack applies differently, and how.

---

Version: 1.0.0
