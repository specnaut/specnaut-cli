import { assertEquals } from "@std/assert";
import { shapes } from "./_shapes.ts";

const SWIFT_DESK = String.raw`import Foundation

protocol Desk: AnyObject {
    func place(_ order: Order) -> Int
}

final class OrderDesk: Desk {
    let note = "a } \(1 + 1) brace"
    let block = """
        { raw
        """
    let sharp = #"a "}" b"#

    init(size: Int) {
        self.size = size
    }

    deinit {
        print("bye")
    }

    func place(_ order: Order) -> Int {
        /* outer /* } */ { */
        return items.map { $0 * 2 }.count
    }

    class func make<T>(_ value: T) -> OrderDesk {
        return OrderDesk(size: 1)
    }

    var total: Int {
        return 0
    }
}

extension OrderDesk {
    struct Line {
        let qty: Int
    }
}
`;

Deno.test("Swift: a protocol, init and deinit, a class func, closures, an extension", () => {
  assertEquals(shapes("Desk.swift", SWIFT_DESK), [
    "class Desk @3 x3",
    "class OrderDesk @7 x28",
    "function ? @14 x3",
    "function ? @18 x3",
    "function place @22 x4",
    "function make @27 x3",
    "class OrderDesk @36 x5",
    "class Line @37 x3",
  ]);
});

Deno.test("Swift: a head word as an argument label does not claim a trailing closure", () => {
  const source = ["run(init: 1) {", "    work()", "}", ""].join("\n");
  assertEquals(shapes("a.swift", source), []);
});

Deno.test("Swift: a member call with a trailing closure is not a head", () => {
  assertEquals(shapes("a.swift", "super.init(a) {\n}\n"), []);
});

Deno.test("PHP: an anonymous class takes the name of what holds it, past its arguments", () => {
  const source = "<?php\n$box = new class($a) extends Base {\n};\n";
  assertEquals(shapes("a.php", source), ["class $box @2 x2"]);
});

const PHP_DESK = String.raw`<?php
namespace Example\Shop;

#[Attribute]
final class Desk implements Countable
{
    private string $note = "a } brace";
    private string $raw = 'it\'s {';
    private string $wide = 'two
      lines }';
    // } comment
    # { hash comment

    public function __construct(private array $items = [])
    {
    }

    public function place(Order $order): array {
        $done = function () use ($order) {
            return $order;
        };
        $fn = fn($x) => $x * 2;
        if (count($this->items) > 0) {
            return ["a" => "{"];
        }
        return [$done, $fn, Desk::class];
    }
}

function helper(): void {
}
`;

Deno.test("PHP: attributes, hash comments, closures, ::class and strings across lines", () => {
  assertEquals(shapes("Desk.php", PHP_DESK), [
    "class Desk @5 x24",
    "function __construct @14 x3",
    "function place @18 x10",
    "function $done @19 x3",
    "function helper @30 x2",
  ]);
});
