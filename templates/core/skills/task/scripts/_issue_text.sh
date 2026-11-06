# shellcheck shell=bash
# The one home of which characters of tracker text reach a reader. Sourced —
# never run — by cloud's `_config.sh` (CLOUD_JSON, every Cloud answer) and by
# `read-items.sh` (the issue text handed to the product owner), each installed
# beside it.
#
# `ISSUE_TEXT_JQ` holds jq definitions only; a caller appends its own program.
# They use no regex, so a jq built without one runs them
# (tests/scripts/cloud_curl_test.ts):
#
#   printable  a code point a terminal shows as itself: no C0 or C1 control,
#              no DEL, no bidi mark or embedding (U+200E-200F, U+202A-202E,
#              U+2066-2069), no line or paragraph separator (U+2028-2029)
#   inert      printable, and none of what changes how text reads without
#              showing itself either: the zero-width characters (U+200B-200D,
#              U+2060-2064, U+FEFF), the Arabic letter mark (U+061C) and the
#              tag characters (U+E0000-E007F)
#   text       one line: a tab, a newline and U+2028-2029 become a space
#   body       lines kept: U+2028-2029 become a newline; tab and newline stay
#   inert_body body, kept to inert characters — the form issue text takes
#              before a reader that acts on what it reads sees it
#
# Code points are numbers here: 8203 is U+200B, 917504 is U+E0000.
ISSUE_TEXT_JQ='
  def printable: . >= 32 and (. < 127 or . > 159)
    and (. < 8206 or . > 8207) and (. < 8232 or . > 8238) and (. < 8294 or . > 8297);
  def inert: printable and . != 1564 and (. < 8203 or . > 8205) and (. < 8288 or . > 8292)
    and . != 65279 and (. < 917504 or . > 917631);
  def text: explode | map(if . == 9 or . == 10 or . == 8232 or . == 8233 then 32 else . end | select(printable)) | implode;
  def body: explode | map(if . == 8232 or . == 8233 then 10 else . end | select(printable or . == 9 or . == 10)) | implode;
  def inert_body: explode | map(if . == 8232 or . == 8233 then 10 else . end | select(inert or . == 9 or . == 10)) | implode;
'
