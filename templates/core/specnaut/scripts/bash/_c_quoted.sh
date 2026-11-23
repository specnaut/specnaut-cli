# shellcheck shell=bash
# The one quoting of text a gate prints that it did not write - a path, a configured value: sourced
# by size-ratchet.sh and boundary-check.sh after _config.sh.
#
#   c_quoted <text>  <text> as git's core.quotepath prints a path (cli#807): one holding a control
#       byte, a byte at or above 0x80, a `"` or a `\` is quoted, those bytes escaped (`\t`,
#       `\033`, `\302\233`); any other is printed as is.
#
# A name or a value is data: printed raw, an escape sequence, a lone C1 byte or a bidi override in
# it would act on the terminal instead.
c_quoted() (
  LC_ALL=C
  s="$1" out=""
  case "$s" in *[[:cntrl:]\"\\$'\200'-$'\377']*) ;; *) printf '%s' "$s" && exit 0 ;; esac
  for ((i = 0; i < ${#s}; i++)); do
    c="${s:i:1}"
    case "$c" in
      $'\a') c='\a' ;; $'\b') c='\b' ;; $'\t') c='\t' ;; $'\n') c='\n' ;;
      $'\v') c='\v' ;; $'\f') c='\f' ;; $'\r') c='\r' ;;
      '"' | '\') c="\\$c" ;;
      [[:cntrl:]$'\200'-$'\377']) printf -v v '%d' "'$c" && printf -v c '\\%03o' $((v & 255)) ;;
    esac
    out+="$c"
  done
  printf '"%s"' "$out"
)
