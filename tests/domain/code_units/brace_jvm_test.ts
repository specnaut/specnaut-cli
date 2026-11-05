import { assertEquals } from "@std/assert";
import { shapes } from "./_shapes.ts";

const JAVA_DESK = String.raw`package example.shop;

@Service("orders")
public final class OrderDesk<T extends Item> implements Desk, Closeable {
  private static final char OPEN = '{';
  private final String note = "} not a close";
  private final String block = """
      { in a text block
      """;

  public OrderDesk(Clock clock) throws IOException {
    super(clock);
  }

  /* { */
  @Override
  public <R> List<R> place(Order order) throws IOException {
    if (order == null) {
      throw new IllegalStateException("{");
    }
    Runnable task = new Runnable() {
      @Override
      public void run() {
        log('}');
      }
    };
    return List.of();
  }

  record Line(int qty) {
    int twice() {
      return qty * 2;
    }
  }
}
`;

Deno.test("Java: a class, constructor, generic method, anonymous class and record", () => {
  assertEquals(shapes("OrderDesk.java", JAVA_DESK), [
    "class OrderDesk @4 x32",
    "function OrderDesk @11 x3",
    "function place @17 x12",
    "function run @23 x3",
    "class Line @30 x5",
    "function twice @31 x3",
  ]);
});

Deno.test("Java: an interface and an enum are class units; a static block is not", () => {
  const source = `interface Pricing {
  int price(int qty);
}
enum Kind {
  OPEN, CLOSED;
  static {
    load();
  }
}
`;
  assertEquals(shapes("A.java", source), ["class Pricing @1 x3", "class Kind @4 x6"]);
});

const CSHARP_DESK = String.raw`namespace Example.Shop;

[Route("orders")]
public sealed class OrderDesk<T> : IDesk where T : class
{
    private readonly string _path = @"C:\{temp\";
    public int Count { get; private set; }

    public OrderDesk(int size) : base(size)
    {
        Count = size;
    }

    public async Task<int> PlaceAsync(Order order)
    {
        var label = $"{order.Id}}}";
        Action done = () =>
        {
            Count += 1;
        };
        foreach (var line in order.Lines)
        {
            done();
        }
        return Count;
    }
}

public record Line(int Qty);

public struct Point
{
    public int X;
}
`;

Deno.test("C#: Allman braces, a base call, a constraint, a lambda and a verbatim string", () => {
  assertEquals(shapes("OrderDesk.cs", CSHARP_DESK), [
    "class OrderDesk @4 x24",
    "function OrderDesk @9 x4",
    "function PlaceAsync @14 x13",
    "function done @17 x4",
    "class Point @31 x4",
  ]);
});

Deno.test("C#: an assembly attribute names no function", () => {
  const source = '[assembly: Visible("a")]\nnamespace Shop\n{\n}\n';
  assertEquals(shapes("a.cs", source), []);
});

const KOTLIN_DESK = [
  "package example.shop", //  1
  "", //  2
  "data class Line(val qty: Int)", //  3
  "", //  4
  "sealed class Desk<T>(private val name: String) : Base(name), Closeable {", //  5
  "    private val open = '{'", //  6
  '    private val note = "qty ${open} }"', //  7
  '    private val raw = """', //  8
  "        { not code", //  9
  '    """', // 10
  "", // 11
  "    init {", // 12
  "        println(note)", // 13
  "    }", // 14
  "", // 15
  "    fun <R> place(order: Order, pick: (Order) -> R): R {", // 16
  "        if (order.qty > 1) {", // 17
  '            println("{")', // 18
  "        }", // 19
  "        return pick(order)", // 20
  "    }", // 21
  "", // 22
  "    fun String.shout(): String {", // 23
  "        return uppercase()", // 24
  "    }", // 25
  "", // 26
  "    fun twice(n: Int) = n * 2", // 27
  "", // 28
  "    companion object {", // 29
  "        fun empty(): Desk<Int> {", // 30
  "            return TODO()", // 31
  "        }", // 32
  "    }", // 33
  "}", // 34
  "", // 35
  "fun main() {", // 36
  "    listOf(1).forEach { println(it) }", // 37
  "}", // 38
  "",
].join("\n");

Deno.test("Kotlin: a class with no body, primary constructors, extensions, objects", () => {
  assertEquals(shapes("Desk.kt", KOTLIN_DESK), [
    "class Desk @5 x30",
    "function place @16 x6",
    "function shout @23 x3",
    "class ? @29 x5",
    "function empty @30 x3",
    "function main @36 x3",
  ]);
});
