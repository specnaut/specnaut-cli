> **Agents depend on this file.** It is the entry point the architect is
> required to read before naming anything from this catalogue. Moving or
> renaming it, or any leaf it lists, breaks that link in silence — repoint
> the `architect-expert` agent in the same change.

# The architecture catalogue

Every smell, refactoring technique and design pattern this project judges by,
**one file each, held locally**. Nothing here needs a network call: the seat
that needs a definition opens a file instead of deciding whether fetching one
is worth the trouble.

That is the entire point. An online escape hatch is optional, and **an optional
lookup does not happen** — so the vocabulary an audit was supposed to apply
becomes a list of names with nothing behind them, and findings get built from
the right word attached to the wrong diagnosis.

Each leaf is deliberately small, around a page. Opening one costs little enough
that opening one per finding you actually report is affordable, which is what
makes the rule below enforceable rather than aspirational.

## How a finding is built

1. **Name the smell.** Open its file under [`smells/`](smells/) and check
   *How to spot it* against the code. Then read **When it is NOT a smell**,
   looking for the reason you are wrong. A finding that survives that section
   is a real one.
2. **Prescribe the technique.** Open the matching file under
   [`refactorings/`](refactorings/). Most fixes stop here — the smallest
   refactoring that removes the smell is the right one.
3. **Reach for a pattern only if a technique will not do.** Open its file under
   [`patterns/`](patterns/) and read **When NOT to reach for it** *before*
   prescribing. A pattern that removes no present smell is over-engineering,
   and recommending one is itself a finding against the report.
4. **Cite the file you opened**, in the finding. A named smell with no leaf
   behind it is an opinion wearing a technical word — say so and downgrade it
   yourself rather than shipping it at full confidence.
5. **Judging a boundary instead of a unit?** Open
   [`ddd-and-clean-code.md`](ddd-and-clean-code.md) — layering, the dependency
   rule, ports and adapters, and SOLID as questions.

## Contents

| Category | Items | Directory |
| :--- | ---: | :--- |
| Code smells | 29 | [`smells/`](smells/) |
| Refactoring techniques | 67 | [`refactorings/`](refactorings/) |
| Design patterns | 23 | [`patterns/`](patterns/) |
| Boundaries, layering, SOLID | 1 | [`ddd-and-clean-code.md`](ddd-and-clean-code.md) |

## Code smells

### Object-orientation abusers

- [Alternative Classes with Different Interfaces](smells/alternative-classes.md)
- [Refused Bequest](smells/refused-bequest.md)
- [Switch Statements](smells/switch-statements.md)
- [Temporary Field](smells/temporary-field.md)

### Structural

- [Anemic Domain Model](smells/anemic-domain-model.md)
- [Circular Dependency](smells/circular-dependency.md)
- [Deep Nesting](smells/deep-nesting.md)
- [God File](smells/god-file.md)
- [Implicit Global](smells/implicit-global.md)
- [Layer Violation](smells/layer-violation.md)
- [Silent Catch](smells/silent-catch.md)

### Dispensables

- [Comments](smells/comments.md)
- [Data Class](smells/data-class.md)
- [Dead Code](smells/dead-code.md)
- [Duplicate Code](smells/duplicate-code.md)
- [Lazy Class](smells/lazy-class.md)
- [Speculative Generality](smells/speculative-generality.md)

### Bloaters

- [Data Clumps](smells/data-clumps.md)
- [Large Class](smells/large-class.md)
- [Long Method](smells/long-method.md)
- [Long Parameter List](smells/long-parameter-list.md)
- [Primitive Obsession](smells/primitive-obsession.md)

### Change preventers

- [Divergent Change](smells/divergent-change.md)
- [Parallel Inheritance Hierarchies](smells/parallel-inheritance-hierarchies.md)
- [Shotgun Surgery](smells/shotgun-surgery.md)

### Couplers

- [Feature Envy](smells/feature-envy.md)
- [Inappropriate Intimacy](smells/inappropriate-intimacy.md)
- [Message Chains](smells/message-chains.md)
- [Middle Man](smells/middle-man.md)

## Refactoring techniques

### Simplifying method calls

- [Add Parameter](refactorings/add-parameter.md)
- [Hide Method](refactorings/hide-method.md)
- [Introduce Null Object](refactorings/introduce-null-object.md)
- [Introduce Parameter Object](refactorings/introduce-parameter-object.md)
- [Parameterize Method](refactorings/parameterize-method.md)
- [Preserve Whole Object](refactorings/preserve-whole-object.md)
- [Remove Parameter](refactorings/remove-parameter.md)
- [Remove Setting Method](refactorings/remove-setting-method.md)
- [Rename Method](refactorings/rename-method.md)
- [Replace Constructor with Factory Method](refactorings/replace-constructor-with-factory-method.md)
- [Replace Error Code with Exception](refactorings/replace-error-code-with-exception.md)
- [Replace Parameter with Explicit Methods](refactorings/replace-parameter-with-explicit-methods.md)
- [Replace Parameter with Method Call](refactorings/replace-parameter-with-method-call.md)
- [Separate Query from Modifier](refactorings/separate-query-from-modifier.md)

### Organizing data

