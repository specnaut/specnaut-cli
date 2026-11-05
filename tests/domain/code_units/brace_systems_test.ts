import { assertEquals } from "@std/assert";
import { shapes } from "./_shapes.ts";

const RUST_DESK = String.raw`use std::fmt;

#[derive(Debug)]
pub struct Line<'a> {
    name: &'a str,
}

pub enum Kind {
    Open,
    Closed { at: u64 },
}

pub trait Desk {
    fn place(&self) -> u32;
    fn name(&self) -> String {
        String::from("{")
    }
}

impl<'a> Display for Line<'a> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let open = '{';
        let close = '\u{7d}';
        let raw = r#"a "}" raw"#;
        /* outer /* nested } */ still comment { */
        write!(f, "{}{}", open, raw)
    }
}

pub fn build<T: Clone>(items: &[T]) -> impl Iterator<Item = T> + '_ {
    items.iter().map(|x| { x.clone() })
}

fn route(kind: Kind) -> u32 {
    match kind {
        Kind::Open => {
            1
        }
    }
}

struct Unit;
fn after() {}
`;

Deno.test("Rust: structs, a trait, impl with generics, lifetimes, raw strings, closures", () => {
  assertEquals(shapes("desk.rs", RUST_DESK), [
    "class Line @4 x3",
    "class Kind @8 x4",
    "class Desk @13 x6",
    "function name @15 x3",
    "class Display @20 x9",
    "function fmt @21 x7",
    "function build @30 x3",
    "function route @34 x7",
    "function after @43 x1",
  ]);
});

const C_DESK = String.raw`#include <stdio.h>
#define MAX(a, b) ((a) > (b) ? (a) : (b))

struct point {
    int x;
    int y;
};

typedef struct {
    int id;
} item_t;

static const struct point origin = {0, 0};

enum color { RED, GREEN };

static struct point *make_point(int x, int y)
{
    char open = '{';
    const char *note = "}"; /* { */
    if (x > y) {
        return NULL;
    }
    // }
    return NULL;
}

int main(void) {
    for (int i = 0; i < 3; i++) {
        printf("%d\n", i);
    }
    return 0;
}
`;

Deno.test("C: structs, a typedef, initialisers, a function returning a struct", () => {
  assertEquals(shapes("desk.c", C_DESK), [
    "class point @4 x4",
    "class ? @9 x3",
    "function make_point @17 x10",
    "function main @28 x6",
  ]);
});

Deno.test("C: a struct in a parameter list leaves the function its own", () => {
  const source = "int run(struct point *p) {\n    return 0;\n}\n";
  assertEquals(shapes("a.c", source), ["function run @1 x3"]);
});

const CPP_DESK = String.raw`#include <vector>
namespace shop {
template <class T, typename U>
class Desk : public Base<T> {
 public:
  explicit Desk(int size) : size_(size), label_("{") {
    auto note = R"(raw } text)";
  }
  ~Desk() {}
  int size() const noexcept {
    return size_;
  }
 private:
  int size_{0};
};

enum class Color { Red };

void Desk<int>::run(std::vector<int> xs) {
  auto twice = [&](int n) -> int {
    return n * 2;
  };
  long big = 1'000'000;
  for (int x : xs) {
    twice(x);
  }
}
}  // namespace shop
`;

Deno.test("C++: a template class, initialiser list, lambda, raw string, digit separators", () => {
  assertEquals(shapes("desk.cpp", CPP_DESK), [
    "class Desk @4 x12",
    "function Desk @6 x3",
    "function Desk @9 x1",
    "function size @10 x3",
    "class Color @17 x1",
    "function run @19 x9",
    "function twice @20 x3",
  ]);
});
