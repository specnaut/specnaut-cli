# Rebuilds bash's argv from SPECNAUT_ARGV_0 .. SPECNAUT_ARGV_<n-1>, n being
# SPECNAUT_ARGC, removes those variables, and runs the same bash on it. Why the
# arguments travel this way: bash_argv.ts.
args=()
i=0
while [ "$i" -lt "${SPECNAUT_ARGC:?bash_argv.ts sets SPECNAUT_ARGC}" ]; do
  name="SPECNAUT_ARGV_$i"
  args+=("${!name}")
  unset "$name"
  i=$((i + 1))
done
unset SPECNAUT_ARGC
exec "$BASH" "${args[@]}"