- [Change Bidirectional Association to Unidirectional](refactorings/change-association-to-unidirectional.md)
- [Change Reference to Value](refactorings/change-reference-to-value.md)
- [Change Unidirectional Association to Bidirectional](refactorings/change-association-to-bidirectional.md)
- [Change Value to Reference](refactorings/change-value-to-reference.md)
- [Duplicate Observed Data](refactorings/duplicate-observed-data.md)
- [Encapsulate Collection](refactorings/encapsulate-collection.md)
- [Encapsulate Field](refactorings/encapsulate-field.md)
- [Introduce Special Case](refactorings/introduce-special-case.md)
- [Replace Array with Object](refactorings/replace-array-with-object.md)
- [Replace Data Value with Object](refactorings/replace-data-value-with-object.md)
- [Replace Magic Number with Symbolic Constant](refactorings/replace-magic-number-with-symbolic-constant.md)
- [Replace Subclass with Fields](refactorings/replace-subclass-with-fields.md)
- [Replace Type Code with Class](refactorings/replace-type-code-with-class.md)
- [Replace Type Code with State/Strategy](refactorings/replace-type-code-with-state-strategy.md)
- [Replace Type Code with Subclasses](refactorings/replace-type-code-with-subclasses.md)
- [Self-Encapsulate Field](refactorings/self-encapsulate-field.md)

### Dealing with generalization

- [Collapse Hierarchy](refactorings/collapse-hierarchy.md)
- [Extract Interface](refactorings/extract-interface.md)
- [Extract Subclass](refactorings/extract-subclass.md)
- [Extract Superclass](refactorings/extract-superclass.md)
- [Form Template Method](refactorings/form-template-method.md)
- [Pull Up Constructor Body](refactorings/pull-up-constructor-body.md)
- [Pull Up Field](refactorings/pull-up-field.md)
- [Pull Up Method](refactorings/pull-up-method.md)
- [Push Down Field](refactorings/push-down-field.md)
- [Push Down Method](refactorings/push-down-method.md)
- [Replace Delegation with Inheritance](refactorings/replace-delegation-with-inheritance.md)
- [Replace Inheritance with Delegation](refactorings/replace-inheritance-with-delegation.md)

### Simplifying conditional expressions

- [Consolidate Conditional Expression](refactorings/consolidate-conditional-expression.md)
- [Consolidate Duplicate Conditional Fragments](refactorings/consolidate-duplicate-conditional-fragments.md)
- [Decompose Conditional](refactorings/decompose-conditional.md)
- [Introduce Assertion](refactorings/introduce-assertion.md)
- [Remove Control Flag](refactorings/remove-control-flag.md)
- [Replace Conditional with Polymorphism](refactorings/replace-conditional-with-polymorphism.md)
- [Replace Exception with Test](refactorings/replace-exception-with-test.md)
- [Replace Nested Conditional with Guard Clauses](refactorings/replace-nested-conditional-with-guard-clauses.md)

### Moving features between objects

- [Extract Class](refactorings/extract-class.md)
- [Hide Delegate](refactorings/hide-delegate.md)
- [Inline Class](refactorings/inline-class.md)
- [Introduce Foreign Method](refactorings/introduce-foreign-method.md)
- [Introduce Local Extension](refactorings/introduce-local-extension.md)
- [Move Field](refactorings/move-field.md)
- [Move Method](refactorings/move-method.md)
- [Remove Middle Man](refactorings/remove-middle-man.md)

### Composing methods

- [Extract Method](refactorings/extract-method.md)
- [Extract Variable](refactorings/extract-variable.md)
- [Inline Method](refactorings/inline-method.md)
- [Inline Temp](refactorings/inline-temp.md)
- [Remove Assignments to Parameters](refactorings/remove-assignments-to-parameters.md)
- [Replace Method with Method Object](refactorings/replace-method-with-method-object.md)
- [Replace Temp with Query](refactorings/replace-temp-with-query.md)
- [Split Temporary Variable](refactorings/split-temporary-variable.md)
- [Substitute Algorithm](refactorings/substitute-algorithm.md)

## Design patterns

### Creational

- [Abstract Factory](patterns/abstract-factory.md)
- [Builder](patterns/builder.md)
- [Factory Method](patterns/factory-method.md)
- [Prototype](patterns/prototype.md)
- [Singleton](patterns/singleton.md)

### Structural

- [Adapter](patterns/adapter.md)
- [Bridge](patterns/bridge.md)
- [Composite](patterns/composite.md)
- [Decorator](patterns/decorator.md)
- [Facade](patterns/facade.md)
- [Flyweight](patterns/flyweight.md)
- [Proxy](patterns/proxy.md)

### Behavioral

- [Chain of Responsibility](patterns/chain-of-responsibility.md)
- [Command](patterns/command.md)
- [Interpreter](patterns/interpreter.md)
- [Iterator](patterns/iterator.md)
- [Mediator](patterns/mediator.md)
- [Memento](patterns/memento.md)
- [Observer](patterns/observer.md)
- [State](patterns/state.md)
- [Strategy](patterns/strategy.md)
- [Template Method](patterns/template-method.md)
- [Visitor](patterns/visitor.md)

## On the sources

The vocabulary is the industry's: the smell and refactoring names come from
Martin Fowler's *Refactoring*, the pattern names from *Design Patterns* by
Gamma, Helm, Johnson and Vlissides. Those names are shared professional
language and are used here as such.

**The prose is original and written for this catalogue.** Nothing here is
copied from any published description, and each leaf is deliberately written
for a stack-agnostic reader rather than any one language or framework.
